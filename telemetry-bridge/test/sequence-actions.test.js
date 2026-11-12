import test from 'node:test';
import assert from 'node:assert/strict';
import { saveDefinition, deleteDefinition, confirmDiscard, hasUnsavedChanges } from '../../site/assets/js/sequence-actions.mjs';

const draft = () => ({ schemaVersion: 1, id: 'bench', revision: 2, name: 'Bench', steps: [{ id: 'note', type: 'message', message: 'unsaved <text>' }] });
const conflict = (revision) => Object.assign(new Error('conflict'), { status: 409, data: { code: 'revision_conflict', current: { id: 'bench', revision, name: 'Other operator edit' } } });
test('cancel overwrite, deletion and discard makes no mutation and preserves edited content', async () => {
  const value = draft(), before = structuredClone(value);
  let requests = 0;
  const request = async () => { requests++; };
  assert.equal(await saveDefinition(value, request, () => false), null);
  assert.equal(await deleteDefinition(value, request, () => false), false);
  assert.equal(confirmDiscard(value, null, () => false), false);
  assert.equal(requests, 0);
  assert.deepEqual(value, before);
  let prompts = 0;
  assert.equal(confirmDiscard(value, JSON.stringify(value), () => { prompts++; }), true);
  assert.equal(prompts, 0, 'clean definitions do not prompt');
  assert.equal(hasUnsavedChanges({ name: '', steps: [] }, null), false);
});
test('conflict Cancel neither reloads nor changes the draft revision or edits', async () => {
  const value = draft(), before = structuredClone(value), prompts = [], requests = [];
  assert.equal(await saveDefinition(value, async (path, options) => { requests.push([path, options.method]); throw conflict(3); }, (message) => { prompts.push(message); return prompts.length === 1; }), null);
  assert.deepEqual(value, before);
  assert.deepEqual(requests, [['/sequences/bench', 'PUT']]);
  assert.match(prompts[1], /Other operator edit.*bench.*revision 3/s);
  assert.match(prompts[1], /Cancel keeps your edits/);
});
test('confirmed conflict retries against exactly the approved revision and rejects another race', async () => {
  const value = draft(), before = structuredClone(value), bodies = [];
  await assert.rejects(saveDefinition(value, async (_, options) => { bodies.push(JSON.parse(options.body)); throw conflict(bodies.length + 2); }, () => true), /conflict/);
  assert.deepEqual(bodies.map((body) => [body.revision, body.confirmed_revision]), [[2, 2], [3, 3]]);
  assert.deepEqual(value, before);
});
test('delete sends only the explicitly confirmed target revision and no discard prompt', async () => {
  let prompts = 0, sent;
  assert.equal(await deleteDefinition(draft(), async (path, options) => { sent = [path, options.method, JSON.parse(options.body)]; }, (message) => { prompts++; assert.match(message, /Bench.*bench.*revision 2/s); return true; }), true);
  assert.equal(prompts, 1);
  assert.deepEqual(sent, ['/sequences/bench', 'DELETE', { revision: 2, confirmed_revision: 2 }]);
});
