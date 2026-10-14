// Link-health statistics for the dashboard. Ported verbatim from
// CubeSat-ref-tools/lib/stats.mjs (link_monitor.mjs) and mirrored in the Windows app
// (cubesat_i2c/link_stats.py). Keep all three identical; shared fixtures verify it.
export const SEQ_MOD = 65535; // values 1..65535

// forward distance from a to b on the 1..65535 ring
export function seqDelta(a, b) {
  const d = ((b - 1) - (a - 1) + SEQ_MOD) % SEQ_MOD;
  return d;
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export class SeqTracker {
  constructor({ expectedPeriodMs = 1000, resetThreshold = 1000, outageFactor = 3, reorderWindow = 64 } = {}) {
    Object.assign(this, { expectedPeriodMs, resetThreshold, outageFactor, reorderWindow });
    this.highest = null; this.seen = new Set(); this.lastArrival = null; this.lastTransit = null;
    this.firstArrival = null; this.received = 0; this.unique = 0; this.lost = 0; this.dup = 0;
    this.reorder = 0; this.recoveredLate = 0; this.resets = 0; this.bytes = 0; this.expected = 0;
    this.jitter = 0; this.interArrivals = []; this.outages = []; this.gapEvents = []; this.missing = new Set();
    this.link = [];
  }

  // arrivalMs: local receive time. Returns per-packet row.
  add({ seq, arrivalMs, bytes = 0, link = null }) {
    const row = { seq, arrival_ms: arrivalMs, bytes, delta_seq: '', gap: 0, duplicate: 0, out_of_order: 0,
      reset: 0, inter_arrival_ms: '', jitter_ms: '' };
    this.received++; this.bytes += bytes;
    if (this.firstArrival === null) this.firstArrival = arrivalMs;
    if (this.lastArrival !== null) {
      const ia = arrivalMs - this.lastArrival;
      row.inter_arrival_ms = ia; this.interArrivals.push(ia);
      // RFC 3550-style jitter vs. nominal send period (no tx timestamp in v4).
      const D = Math.abs(ia - this.expectedPeriodMs);
      this.jitter += (D - this.jitter) / 16; row.jitter_ms = +this.jitter.toFixed(3);
      if (ia > this.outageFactor * this.expectedPeriodMs) this.outages.push({ start_ms: this.lastArrival, duration_ms: ia });
    }
    this.lastArrival = arrivalMs;
    if (link) this.link.push(link);

    if (seq === null || seq === undefined) return row;
    if (this.highest === null) {
      this.highest = seq; this.seen.add(seq); this.unique++; this.expected = 1; return row;
    }
    const d = seqDelta(this.highest, seq);
    row.delta_seq = d;
    if (d === 0) { this.dup++; row.duplicate = 1; return row; }
    const back = seqDelta(seq, this.highest);
    if (back < d) {
      // seq is "behind" the highest seen
      if (back <= this.reorderWindow) {
        if (this.missing.delete(seq)) {
          this.lost--; this.recoveredLate++; this.reorder++; row.out_of_order = 1; this.seen.add(seq); this.unique++;
        } else if (this.seen.has(seq)) { this.dup++; row.duplicate = 1; }
        else { this.reorder++; row.out_of_order = 1; this.seen.add(seq); this.unique++; }
        return row;
      }
      // far behind: sequence restarted (MCU reboot -> udp_transport_init sets next_sequence=1)
      this.resets++; row.reset = 1; this.highest = seq; this.seen = new Set([seq]); this.missing.clear();
      this.unique++; this.expected++; return row;
    }
    if (d >= this.resetThreshold) {
      // big jump: treat as MCU reboot / sequence restart, not loss
      this.resets++; row.reset = 1; this.highest = seq; this.seen = new Set([seq]); this.missing.clear();
      this.unique++; this.expected++; return row;
    }
    if (d > 1) {
      row.gap = d - 1; this.lost += d - 1;
      this.gapEvents.push({ after_seq: this.highest, missing: d - 1, at_ms: arrivalMs });
      for (let k = 1; k < d; k++) this.missing.add(((this.highest - 1 + k) % SEQ_MOD) + 1);
    }
    this.expected += d; this.highest = seq; this.seen.add(seq); this.unique++;
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
    return row;
  }

  summary() {
    const ia = [...this.interArrivals].sort((a, b) => a - b);
    const mean = ia.length ? ia.reduce((s, v) => s + v, 0) / ia.length : null;
    const sd = ia.length ? Math.sqrt(ia.reduce((s, v) => s + (v - mean) ** 2, 0) / ia.length) : null;
    const durS = this.lastArrival !== null && this.firstArrival !== null ? (this.lastArrival - this.firstArrival) / 1000 : 0;
    const rssi = this.link.map((l) => l.rssi_dbm).filter((v) => Number.isFinite(v));
    const r = (v, n = 2) => (v === null || v === undefined ? null : +v.toFixed(n));
    return {
      packets_received: this.received, unique_seq: this.unique, expected_seq: this.expected,
      lost: this.lost, loss_pct: this.expected ? r(100 * this.lost / this.expected, 3) : null,
      duplicates: this.dup, out_of_order: this.reorder, late_recovered: this.recoveredLate, seq_resets: this.resets,
      gap_events: this.gapEvents.length, max_gap: this.gapEvents.reduce((m, g) => Math.max(m, g.missing), 0),
      duration_s: r(durS, 3), rate_pps: durS > 0 ? r((this.received - 1) / durS, 3) : null,
      throughput_Bps: durS > 0 ? r(this.bytes / durS, 1) : null, bytes: this.bytes,
      inter_arrival_ms: { mean: r(mean), stdev: r(sd), min: ia[0] ?? null, p50: percentile(ia, 50),
        p95: percentile(ia, 95), p99: percentile(ia, 99), max: ia[ia.length - 1] ?? null },
      rfc3550_jitter_ms: r(this.jitter, 3),
      outages: this.outages.length, longest_outage_ms: this.outages.reduce((m, o) => Math.max(m, o.duration_ms), 0),
      rssi_dbm: rssi.length ? { min: Math.min(...rssi), max: Math.max(...rssi),
        mean: r(rssi.reduce((s, v) => s + v, 0) / rssi.length, 1) } : null,
      last_link_counters: this.link.length ? this.link[this.link.length - 1] : null,
    };
  }
}

export function rttStats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return { count: v.length, min: v[0] ?? null, p50: percentile(v, 50), p95: percentile(v, 95),
    p99: percentile(v, 99), max: v.length ? v[v.length - 1] : null,
    mean: v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2) : null };
}

// events: [{t (ms), seq, bytes, rssi}] telemetry arrivals in arrival order
// commands: [{t, status, rtt}] finished command_status events
// Returns summary + per-packet rows + fixed-count time buckets for graphs.
export function analyzeWindow(events, commands, { periodMs = 1000, windowMs = 300000, now = null, buckets = 60 } = {}) {
  const end = now ?? (events.length ? events[events.length - 1].t : 0);
  const start = end - windowMs;
  const tracker = new SeqTracker({ expectedPeriodMs: periodMs });
  const rows = [];
  for (const e of events) {
    if (e.t < start || e.t > end) continue;
    const link = Number.isFinite(e.rssi) ? { rssi_dbm: e.rssi } : null;
    const r = tracker.add({ seq: e.seq, arrivalMs: e.t, bytes: e.bytes || 0, link });
    rows.push({ ...r, rssi: Number.isFinite(e.rssi) ? e.rssi : null });
  }
  const bw = windowMs / buckets;
  const series = Array.from({ length: buckets }, (_, i) => ({ t: start + (i + 1) * bw, received: 0, lost: 0,
    duplicate: 0, out_of_order: 0, reset: 0, loss_pct: null, rtt: null, rssi: null }));
  const idx = (t) => Math.min(buckets - 1, Math.max(0, Math.floor((t - start) / bw)));
  const rssiAcc = new Map(); const rttAcc = new Map();
  for (const r of rows) {
    const b = series[idx(r.arrival_ms)];
    b.received++; b.lost += r.gap; b.duplicate += r.duplicate; b.out_of_order += r.out_of_order; b.reset += r.reset;
    if (r.rssi !== null) { const k = idx(r.arrival_ms); const a = rssiAcc.get(k) || []; a.push(r.rssi); rssiAcc.set(k, a); }
  }
  for (const [k, a] of rssiAcc) series[k].rssi = +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2);
  const cmds = commands.filter((c) => c.t >= start && c.t <= end);
  for (const c of cmds) if (Number.isFinite(c.rtt)) { const k = idx(c.t); const a = rttAcc.get(k) || []; a.push(c.rtt); rttAcc.set(k, a); }
  for (const [k, a] of rttAcc) series[k].rtt = Math.max(...a);
  for (const b of series) {
    const exp = b.received - b.duplicate + b.lost;
    b.loss_pct = exp > 0 ? +(100 * b.lost / exp).toFixed(3) : null;
  }
  const summary = tracker.summary();
  const ok = cmds.filter((c) => c.status === 'completed');
  summary.commands = {
    finished: cmds.length, completed: ok.length,
    failed: cmds.filter((c) => c.status === 'failed').length,
    timed_out: cmds.filter((c) => c.status === 'timed_out').length,
    rtt_ms: rttStats(ok.map((c) => c.rtt)),
  };
  return { summary, rows, series, start, end };
}
