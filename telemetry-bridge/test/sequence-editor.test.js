import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeBlock, moveBlock, validateDraft, cloneSequence, comparison } from '../../site/assets/js/sequence-editor-model.mjs';

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
  assert.match(validateDraft(draft).join(' '), /units must match/);
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
});
