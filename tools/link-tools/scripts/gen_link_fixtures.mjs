// Generates shared synthetic fixtures for link-stats parity tests (JS site module, Python app, tools).
// node gen_link_fixtures.mjs <site link-stats.mjs path> > link_fixtures.json
import { SeqTracker } from '../lib/stats.mjs';
const site = await import(process.argv[2]);
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function make({ n, period = 1000, start = 1, drop = [], dup = [], reorder = [], rebootAt = null, jitter = 0, lossPct = 0, rssi = false, outageAt = null, outageMs = 0, cmdEvery = 0 }) {
  const ev = []; const cmds = []; let t = 1_700_000_000_000; let seq = start; let held = null;
  for (let i = 0; i < n; i++) {
    const cur = seq; seq = seq >= 65535 ? 1 : seq + 1; if (rebootAt !== null && cur === rebootAt) seq = 1;
    t += period + (jitter ? Math.round((rnd() * 2 - 1) * jitter) : 0);
    if (outageAt !== null && cur === outageAt) t += outageMs;
    const e = (s) => ({ t, seq: s, bytes: rssi ? 104 : 80, ...(rssi ? { rssi: -45 - Math.round(rnd() * 25) } : {}) });
    if (drop.includes(cur) || (lossPct && rnd() * 100 < lossPct)) continue;
    if (reorder.includes(cur)) { held = cur; continue; }
    ev.push(e(cur)); if (held !== null) { t += 3; ev.push(e(held)); held = null; } if (dup.includes(cur)) { t += 2; ev.push(e(cur)); }
    if (cmdEvery && i % cmdEvery === 0) { const r = rnd(); cmds.push({ t: t + 50, status: r < 0.1 ? 'timed_out' : r < 0.15 ? 'failed' : 'completed', rtt: r < 0.1 ? null : 15 + Math.round(rnd() * 200) }); }
  }
  return { events: ev, commands: cmds, period };
}
const cases = {
  clean: make({ n: 120 }),
  gaps_dups_reorder: make({ n: 300, drop: [5, 6, 40, 41, 42, 200], dup: [10, 150], reorder: [20, 99], jitter: 40, cmdEvery: 7 }),
  wrap: make({ n: 100, start: 65500, drop: [65535, 3] }),
  reboot_outage: make({ n: 200, start: 900, rebootAt: 980, outageAt: 30, outageMs: 12000, cmdEvery: 5 }),
  random_loss_rssi_fast: make({ n: 1500, period: 200, lossPct: 3, jitter: 30, rssi: true, cmdEvery: 11 }),
};
const windows = [60_000, 300_000, 900_000, 3_600_000];
const out = { generated_by: 'gen_link_fixtures.mjs', cases: [] };
for (const [name, c] of Object.entries(cases)) {
  // tools reference (whole stream) must equal site module (window covering everything)
  const tr = new SeqTracker({ expectedPeriodMs: c.period });
  c.events.forEach((e) => tr.add({ seq: e.seq, arrivalMs: e.t, bytes: e.bytes, link: Number.isFinite(e.rssi) ? { rssi_dbm: e.rssi } : null }));
  const ref = tr.summary();
  const full = site.analyzeWindow(c.events, c.commands, { periodMs: c.period, windowMs: 1e12, now: c.events.at(-1).t });
  const { commands: _c, ...fullNoCmd } = full.summary;
  if (JSON.stringify(fullNoCmd) !== JSON.stringify(ref)) { console.error('MISMATCH tools vs site', name); process.exit(1); }
  const expected = {};
  for (const w of windows) {
    const r = site.analyzeWindow(c.events, c.commands, { periodMs: c.period, windowMs: w, now: c.events.at(-1).t });
    expected[w] = { summary: r.summary, series: r.series };
  }
  out.cases.push({ name, period: c.period, events: c.events, commands: c.commands, expected });
}
console.log(JSON.stringify(out));
