// Sequence / timing tracker for the 16-bit firmware sequence (udp_transport.c next_sequence_word):
// counts 1..65535 then wraps to 1 (0 is skipped); restarts at 1 when the MCU reboots.
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

export function formatSummary(s, title = 'Link summary') {
  const L = [`== ${title} ==`,
    `packets received   : ${s.packets_received} (unique seq ${s.unique_seq}, expected ${s.expected_seq})`,
    `lost (seq gaps)    : ${s.lost}  loss=${s.loss_pct}%  gap events=${s.gap_events} max gap=${s.max_gap}`,
    `duplicates / OOO   : ${s.duplicates} / ${s.out_of_order} (late-recovered ${s.late_recovered})`,
    `seq resets (reboot): ${s.seq_resets}`,
    `duration / rate    : ${s.duration_s}s  ${s.rate_pps} pkt/s  ${s.throughput_Bps} B/s`,
    `inter-arrival ms   : mean ${s.inter_arrival_ms.mean} sd ${s.inter_arrival_ms.stdev} min ${s.inter_arrival_ms.min} p50 ${s.inter_arrival_ms.p50} p95 ${s.inter_arrival_ms.p95} p99 ${s.inter_arrival_ms.p99} max ${s.inter_arrival_ms.max}`,
    `RFC3550 jitter ms  : ${s.rfc3550_jitter_ms}`,
    `outages (>3x per.) : ${s.outages}  longest ${s.longest_outage_ms} ms`];
  if (s.rssi_dbm) L.push(`RSSI dBm           : min ${s.rssi_dbm.min} mean ${s.rssi_dbm.mean} max ${s.rssi_dbm.max}`);
  if (s.last_link_counters) L.push(`fw counters (last) : ${JSON.stringify(s.last_link_counters)}`);
  return L.join('\n');
}
