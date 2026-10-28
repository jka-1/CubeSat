import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseRegisterAddress, findRegister, validateRegisterWrite, registerWriteFeedback, commandErrorDetail
} from '../../site/assets/js/register-policy.mjs';

const map = JSON.parse(await readFile(new URL('../../site/assets/data/register-map.json', import.meta.url)));

test('0x14 is read-only cell voltage on BMS and writable charger control on MPPT', () => {
  assert.equal(findRegister(map, '0x08', '0x14').name, 'Cell 1 Voltage');
  assert.equal(findRegister(map, '0x08', '0x14').access, 'R');
  assert.equal(findRegister(map, '0x6B', '0x14').name, 'REG14 Charger Control 5');
  assert.equal(validateRegisterWrite(map, '0x6B', '0x14', ['0x16']).width, 1);
  assert.throws(() => validateRegisterWrite(map, '0x08', '0x14', ['0x00', '0x00']), /not approved/);
});

test('custom addresses are parsed strictly; writes need a defined writable register and exact width', () => {
  assert.equal(parseRegisterAddress('0x5'), '0x05');
  for (const invalid of ['', '0xGG', '0x100', '-1', '20']) {
    assert.throws(() => parseRegisterAddress(invalid), /hexadecimal/);
  }
  assert.equal(validateRegisterWrite(map, '0x40', '0x05', ['0x0A', '0x00']).access, 'RW');
  assert.throws(() => validateRegisterWrite(map, '0x40', '0x05', ['0x0A']), /exactly 2/);
  assert.throws(() => validateRegisterWrite(map, '0x40', '0x10', ['0x01']), /not approved/);
  assert.throws(() => validateRegisterWrite(map, '0x6B', '0x14', ['0x56']), /reserved/);
});

test('write feedback distinguishes accepted, ESP32 acknowledgment, rejection, and timeout', () => {
  assert.match(registerWriteFeedback({ status: 'pending' }), /awaiting ESP32/);
  assert.match(registerWriteFeedback({ status: 'completed', result: { ok: true } }), /not read back/);
  assert.doesNotMatch(registerWriteFeedback({ status: 'completed' }), /acknowledged/);
  assert.match(registerWriteFeedback({ status: 'failed', result: { error: 'ESP_FAIL' } }), /ESP_FAIL/);
  assert.match(registerWriteFeedback({ status: 'timed_out' }), /outcome is unknown/);
  assert.doesNotMatch(commandErrorDetail('/private/config/secret'), /private|secret/);
});
