import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('run explorer route exposes graph, packet table, events, and recording controls', async () => {
  const [index, router, html, script] = await Promise.all([
    readFile(path.join(root, 'site/index.html'), 'utf8'),
    readFile(path.join(root, 'site/assets/js/router.js'), 'utf8'),
    readFile(path.join(root, 'site/modules/runs.html'), 'utf8'),
    readFile(path.join(root, 'site/assets/js/runs.js'), 'utf8')
  ]);
  assert.match(index, /data-route="runs"/);
  assert.match(router, /runs:\s*initRunsPage/);
  for (const id of ['runStartForm', 'runStop', 'analysisMode', 'responseTrigger', 'responseBefore',
    'responseAfter', 'responseSummary', 'seriesChart', 'exportCsv', 'sampleRows', 'eventRows']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /apiFetch\(API/);
  assert.match(script, /canOperate\(\)/);
  assert.match(script, /\/series\?/);
  assert.match(script, /\/samples\?/);
  assert.match(script, /\/events\?/);
  assert.match(script, /sequence_step: 'Sequence step'/);
  assert.match(script, /device_reboot: 'Device reboot'/);
  assert.match(script, /new Blob\(\[rows\.join/);
  assert.match(script, /MAX_CSV_ROWS/);
  assert.match(script, /details\.sequence_name/);
  assert.match(script, /responseWindow\(trigger\.at_ms/);
  assert.match(script, /formatRelativeTime/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});
