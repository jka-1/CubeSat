import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../recording/store.mjs';
import { validateSequence } from '../sequence/model.mjs';
import { SequenceEngine } from '../sequence/engine.mjs';
import { validateDraft } from '../../site/assets/js/sequence-editor-model.mjs';
import { createRegisterRegistry, LEGACY_REGISTER_KEY } from '../../site/assets/js/register-registry.mjs';
import { mergeRegisters } from '../../site/assets/js/register-definition.mjs';

const entry = { addr: '0x6B', reg: '0x2A', len: 2, endian: 'little', label: 'Bench register' };
const normalized = { id: 'user-6B-2A-2', ...entry };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('registry commits merge additions, reject metadata conflicts, and survive a store reopen', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'register-store-')), file = join(dir, 'runs.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new RunStore(file);
  assert.deepEqual(store.registerAdd(entry), normalized);
  assert.deepEqual(store.registerAdd({ ...entry, addr: '6b', reg: '2a' }), normalized);
  store.registerAdd({ ...entry, reg: '0x2B' });
  for (const change of [{ len: 1 }, { endian: 'big' }, { label: 'Conflicting name' }]) {
    assert.throws(() => store.registerAdd({ ...entry, ...change }), { statusCode: 409 });
  }
  for (const change of [{ addr: '0x78' }, { len: 3 }, { endian: 'unknown' }, { access: 'RW' }, { label: '<'.repeat(61) }]) {
    assert.throws(() => store.registerAdd({ ...entry, ...change }), { statusCode: 400 });
  }
  for (const reg of ['0x2F', '0x30']) {
    assert.equal(store.registerAdd({ ...entry, reg, len: 1, endian: 'big' }).id, `0x6B:${reg}`);
    assert.throws(() => store.registerAdd({ ...entry, reg }), { statusCode: 409 });
  }
  assert.equal(store.registerList().length, 2, 'built-in retries do not add duplicate catalog rows');
  store.close(); store = new RunStore(file);
  assert.deepEqual(store.registerList()[0], normalized);
  assert.equal(store.registerList().length, 2);
  store.close();
});

test('mounted clients synchronize concurrent additions, navigation/reload, and legacy migration', async (t) => {
  const store = new RunStore(':memory:'); t.after(() => store.close());
  const request = async (method, input) => method === 'GET' ? { registers: store.registerList() } : { register: store.registerAdd(input) };
  const storage = new Map([[LEGACY_REGISTER_KEY, JSON.stringify([normalized])]]);
  const adapter = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  const a = createRegisterRegistry({ request, storage: adapter, intervalMs: 10 });
  const b = createRegisterRegistry({ request, intervalMs: 10 });
  t.after(() => { a.destroy(); b.destroy(); });
  let updates = 0;
  const unmount = a.subscribe(() => updates++), other = b.subscribe(() => {});
  await pause(40);
  assert.deepEqual(b.list(), [normalized]);
  assert.equal(storage.has(LEGACY_REGISTER_KEY), false);
  await Promise.all([a.add({ ...entry, reg: '0x2B' }), b.add({ ...entry, reg: '0x2C' }), a.add(entry), b.add(entry)]);
  await pause(40);
  assert.equal(a.list().length, 3); assert.equal(b.list().length, 3); assert.ok(updates > 0);
  const before = b.list();
  await assert.rejects(a.add({ ...entry, endian: 'big' }), { statusCode: 409 });
  assert.deepEqual(b.list(), before);
  unmount(); other();
  const reload = createRegisterRegistry({ request });
  await reload.refresh(); assert.deepEqual(reload.list(), store.registerList()); reload.destroy();
  const remount = a.subscribe(() => {});
  await b.add({ ...entry, reg: '0x2D' }); await pause(40);
  assert.equal(a.list().length, 4); remount();
});

test('failed migrations remain recoverable and registry refresh does not replace definition snapshots', async () => {
  let stored = JSON.stringify([normalized]);
  const registry = createRegisterRegistry({
    storage: { getItem: () => stored, setItem: (_, value) => { stored = value; }, removeItem: () => { stored = null; } },
    request: async (method) => { if (method === 'POST') throw Object.assign(new Error('conflict'), { status: 409 }); return { registers: [{ ...normalized, endian: 'big' }] }; }
  });
  const dispose = registry.subscribe(() => {});
  await pause(20);
  assert.equal(stored, JSON.stringify([normalized]));
  const draft = { schemaVersion: 1, name: 'Unsaved name', registers: [normalized], steps: [
    { id: 'read', type: 'registerRead', command: { type: 'i2c_read', addr: entry.addr, reg: entry.reg, len: 2 } }
  ] };
  const before = structuredClone(draft);
  assert.deepEqual(mergeRegisters(draft.registers, registry.list()), [normalized]);
  assert.deepEqual(validateDraft(draft), []);
  assert.deepEqual(validateSequence(draft, (cmd) => ({ expectedResult: cmd })), before);
  assert.deepEqual(draft, before);
  dispose(); registry.destroy();
});

test('custom register read blocks decode their saved endian and expose the result to conditions', async () => {
  const definition = { schemaVersion: 1, name: 'Little endian snapshot', registers: [normalized], steps: [
    { id: 'read', type: 'registerRead', command: { type: 'i2c_read', addr: entry.addr, reg: entry.reg, len: 2 } },
    { id: 'wait', type: 'waitUntil', timeoutMs: 100, condition: { op: '==', left: { step: 'read' }, right: { constant: 0x1234, unit: 'hex' } } }
  ] };
  const engine = new SequenceEngine({ dispatch: async () => ({ status: 'completed', result: { ok: true, data: ['0x34', '0x12'] } }),
    checkLive: async () => {}, persist: async () => {}, onEvent: () => {} });
  await engine.start({ definition, mode: 'live' });
  const run = engine.active; await run.done;
  assert.equal(run.state, 'completed'); assert.equal(run.stepValues.read, 0x1234);
});
