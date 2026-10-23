import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SERIES_WINDOW_MS, formatDuration, metricValue, nearestBucket, runMatches,
  seriesExtent, windowForPreset
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
