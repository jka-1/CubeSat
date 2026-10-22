import test from 'node:test';
import assert from 'node:assert/strict';
import { SeqTracker, seqDelta } from '../lib/stats.mjs';
import { parseHexPacket, buildV4, KNOWN_GOOD_V4 } from '../lib/packet.mjs';

const feed = (seqs, period = 1000) => { const t = new SeqTracker({ expectedPeriodMs: period }); seqs.forEach((s, i) => t.add({ seq: s, arrivalMs: i * period, bytes: 80 })); return t.summary(); };

test('known-good README v4 packet parses (seq 0x03B3 = 947)', () => {
  const p = parseHexPacket(KNOWN_GOOD_V4); assert.equal(p.kind, 'telemetry'); assert.equal(p.version, 4); assert.equal(p.seq, 947);
  assert.equal(buildV4(947), KNOWN_GOOD_V4);
});
test('rejects bad magic / wrong length', () => {
  assert.equal(parseHexPacket('4354' + KNOWN_GOOD_V4.slice(4)).kind, 'invalid');
  assert.equal(parseHexPacket(KNOWN_GOOD_V4.slice(0, -4)).kind, 'invalid');
});
test('clean stream', () => { const s = feed([1, 2, 3, 4, 5]); assert.equal(s.lost, 0); assert.equal(s.loss_pct, 0); assert.equal(s.inter_arrival_ms.p50, 1000); });
test('gaps counted', () => { const s = feed([1, 2, 5, 6, 10]); assert.equal(s.lost, 5); assert.equal(s.gap_events, 2); assert.equal(s.max_gap, 3); assert.equal(s.expected_seq, 10); });
test('duplicate', () => { const s = feed([1, 2, 2, 3]); assert.equal(s.duplicates, 1); assert.equal(s.lost, 0); });
test('reorder recovers provisional loss', () => { const s = feed([1, 2, 4, 3, 5]); assert.equal(s.out_of_order, 1); assert.equal(s.lost, 0); assert.equal(s.late_recovered, 1); });
test('16-bit wrap skips 0', () => { assert.equal(seqDelta(65535, 1), 1); const s = feed([65534, 65535, 1, 2]); assert.equal(s.lost, 0); assert.equal(s.seq_resets, 0); });
test('wrap with loss', () => { const s = feed([65534, 2]); assert.equal(s.lost, 2); });
test('reboot (restart at 1) is a reset, not loss', () => { const s = feed([500, 501, 502, 1, 2, 3]); assert.equal(s.seq_resets, 1); assert.equal(s.lost, 0); });
test('outage detection', () => { const t = new SeqTracker(); [0, 1000, 2000, 9000, 10000].forEach((ms, i) => t.add({ seq: i + 1, arrivalMs: ms })); const s = t.summary(); assert.equal(s.outages, 1); assert.equal(s.longest_outage_ms, 7000); });
