import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SERIES_WINDOW_MS, csvCell, formatDuration, formatRelativeTime, metricValue, nearestBucket,
  responseSummary, responseWindow, runMatches, seriesExtent, windowForPreset
} from '../../site/assets/js/runs-model.mjs';

const run = {
  id: 'run-a', name: 'Initialization test', device_id: 'esp32-a', run_type: 'live_telemetry',
  current_source: 'pv', status: 'completed', end_reason: 'source_switch',
  started_ms: 1_000, ended_ms: 101_000, last_received_ms: 100_000
};

test('run windows are bounded by the run and series query limit', () => {
  assert.deepEqual(windowForPreset(run, '30s'), { start: 71_000, end: 101_000 });
  assert.deepEqual(windowForPreset(run, 'full'), { start: 1_000, end: 101_000 });
  const long = { ...run, started_ms: 1_000, ended_ms: MAX_SERIES_WINDOW_MS * 2 };
  const window = windowForPreset(long, 'full');
  assert.equal(window.end - window.start, MAX_SERIES_WINDOW_MS);
});

test('run search covers operational fields and respects filters', () => {
  assert.equal(runMatches(run, 'initialization', 'all'), true);
  assert.equal(runMatches(run, 'source switch', 'all'), false);
  assert.equal(runMatches(run, 'source_switch', 'all'), true);
  assert.equal(runMatches(run, 'ESP32-A', 'live_telemetry'), true);
  assert.equal(runMatches(run, '', 'debug'), false);
});

test('metric lookup preserves unavailable values', () => {
  const sample = { envelope: { packet: { telemetry: {
    pv: { powerW: 2.5 }, bms: { cellVoltagesV: [3.7, null, 3.8, 3.9] }, peripheral: {}
  } } } };
  assert.equal(metricValue(sample, 'pv.powerW'), 2.5);
  assert.equal(metricValue(sample, 'bms.cell2V'), null);
  assert.equal(metricValue(sample, 'peripheral.temperatureC'), null);
});

test('chart helpers handle constant series and nearest bucket', () => {
  const points = [
    { start_ms: 0, end_ms: 10, min: 4, max: 4 },
    { start_ms: 10, end_ms: 20, min: null, max: null },
    { start_ms: 20, end_ms: 30, min: 4, max: 4 }
  ];
  const extent = seriesExtent(points);
  assert.ok(extent.min < 4 && extent.max > 4);
  assert.equal(nearestBucket(points, 26), points[2]);
  assert.equal(formatDuration(3_661_000), '1h 1m 1s');
});

test('trigger-aligned response windows and summaries preserve time-domain behavior', () => {
  assert.deepEqual(responseWindow(10_000, 500, 2_000), { start: 9_500, end: 12_000 });
  assert.throws(() => responseWindow(10_000, -1, 2_000), /valid response window/);
  assert.equal(formatRelativeTime(-250), 'T−250 ms');
  assert.equal(formatRelativeTime(1_250), 'T+1.25 s');
  const summary = responseSummary([
    { start_ms: 9_000, end_ms: 9_500, mean: 4, min: 3.9, max: 4.1, valid_count: 2 },
    { start_ms: 9_500, end_ms: 10_000, mean: 6, min: 5.9, max: 6.1, valid_count: 1 },
    { start_ms: 10_000, end_ms: 10_500, mean: 9, min: 8, max: 10, valid_count: 2 },
    { start_ms: 10_500, end_ms: 11_000, mean: 7, min: 6.5, max: 7.5, valid_count: 2 }
  ], 10_000);
  assert.equal(summary.baseline, (4 * 2 + 6) / 3);
  assert.equal(summary.initial, 9);
  assert.equal(summary.peak, 10);
  assert.equal(summary.delta, 10 - summary.baseline);
  assert.equal(summary.peak_at_ms, 250);
});

test('CSV cells preserve commas, quotes and newlines without formula interpretation', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"\nnext'), '"say ""hi""\nnext"');
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell(-2.5), '-2.5');
  assert.equal(csvCell(null), '');
});
