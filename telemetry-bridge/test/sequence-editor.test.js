import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeBlock, moveBlock, validateDraft, cloneSequence, comparison, BLOCKS } from '../../site/assets/js/sequence-editor-model.mjs';
import { CONDITION_REGISTERS, CONDITION_FAULTS, DEVICE_LABELS } from '../../site/assets/js/sequence-condition-fields.mjs';

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
    readFile(new URL('../../site/modules/sequences.html', import.meta.url), 'utf8'),
    readFile(new URL('../../site/assets/js/sequences.js', import.meta.url), 'utf8')
  ]);
  assert.match(index, /data-route="sequences"/);
  assert.match(router, /sequences: initSequencesPage/);
  for (const id of ['seqPaletteList', 'seqCanvas', 'seqValidation', 'seqSaved', 'seqSave', 'seqSimulate', 'seqLive', 'seqPause', 'seqResume', 'seqStop', 'seqProgress', 'seqEvents']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(script, /\/sequences\/\$\{encodeURIComponent\(draft.id\)\}\/preflight/);
  assert.match(script, /\/sequence-executions\/\$\{id\}\/events\?after=/);
  assert.match(script, /canOperate\(\)/);
  assert.match(index, /data-route="sequences">Visual Codes<\/a>/);
  assert.match(html, /Visual Codes/);
  assert.equal(BLOCKS.find(([type]) => type === 'waitUntil')[1], 'Wait for value');
  assert.deepEqual(Object.keys(DEVICE_LABELS), ['0x08', '0x40', '0x6B']);
  assert.match(DEVICE_LABELS['0x6B'], /MPPT \/ BQ25798 \(0x6B\)/);
  assert.match(script, /DEVICE_LABELS\[addr\]/);
  const css = await readFile(new URL('../../site/assets/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.nav-links\s*\{[^}]*justify-content:\s*flex-start;[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
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
  assert.equal(CONDITION_REGISTERS.length, 7);
  assert.equal(CONDITION_FAULTS.length, 8);
});
