import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RunStore } from '../recording/store.mjs';
import { confirmedSource, transition } from '../recording/state.mjs';
import { archivePayload } from '../recording/raw.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/streaming-envelopes.json', import.meta.url)));
const START = 1700000000000;
test('archive preserves binary bytes and removes JSON transport credentials explicitly', () => {
  const bytes = Buffer.from([0xff, 0x00, 0x43, 0x53]);
  assert.deepEqual(archivePayload(bytes), { rawBase64: bytes.toString('base64'), redacted: false });
  const archived = archivePayload(Buffer.from(JSON.stringify({ seq: 1, auth_token: 'test-only-secret' })));
  assert.equal(archived.redacted, true);
  assert.deepEqual(JSON.parse(Buffer.from(archived.rawBase64, 'base64').toString()), { seq: 1 });
});
function envelope(seq, { debug = false, reg = 0x40, at = START + seq * 1000 } = {}) {
  const e = structuredClone(fixtures.v6_all);
  e.received_at = new Date(at).toISOString();
  e.packet.seq = seq;
  e.packet.debug.enabled = debug;
  e.packet.raw.mppt.reg13 = reg;
  return e;
}
function setup(t, options) {
  const store = new RunStore(':memory:', START);
  t.after(() => store.close());
  const run = store.start({ name: "Lab 'one'", envelope: envelope(1, options), now: START });
  const send = (seq, opts) => store.ingest({ envelope: envelope(seq, opts), rawBase64: 'Q1M=' });
  return { store, run, send };
}

test('source mapping requires available, unpaused register evidence; ambiguous and missing remain unknown', () => {
  assert.equal(confirmedSource(envelope(1).packet), 'pv');
  for (const reg of [0, 0x80]) assert.equal(confirmedSource(envelope(1, { reg }).packet), 'bat_secondary');
  assert.equal(confirmedSource(envelope(1, { reg: 0xc0 }).packet), null);
  for (const modify of [
    (p) => { delete p.raw; }, (p) => { p.telemetry.mppt.available = false; },
    (p) => { p.sensor_polling.active_sensor_mask = 3; },
    (p) => { p.debug.devices.mppt.state = 'paused'; },
    (p) => { p.debug.devices.mppt.state = 'error'; }
  ]) {
    const p = envelope(1).packet; modify(p); assert.equal(confirmedSource(p), null);
  }
});

test('non-debug source switch atomically ends a run, links its successor and assigns boundary packet once', (t) => {
  const { store, run, send } = setup(t);
  send(1);
  const boundary = send(2, { reg: 0x80 });
  assert.notEqual(boundary.run_id, run.id);
  const previous = store.get(run.id), next = store.get(boundary.run_id);
  assert.equal(previous.end_reason, 'source_switch');
  assert.equal(previous.next_run_id, next.id);
  assert.equal(next.previous_run_id, previous.id);
  assert.equal(next.session_id, previous.session_id);
  assert.equal(previous.ended_ms, next.started_ms);
  assert.equal(previous.sample_count, 1);
  assert.equal(next.sample_count, 1);
  const marker = store.events({ id: previous.id }).items.find((x) => x.type === 'run_ended');
  assert.equal(marker.details.next_run_id, next.id);
  assert.equal(marker.details.from_source, 'pv');
  assert.equal(marker.details.to_source, 'bat_secondary');
  assert.match(marker.details.label, /PV to BAT\/secondary/);
  assert.equal(store.samples({ id: previous.id }).items[0].seq, 1);
  assert.equal(store.samples({ id: next.id }).items[0].seq, 2);
  // Off and ACDRV2 are the same source category, not another BAT/PV change.
  assert.equal(send(3, { reg: 0 }).run_id, next.id);
});

test('entering debug and source switching in debug preserve a run; leaving debug creates one successor', (t) => {
  const { store, run, send } = setup(t);
  send(1);
  assert.equal(send(2, { debug: true }).run_id, run.id);
  assert.equal(send(3, { debug: true, reg: 0 }).run_id, run.id);
  assert.equal(store.get(run.id).contains_debug, 1);
  const exit = send(4, { reg: 0x40 }); // Debug exit and source change together.
  assert.equal(store.list().length, 2);
  assert.equal(store.get(run.id).end_reason, 'debug_exit');
  assert.equal(store.get(exit.run_id).run_type, 'live_telemetry');
  const samples = store.samples({ id: run.id }).items;
  assert.deepEqual(samples.map((r) => r.mode), ['live_telemetry', 'debug', 'debug']);
  assert.equal(samples[2].power_source, 'bat_secondary');
  assert.equal(store.events({ id: run.id }).items.filter((e) => e.type === 'source_switch').length, 2);
});

test('unknown readings, duplicates and reordered packets are stored without false boundaries', (t) => {
  const { store, run, send } = setup(t);
  send(10);
  send(9, { reg: 0 });
  send(10, { reg: 0 });
  send(11, { reg: 0xc0 });
  assert.equal(store.list().length, 1);
  assert.equal(store.get(run.id).current_source, 'pv');
  assert.deepEqual(store.samples({ id: run.id }).items.map((x) => x.packet_order),
    ['unsequenced', 'out_of_order', 'duplicate', 'forward']);
  assert.equal(store.samples({ id: run.id }).items.at(-1).power_source, null);
  assert.notEqual(send(12, { reg: 0 }).run_id, run.id);
});

test('sequence wrap advances; injected/browser and unrelated device data cannot enter a real run', (t) => {
  const { store, run, send } = setup(t);
  send(65535, { at: START + 100 });
  send(1, { at: START + 200 });
  for (const modify of [
    (e) => { e.source = 'http-input'; }, (e) => { e.packet.device_id = 'another'; },
    (e) => { e.network.remote_address = '192.0.2.1'; }, (e) => { e.type = 'debug_result'; }
  ]) {
    const e = envelope(2); modify(e);
    assert.equal(store.ingest({ envelope: e, rawBase64: '' }), null);
  }
  assert.equal(store.get(run.id).sample_count, 2);
  assert.equal(store.samples({ id: run.id }).items[1].packet_order, 'forward');
});

test('durable restart marks open runs interrupted and requires an explicit new recording', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'runs.sqlite');
  let store = new RunStore(file, START);
  const run = store.start({ name: 'Restart', envelope: envelope(1), now: START });
  store.ingest({ envelope: envelope(1), rawBase64: 'raw' });
  store.close();
  store = new RunStore(file, START + 5000);
  t.after(() => store.close());
  assert.equal(store.active(), null);
  assert.equal(store.get(run.id).status, 'interrupted');
  assert.equal(store.get(run.id).end_reason, 'bridge_restart');
  assert.equal(store.samples({ id: run.id }).items[0].raw_base64, 'raw');
  assert.equal(store.ingest({ envelope: envelope(2), rawBase64: 'new' }), null);
});

test('bounded history queries use exact half-open ranges and preserve aggregate peaks and null counts', (t) => {
  const { store, run } = setup(t);
  for (let i = 1; i <= 4; i++) {
    const e = envelope(i);
    e.packet.telemetry.pv.currentA = [null, 1, 9, 0][i - 1];
    store.ingest({ envelope: e, rawBase64: '' });
  }
  const first = store.samples({ id: run.id, start: START + 1000, end: START + 4000, limit: 2 });
  assert.equal(first.items.length, 2);
  const second = store.samples({ id: run.id, start: START + 1000, end: START + 4000, after: first.next_after, limit: 2 });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].seq, 3);
  const result = store.series({ id: run.id, metric: 'pv.currentA', start: START, end: START + 5000, points: 1 });
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].sample_count, 4);
  assert.equal(result.points[0].valid_count, 3);
  assert.equal(result.points[0].min, 0);
  assert.equal(result.points[0].max, 9);
  assert.equal(result.points[0].mean, 10 / 3);
  assert.throws(() => store.series({ id: run.id, metric: "'); DROP TABLE runs;--" }), /Unknown metric/);
  assert.throws(() => store.samples({ id: run.id, limit: 100000 }), /integer/);
  assert.equal(store.list()[0].name, "Lab 'one'");
});

test('a failed boundary transaction cannot leave a closed run or orphan successor', (t) => {
  const { store, run, send } = setup(t);
  send(1);
  store.db.exec("CREATE TRIGGER reject_sample BEFORE INSERT ON samples BEGIN SELECT RAISE(ABORT,'disk simulation'); END");
  assert.throws(() => send(2, { reg: 0 }), /disk simulation/);
  assert.equal(store.active().id, run.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(run.id).ended_ms, null);
  assert.equal(store.events({ id: run.id }).items.filter((e) => e.type === 'run_ended').length, 0);
});

test('default history includes assigned samples sharing the boundary millisecond', (t) => {
  const { store, run, send } = setup(t);
  send(1, { at: START + 1000 });
  const next = send(2, { reg: 0, at: START + 1000 });
  assert.equal(store.samples({ id: run.id }).items.length, 1);
  assert.equal(store.samples({ id: next.run_id }).items.length, 1);
  assert.equal(store.samples({ id: run.id, end: START + 1000 }).items.length, 0);
});

test('unknown mode never makes a source transition end a run', () => {
  assert.equal(transition({ current_mode: 'debug', current_source: 'pv' }, null, 'bat_secondary').rotate, false);
});

test('a second recorder cannot interrupt a live owner of the same database', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-owner-'));
  const file = join(dir, 'runs.sqlite');
  const first = new RunStore(file, START);
  t.after(() => { first.close(); rmSync(dir, { recursive: true, force: true }); });
  const run = first.start({ name: 'Owner', envelope: envelope(1), now: START });
  assert.throws(() => new RunStore(file), /Another recorder/);
  assert.equal(first.active().id, run.id);
});

test('SQLite backup restores committed WAL data without changing the active acquisition', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-backup-'));
  const source = join(dir, 'source.sqlite'), backup = join(dir, 'backup.sqlite');
  const store = new RunStore(source, START);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const run = store.start({ name: 'Backup', envelope: envelope(1), now: START });
  store.ingest({ envelope: envelope(1), rawBase64: 'preserved' });
  execFileSync(process.execPath, [fileURLToPath(new URL('../tools/backup-recordings.mjs', import.meta.url)), source, backup]);
  assert.equal(store.active().id, run.id);
  const restored = new RunStore(backup, START + 5000);
  try {
    assert.equal(restored.get(run.id).status, 'interrupted');
    assert.equal(restored.samples({ id: run.id }).items[0].raw_base64, 'preserved');
  } finally { restored.close(); }
});
