import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../recording/store.mjs';
import { cloneSequence } from '../../site/assets/js/sequence-editor-model.mjs';
const definition = (id) => ({ schemaVersion: 1, id, name: id, steps: [{ id: `${id}-note`, type: 'message', message: id }] });
const ids = (store) => store.sequenceList().map((item) => item.id);
const move = (store, id, before_id = null, expected_version = store.sequenceLibrary().order.version) => store.sequenceMove({ id, before_id, expected_version });

test('shared stable-ID order survives revisions, rename, duplication, deletion and bridge reopen', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'library-order-')), file = join(dir, 'runs.sqlite');
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  let store = new RunStore(file); t.after(() => store.close());
  const a = store.sequenceSave({ definition: definition('a'), now: 10 });
  const b = store.sequenceSave({ definition: definition('b'), now: 20 });
  store.sequenceSave({ definition: definition('c'), now: 30 });
  assert.deepEqual(ids(store), ['a', 'b', 'c'], 'new definitions append');
  move(store, 'c', 'a');
  const before = store.sequenceLibrary().order;
  store.sequenceSave({ definition: { ...a, name: 'Renamed', steps: [{ ...a.steps[0], message: 'new revision' }] }, expectedRevision: 1, now: 100 });
  assert.deepEqual(store.sequenceLibrary().order, before, 'rename and revision do not change order/version');
  const copy = cloneSequence(b); copy.id = 'duplicate';
  store.sequenceSave({ definition: copy, now: 110 });
  assert.deepEqual(ids(store), ['c', 'a', 'b', 'duplicate']);
  store.sequenceDelete({ id: 'a', expectedRevision: 2 });
  assert.deepEqual(ids(store), ['c', 'b', 'duplicate']);
  store.close(); store = new RunStore(file);
  assert.deepEqual(ids(store), ['c', 'b', 'duplicate']);
  assert.equal(store.sequenceGet({ id: 'a', revision: 1 }).name, 'a');
});

test('concurrent moves and membership changes reject stale versions without dropping any ID', (t) => {
  const store = new RunStore(':memory:'); t.after(() => store.close());
  for (const id of ['a', 'b', 'c']) store.sequenceSave({ definition: definition(id) });
  const sessionA = store.sequenceLibrary(), sessionB = store.sequenceLibrary();
  move(store, 'c', 'a', sessionA.order.version);
  assert.throws(() => move(store, 'b', 'c', sessionB.order.version), { statusCode: 409 });
  assert.deepEqual(ids(store), ['c', 'a', 'b']);
  move(store, 'b', 'c'); // explicit retry against latest version retains the other operator's move
  const stale = store.sequenceLibrary().order.version;
  store.sequenceSave({ definition: definition('d') });
  assert.throws(() => move(store, 'c', null, stale), { statusCode: 409 });
  assert.deepEqual(ids(store), ['b', 'c', 'a', 'd']);
  move(store, 'c'); assert.deepEqual(ids(store), ['b', 'a', 'd', 'c']);
  const version = store.sequenceLibrary().order.version;
  store.sequenceDelete({ id: 'b', expectedRevision: 1 });
  assert.throws(() => move(store, 'a', 'b', version), { statusCode: 409 });
  assert.throws(() => move(store, 'a', 'b'), { statusCode: 409 });
  assert.throws(() => move(store, 'deleted', 'a'), { statusCode: 409 });
  assert.deepEqual(ids(store), ['a', 'd', 'c']);
  for (const body of [{}, { id: 'a', before_id: null, expected_version: -1 }, { id: [], before_id: null, expected_version: 1 }]) assert.throws(() => store.sequenceMove(body), { statusCode: 400 });
});

test('legacy order seeds once without the former 100-item truncation; revisions and historical snapshots stay byte-identical', (t) => {
  const store = new RunStore(':memory:'); t.after(() => store.close());
  const insert = store.db.prepare('INSERT INTO sequences VALUES(?,?,?,?,?)');
  for (let i = 0; i < 125; i++) {
    const value = { ...definition(`d${i}`), revision: 1 };
    insert.run(value.id, 1, value.name, JSON.stringify(value), i);
    store.db.prepare('INSERT INTO sequence_revisions VALUES(?,?,?)').run(value.id, 1, JSON.stringify(value));
  }
  assert.equal(ids(store).length, 125);
  assert.equal(ids(store)[0], 'd124');
  const parent = store.sequenceSave({ definition: { ...definition('parent'), steps: [{ id: 'pinned', type: 'runSaved', sequenceId: 'd0', revision: 1 }] } });
  const snapshot = store.sequenceSnapshot({ id: parent.id });
  store.sequenceStart({ id: 'history', definition: snapshot, mode: 'simulation', started_ms: 1 });
  store.sequenceState({ id: 'history', state: 'completed', ended_ms: 2 });
  const rows = () => ({ revisions: store.db.prepare('SELECT * FROM sequence_revisions ORDER BY id,revision').all(), definitions: store.db.prepare('SELECT * FROM sequences ORDER BY id').all(), executions: store.db.prepare('SELECT * FROM sequence_executions').all(), events: store.db.prepare('SELECT * FROM sequence_events').all() });
  const before = rows();
  move(store, 'd0', 'd124');
  assert.deepEqual(rows(), before);
  assert.deepEqual(store.sequenceSnapshot({ id: parent.id }), snapshot);
  assert.equal(store.sequenceListExecutions().length, 1, 'reorder starts no execution');
});

test('storage failure rolls back order and version together', (t) => {
  const store = new RunStore(':memory:'); t.after(() => store.close());
  for (const id of ['a', 'b']) store.sequenceSave({ definition: definition(id) });
  const before = store.sequenceLibrary();
  store.db.exec("CREATE TRIGGER fail_order BEFORE UPDATE ON sequence_library_order BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");
  assert.throws(() => move(store, 'b', 'a'), /fixture disk failure/);
  assert.deepEqual(store.sequenceLibrary(), before);
  store.db.exec('DROP TRIGGER fail_order');
  assert.deepEqual(move(store, 'b', 'a').order.ids, ['b', 'a']);
});
