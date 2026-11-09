import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeBlock, moveBlock, validateDraft, cloneSequence, comparison, BLOCKS, parseUserRegister } from '../../site/assets/js/sequence-editor-model.mjs';
import { CONDITION_REGISTERS, CONDITION_FAULTS, DEVICE_LABELS } from '../../site/assets/js/sequence-condition-fields.mjs';
import { READABLE_REGISTERS } from '../../site/assets/js/sequence-register-catalog.mjs';
import { READABLE_REGISTERS as BRIDGE_REGISTERS } from '../sequence/register-catalog.mjs';

const definition = (steps) => ({ schemaVersion: 1, name: 'Bench check', steps });

test('editor blocks match bridge shape and validate branches and units', () => {
  const branch = makeBlock('if');
  const draft = definition([branch]);
  assert.match(validateDraft(draft).join(' '), /TRUE path is disconnected/);
  assert.match(validateDraft(draft).join(' '), /FALSE path is disconnected/);
  branch.then.push(makeBlock('registerRead'));
  branch.else.push(makeBlock('registerWrite'));
  assert.deepEqual(validateDraft(draft), []);
  branch.condition.right.unit = 'A';
  assert.match(validateDraft(draft).join(' '), /types or formats must match/);
  branch.condition = { op: 'AND', conditions: [comparison(), { op: 'NOT', condition: comparison() }] };
  assert.deepEqual(validateDraft(draft), []);
  branch.then[0].command.len = 1;
  assert.match(validateDraft(draft).join(' '), /supported register and width/);
});

test('drag move prevents a block entering its own branch and cloning resets IDs', () => {
  const branch = makeBlock('if');
  branch.then.push(makeBlock('delay'));
  branch.else.push(makeBlock('command'));
  const steps = [makeBlock('command'), branch];
  assert.equal(moveBlock(steps, [], steps[0].id, [{ id: branch.id, branch: 'then' }], 1), true);
  assert.equal(branch.then.length, 2);
  assert.equal(moveBlock(steps, [], branch.id, [{ id: branch.id, branch: 'then' }], 0), false);
  const copy = cloneSequence(definition(steps));
  assert.equal(copy.id, undefined);
  assert.notEqual(copy.steps[0].id, branch.id);
  assert.deepEqual(validateDraft(copy), []);
});

test('route exposes palette, canvas, persistence and execution controls', async () => {
  const [index, router, html, script] = await Promise.all([
    readFile(new URL('../../site/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../site/assets/js/router.js', import.meta.url), 'utf8'),
    readFile(new URL('../auth/views/sequences.html', import.meta.url), 'utf8'),
    readFile(new URL('../../site/assets/js/sequences.js', import.meta.url), 'utf8')
  ]);
  assert.match(index, /data-route="sequences"/);
  assert.match(router, /sequences: initSequencesPage/);
  for (const id of ['seqPaletteList', 'seqCanvas', 'seqValidation', 'seqSaved', 'seqSave', 'seqSimulate', 'seqLive', 'seqPause', 'seqResume', 'seqStop', 'seqProgress', 'seqEvents']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /\/sequences\/\$\{encodeURIComponent\(draft.id\)\}\/preflight/);
  assert.match(script, /\/sequence-executions\/\$\{id\}\/events\?after=/);
  assert.match(script, /canOperate\(\)/);
  assert.match(index, /data-route="sequences"[^>]*>Branch Definition<\/a>/);
  assert.match(html, /Branch Definition/);
  assert.equal(BLOCKS.find(([type]) => type === 'waitUntil')[1], 'Wait for value');
  assert.deepEqual(Object.keys(DEVICE_LABELS), ['0x08', '0x40', '0x6B']);
  assert.match(DEVICE_LABELS['0x6B'], /MPPT \/ BQ25798 \(0x6B\)/);
  assert.match(script, /DEVICE_LABELS\[addr\]/);
  const css = await readFile(new URL('../../site/assets/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.nav-links\s*\{[^}]*justify-content:\s*center;[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
});

test('editor validates register and fault comparisons with explicit formats', () => {
  const wait = makeBlock('waitUntil');
  wait.condition = { op: '==', left: { register: 'mppt.fault20' }, right: { constant: 0x20, unit: 'hex' } };
  assert.deepEqual(validateDraft(definition([wait])), []);
  wait.condition.right.unit = 'V';
  assert.match(validateDraft(definition([wait])).join(' '), /types or formats must match/);
  wait.condition.right = { constant: 0x20, unit: 'hex' };
  wait.condition.left = { fault: 'CONV_OCP_STAT' };
  assert.match(validateDraft(definition([wait])).join(' '), /types or formats must match/);
  wait.condition.right = { constant: true, unit: 'boolean' };
  assert.deepEqual(validateDraft(definition([wait])), []);
  wait.condition.op = '>';
  assert.match(validateDraft(definition([wait])).join(' '), /support == and != only/);
  assert.equal(CONDITION_REGISTERS.length, READABLE_REGISTERS.length + 7);
  assert.equal(CONDITION_FAULTS.length, 8);
});

test('every register read option is also a valid comparison operand', async () => {
  const map = JSON.parse(await readFile(new URL('../../site/assets/data/register-map.json', import.meta.url), 'utf8'));
  const expected = map.devices.flatMap((device) => device.registers.map((register) => `${device.addr}:${register.addr}`));
  assert.deepEqual(new Set(READABLE_REGISTERS.map((item) => item.id)), new Set(expected));
  assert.deepEqual(READABLE_REGISTERS.map(({ id, addr, group, reg, len, endian }) => ({ id, addr, group, reg, len, endian })), BRIDGE_REGISTERS);
  for (const item of READABLE_REGISTERS) {
    const wait = makeBlock('waitUntil');
    wait.condition = { op: '==', left: { register: item.id }, right: { constant: 0, unit: 'hex' } };
    assert.deepEqual(validateDraft(definition([wait])), [], item.id);
    const read = makeBlock('registerRead');
    read.command = { type: 'i2c_read', addr: item.addr, reg: item.reg, len: item.len };
    assert.deepEqual(validateDraft(definition([read])), [], item.id);
  }
});

test('editor adds user registers with hex range checks and validates references', () => {
  assert.deepEqual(parseUserRegister({ addr: '48', reg: '0x0', len: 2, endian: 'big', label: 'Temp' }).entry,
    { id: 'user-48-00-2', addr: '0x48', reg: '0x00', len: 2, endian: 'big', label: 'Temp' });
  for (const addr of ['0x07', '0x78', '0x80', 'zz', '']) assert.match(parseUserRegister({ addr, reg: '0x00' }).errors.join(' '), /7-bit/);
  for (const reg of ['0x100', 'g1', '']) assert.match(parseUserRegister({ addr: '0x48', reg }).errors.join(' '), /0x00–0xFF/);
  assert.match(parseUserRegister({ addr: '0x48', reg: '0x00', len: 3 }).errors.join(' '), /Width/);
  const branch = makeBlock('if');
  branch.then.push(makeBlock('delay')); branch.else.push(makeBlock('delay'));
  branch.condition = { op: '>', left: { register: 'user-48-00-2' }, right: { constant: 0x10, unit: 'hex' } };
  const draft = definition([branch]);
  assert.match(validateDraft(draft).join(' '), /valid telemetry, register/);
  draft.registers = [parseUserRegister({ addr: '0x48', reg: '0x00', len: 2 }).entry];
  assert.deepEqual(validateDraft(draft), []);
  draft.registers.push({ ...draft.registers[0] });
  assert.match(validateDraft(draft).join(' '), /duplicate/);
});

test('remoteChange flags a newer saved revision of the loaded definition', async () => {
  const { remoteChange } = await import('../../site/assets/js/sequence-editor-model.mjs');
  const list = [{ id: 'a', name: 'A', revision: 3 }, { id: 'b', name: 'B', revision: 1 }];
  assert.deepEqual(remoteChange({ id: 'a', revision: 2 }, list), { id: 'a', name: 'A', revision: 3 });
  assert.equal(remoteChange({ id: 'a', revision: 3 }, list), null);
  assert.equal(remoteChange({ revision: 1 }, list), null);
  assert.equal(remoteChange({ id: 'z', revision: 1 }, list), null);
});
