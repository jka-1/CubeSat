// Debug Mode page helpers: sequence syntax (page + Windows i2c-tools syntax) -> bridge commands.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSequenceLine, formatScanGrid, describeResult } from '../../site/assets/js/debug-commands.mjs';

test('sequence lines map to bridge commands', () => {
  assert.equal(parseSequenceLine('  # comment'), null);
  assert.deepEqual(parseSequenceLine('delay 2 s'), { kind: 'delay', ms: 2000 });
  assert.deepEqual(parseSequenceLine('debug on').body, { type: 'debug_control', enabled: true });
  assert.deepEqual(parseSequenceLine('period 250').body, { type: 'set_scan_period', period_ms: 250 });
  assert.throws(() => parseSequenceLine('period 100'));
  assert.deepEqual(parseSequenceLine('scan').body, { type: 'i2c_scan' });
  assert.deepEqual(parseSequenceLine('i2cdetect').body, { type: 'i2c_scan' });
  assert.deepEqual(parseSequenceLine('probe 0x6b').body, { type: 'i2c_probe', addr: '0x6B' });
  assert.deepEqual(parseSequenceLine('read 0x40 0xfe').body, { type: 'i2c_read', addr: '0x40', reg: '0xFE', len: 2 });
  assert.deepEqual(parseSequenceLine('write 0x40 0x05 0x0a 0').body, { type: 'i2c_write', addr: '0x40', reg: '0x05', data: ['0x0A', '0x00'] });
  assert.deepEqual(parseSequenceLine('i2cget -c 0x08 -r 0x14 -l 2').body, { type: 'i2c_read', addr: '0x08', reg: '0x14', len: 2 });
  assert.deepEqual(parseSequenceLine('i2cset -c 0x08 -r 0x3e 0x22 0x00').body, { type: 'i2c_write', addr: '0x08', reg: '0x3E', data: ['0x22', '0x00'] });
  assert.deepEqual(parseSequenceLine('i2cconfig --scl=2 --sda=1'), { kind: 'config' });
  assert.throws(() => parseSequenceLine('bogus 1'));
});

test('scan grid and result text', () => {
  const g = formatScanGrid(['0x08', '0x40', '0x6B']).split('\n');
  assert.equal(g.length, 9);
  assert.match(g[1], /^00: {25}08 -- /);
  assert.match(g[5], /^40: 40 --/);
  assert.match(g[7], /6b/);
  assert.equal(describeResult({ type: 'i2c_probe' }, { status: 'completed', result: { addr: '0x6B', present: false, probe_result: 'ESP_ERR_NOT_FOUND' } }), 'probe 0x6B: no ACK (ESP_ERR_NOT_FOUND)');
  assert.equal(describeResult({ type: 'i2c_read' }, { status: 'failed', result: { error: 'ESP_FAIL' } }), 'failed ESP_FAIL');
});
