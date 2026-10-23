import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { confirmedMode, confirmedSource, packetOrder, transition, SOURCE_LABELS } from './state.mjs';

export const METRICS = Object.freeze({
  'pv.busVoltageV': '$.packet.telemetry.pv.busVoltageV',
  'pv.currentA': '$.packet.telemetry.pv.currentA',
  'pv.powerW': '$.packet.telemetry.pv.powerW',
  'bms.cell1V': '$.packet.telemetry.bms.cellVoltagesV[0]',
  'bms.cell2V': '$.packet.telemetry.bms.cellVoltagesV[1]',
  'bms.cell3V': '$.packet.telemetry.bms.cellVoltagesV[2]',
  // Fourth slot was physical cell 10 before v6; do not mislabel historical packets.
  'bms.cellSlot4V': '$.packet.telemetry.bms.cellVoltagesV[3]',
  'bms.packVoltageV': '$.packet.telemetry.bms.packVoltageV',
  'mppt.vbusV': '$.packet.telemetry.mppt.vbusV',
  'mppt.vbatV': '$.packet.telemetry.mppt.vbatV',
  'mppt.ibusA': '$.packet.telemetry.mppt.ibusA',
  'peripheral.temperatureC': '$.packet.telemetry.peripheral.temperatureC',
  'peripheral.lightVoltageMv': '$.packet.telemetry.peripheral.lightVoltageMv'
});

function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`Expected an integer from ${min} through ${max}`);
  return n;
}

export class RunStore {
  constructor(filename, now = Date.now()) {
    this.ownerId = randomUUID();
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 2000');
    if (this.db.pragma('user_version', { simple: true }) > 1) throw new Error('Unsupported recording schema version');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recorder_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), pid INTEGER NOT NULL, token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, name TEXT NOT NULL,
        device_id TEXT NOT NULL, remote_address TEXT NOT NULL,
        run_type TEXT NOT NULL CHECK(run_type IN ('debug','live_telemetry')),
        current_mode TEXT NOT NULL, current_source TEXT,
        started_ms INTEGER NOT NULL, ended_ms INTEGER, end_reason TEXT,
        status TEXT NOT NULL DEFAULT 'recording', contains_debug INTEGER NOT NULL DEFAULT 0,
        previous_run_id TEXT REFERENCES runs(id), next_run_id TEXT REFERENCES runs(id),
        sample_count INTEGER NOT NULL DEFAULT 0, last_seq INTEGER,
        last_received_ms INTEGER, metadata_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_run ON runs(status) WHERE status='recording';
      CREATE INDEX IF NOT EXISTS runs_started ON runs(started_ms,id);
      CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
        received_ms INTEGER NOT NULL, seq INTEGER, mode TEXT, power_source TEXT,
        packet_order TEXT NOT NULL, envelope_json TEXT NOT NULL, raw_base64 TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS samples_window ON samples(run_id,received_ms,id);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id),
        at_ms INTEGER NOT NULL, type TEXT NOT NULL, details_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_window ON events(run_id,at_ms,id);
      PRAGMA user_version = 1;
    `);
    // Never resume an acquisition silently after a crash/restart.
    try { this.db.transaction(() => {
      const owner = this.db.prepare('SELECT pid FROM recorder_owner WHERE singleton=1').get();
      if (owner) {
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Another recorder owns this database');
      }
      this.db.prepare('INSERT OR REPLACE INTO recorder_owner(singleton,pid,token) VALUES(1,?,?)').run(process.pid, this.ownerId);
      for (const r of this.db.prepare("SELECT * FROM runs WHERE status='recording'").all()) {
        this.finish(r, now, 'bridge_restart', 'interrupted');
      }
    })(); } catch (error) { this.db.close(); throw error; }
  }
  active() { return this.db.prepare("SELECT * FROM runs WHERE status='recording'").get() || null; }
  event(id, at, type, details) {
    return Number(this.db.prepare('INSERT INTO events(run_id,at_ms,type,details_json) VALUES(?,?,?,?)')
      .run(id, at, type, JSON.stringify(details)).lastInsertRowid);
  }
  insertRun({ name, device_id, remote_address, mode, source, at, metadata, previous = null, session = randomUUID() }) {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO runs(id,session_id,name,device_id,remote_address,run_type,
      current_mode,current_source,started_ms,contains_debug,previous_run_id,metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, session, name, device_id, remote_address,
      mode, mode, source, at, mode === 'debug' ? 1 : 0, previous, JSON.stringify(metadata));
    return id;
  }
  start({ name, envelope, metadata = {}, now = Date.now() }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 120) fail('Run name must be 1–120 characters');
    if (envelope?.source !== 'udp' || envelope.type !== 'telemetry') fail('A real UDP telemetry source is required', 409);
    const mode = confirmedMode(envelope.packet);
    if (!mode) fail('The packet does not report a supported recording mode', 409);
    return this.db.transaction(() => {
      if (this.active()) fail('Stop the current recording first', 409);
      const id = this.insertRun({ name: name.trim(), device_id: envelope.packet.device_id,
        remote_address: envelope.network.remote_address, mode, source: confirmedSource(envelope.packet), at: now, metadata });
      this.event(id, now, 'run_started', { mode, source: confirmedSource(envelope.packet) });
      return this.get(id);
    })();
  }
  finish(run, at, reason, status = 'completed', next = null, details = {}) {
    this.db.prepare('UPDATE runs SET status=?,ended_ms=?,end_reason=?,next_run_id=? WHERE id=?')
      .run(status, at, reason, next, run.id);
    this.event(run.id, at, 'run_ended', { reason, next_run_id: next, ...details });
  }
  stop({ now = Date.now(), reason = 'operator_stop', status = 'completed' } = {}) {
    return this.db.transaction(() => {
      const active = this.active();
      if (!active) fail('No recording is active', 409);
      this.finish(active, now, reason, status);
      return this.get(active.id);
    })();
  }
  ingest({ envelope, rawBase64 }) {
    if (envelope?.source !== 'udp' || envelope.type !== 'telemetry') return null;
    const at = Date.parse(envelope.received_at);
    if (!Number.isFinite(at)) fail('Invalid receive timestamp');
    return this.db.transaction(() => {
      let run = this.active();
      if (!run) return null;
      const p = envelope.packet;
      if (p.device_id !== run.device_id || envelope.network?.remote_address !== run.remote_address) return null;
      // Do not accidentally record cached/pre-start envelopes.
      if (at < run.started_ms) return null;
      const mode = confirmedMode(p), source = confirmedSource(p);
      const order = packetOrder(run.last_seq, p.seq);
      const forward = order !== 'duplicate' && order !== 'out_of_order';
      if (forward) {
        const change = transition(run, mode, source);
        const details = { from_source: run.current_source, to_source: source,
          from_mode: run.current_mode, to_mode: mode,
          source_evidence: 'mppt_reg13', reg13: p.raw?.mppt?.reg13 ?? null };
        if (change.sourceChanged) {
          details.label = `Power source switched from ${SOURCE_LABELS[run.current_source]} to ${SOURCE_LABELS[source]}`;
          this.event(run.id, at, 'source_switch', details);
        }
        if (change.modeChanged) this.event(run.id, at, 'mode_changed', details);
        if (change.rotate) {
          // End old and create successor atomically, with the boundary packet in the successor.
          this.finish(run, at, change.reason, 'completed', null, details);
          const next = this.insertRun({ name: run.name, device_id: run.device_id,
            remote_address: run.remote_address, mode, source: source ?? run.current_source,
            at, metadata: JSON.parse(run.metadata_json), previous: run.id, session: run.session_id });
          this.db.prepare('UPDATE runs SET next_run_id=? WHERE id=?').run(next, run.id);
          // Attach the link to the existing end marker, not a second contradictory marker.
          this.db.prepare("UPDATE events SET details_json=json_set(details_json,'$.next_run_id',?) WHERE id=(SELECT MAX(id) FROM events WHERE run_id=? AND type='run_ended')")
            .run(next, run.id);
          this.event(next, at, 'run_started', { reason: change.reason, previous_run_id: run.id, ...details });
          run = this.active();
        }
        this.db.prepare(`UPDATE runs SET current_mode=?,current_source=?,contains_debug=MAX(contains_debug,?),last_seq=? WHERE id=?`)
          .run(mode ?? run.current_mode, source ?? run.current_source, mode === 'debug' ? 1 : 0, p.seq ?? null, run.id);
      }
      const inserted = this.db.prepare(`INSERT INTO samples(run_id,received_ms,seq,mode,power_source,packet_order,envelope_json,raw_base64)
        VALUES(?,?,?,?,?,?,?,?)`).run(run.id, at, p.seq ?? null, mode, source, order, JSON.stringify(envelope), rawBase64);
      this.db.prepare('UPDATE runs SET sample_count=sample_count+1,last_received_ms=? WHERE id=?').run(at, run.id);
      return { run_id: run.id, sample_id: Number(inserted.lastInsertRowid), mode, power_source: source };
    })();
  }
  command({ envelope }) {
    const run = this.active();
    if (!run || envelope.target?.address !== run.remote_address) return null;
    this.event(run.id, Date.parse(envelope.updated_at), 'command_status', envelope);
    return { run_id: run.id };
  }
  marker({ sequence_name, step_index, step_text, phase, ok = null, result = null, now = Date.now() }) {
    const run = this.active();
    if (!run) fail('No recording is active', 409);
    if (typeof sequence_name !== 'string' || !sequence_name.trim() || sequence_name.length > 120) {
      fail('Sequence name must be 1–120 characters');
    }
    if (!Number.isSafeInteger(step_index) || step_index < 0 || step_index > 100000) fail('Invalid sequence step index');
    if (typeof step_text !== 'string' || !step_text.trim() || step_text.length > 500) fail('Sequence step must be 1–500 characters');
    if (!['started', 'completed', 'failed'].includes(phase)) fail('Invalid sequence step phase');
    if (ok !== null && typeof ok !== 'boolean') fail('Sequence step result must be true, false or null');
    if (result !== null && typeof result !== 'string') fail('Sequence step output must be a string or null');
    const details = { sequence_name: sequence_name.trim(), step_index, step_number: step_index + 1,
      step_text: step_text.trim(), phase, ok, result: result === null ? null : result.slice(0, 1000) };
    const event_id = this.event(run.id, integer(now, Date.now(), 0, Number.MAX_SAFE_INTEGER), 'sequence_step', details);
    return { run_id: run.id, event_id, ...details };
  }
  get(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!row) fail('Run not found', 404);
    const { metadata_json, ...rest } = row;
    return { ...rest, metadata: JSON.parse(metadata_json) };
  }
  list({ limit, offset } = {}) {
    return this.db.prepare('SELECT id FROM runs ORDER BY started_ms DESC,id DESC LIMIT ? OFFSET ?')
      .all(integer(limit, 50, 1, 100), integer(offset, 0, 0, 1000000)).map((r) => this.get(r.id));
  }
  window(id, options) {
    const run = this.get(id);
    const start = integer(options.start, run.started_ms, 0, Number.MAX_SAFE_INTEGER);
    // IDs disambiguate samples sharing a millisecond with a boundary/stop marker.
    const defaultEnd = Math.max(run.ended_ms ?? Date.now() + 1, (run.last_received_ms ?? run.started_ms) + 1);
    const end = integer(options.end, defaultEnd, 0, Number.MAX_SAFE_INTEGER);
    if (end < start) fail('end must not precede start');
    return { start, end };
  }
  samples({ id, ...options }) {
    const { start, end } = this.window(id, options);
    const after = integer(options.after, 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = integer(options.limit, 100, 1, 500);
    const rows = this.db.prepare(`SELECT * FROM samples WHERE run_id=? AND received_ms>=? AND received_ms<? AND id>?
      ORDER BY id LIMIT ?`).all(id, start, end, after, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(({ envelope_json, ...r }) => ({ ...r, envelope: JSON.parse(envelope_json) }));
    return { start, end, items, next_after: hasMore ? items.at(-1).id : null };
  }
  events({ id, after, limit }) {
    this.get(id);
    const rows = this.db.prepare('SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id LIMIT ?')
      .all(id, integer(after, 0, 0, Number.MAX_SAFE_INTEGER), integer(limit, 100, 1, 500) + 1);
    const size = integer(limit, 100, 1, 500);
    const items = rows.slice(0, size).map(({ details_json, ...r }) => ({ ...r, details: JSON.parse(details_json) }));
    return { items, next_after: rows.length > size ? items.at(-1).id : null };
  }
  series({ id, metric, ...options }) {
    if (!Object.hasOwn(METRICS, metric)) fail('Unknown metric');
    const { start, end } = this.window(id, options);
    if (end - start > 24 * 60 * 60 * 1000) fail('Series queries are limited to 24 hours');
    const points = integer(options.points, 500, 1, 2000);
    const width = Math.max(1, Math.ceil((end - start) / points));
    // JSON path is a bound, allowlisted parameter. No browser-provided SQL or identifiers.
    const rows = this.db.prepare(`WITH values_in_window AS (
      SELECT id,received_ms,json_extract(envelope_json,?) AS value FROM samples
      WHERE run_id=? AND received_ms>=? AND received_ms<?
    ) SELECT CAST((received_ms-?)/? AS INTEGER) AS bucket,COUNT(*) AS sample_count,
      COUNT(CASE WHEN typeof(value) IN ('integer','real') THEN value END) AS valid_count,
      MIN(CASE WHEN typeof(value) IN ('integer','real') THEN value END) AS min,
      MAX(CASE WHEN typeof(value) IN ('integer','real') THEN value END) AS max,
      AVG(CASE WHEN typeof(value) IN ('integer','real') THEN value END) AS mean,
      MIN(id) AS first_sample_id,MAX(id) AS last_sample_id
      FROM values_in_window GROUP BY bucket ORDER BY bucket`)
      .all(METRICS[metric], id, start, end, start, width);
    return { metric, start, end, bucket_ms: width, points: rows.map(({ bucket, ...r }) => ({
      start_ms: start + bucket * width, end_ms: Math.min(end, start + (bucket + 1) * width), ...r
    })) };
  }
  close() {
    this.db.prepare('DELETE FROM recorder_owner WHERE token=?').run(this.ownerId);
    this.db.close();
  }
}
