import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../recording/store.mjs';
import { snapshotSequence } from '../sequence/dependencies.mjs';
import { validateSequence } from '../sequence/model.mjs';
import { SequenceEngine } from '../sequence/engine.mjs';
import { makeBlock, validateDraft } from '../../site/assets/js/sequence-editor-model.mjs';
const message = (id, text = id) => ({ id, type: 'message', message: text });
const ref = (id, sequenceId, revision = 1) => ({ id, type: 'runSaved', sequenceId, revision });
const definition = (id, steps, revision = 1) => ({ schemaVersion: 1, id, revision, name: id, steps });
const condition = { op: '>', left: { metric: 'pv.busVoltageV' }, right: { constant: 5, unit: 'V' } };
const envelope = { source: 'simulation', packet: { telemetry: { pv: { busVoltageV: 6 } } } };
const validate = (value) => validateSequence(value, () => ({}));

test('message and reference validation match editor; messages remain bounded plain text', () => {
  for (const text of ['<script>alert(1)</script> %s $(echo x)', 'line one\nline two', '🙂'.repeat(500)]) {
    const candidate = definition('a', [message('log', text), ref('call', 'b')]);
    assert.deepEqual(validate(candidate), candidate);
    assert.deepEqual(validateDraft(candidate), []);
  }
  for (const text of ['', ' ', 'x'.repeat(1001), '\u0000bad']) {
    assert.throws(() => validate(definition('a', [message('log', text)])), /Message/);
    assert.ok(validateDraft(definition('a', [message('log', text)])).length);
  }
  const block = makeBlock('runSaved'); block.sequenceId = 'b';
  assert.equal(validateDraft(definition('a', [block])).length, 0);
  assert.throws(() => validate(definition('a', [ref('call', 'b', 0)])), /revision/);
});

test('graph rejects recursion, missing references, excessive depth and expanded work before execution', async () => {
  const a = definition('a', [ref('call', 'a')]);
  assert.throws(() => snapshotSequence(a, () => a, validate), /Recursive/);
  const b = definition('b', [ref('back', 'a')]);
  a.steps = [ref('call', 'b')];
  assert.throws(() => snapshotSequence(a, () => b, validate), /Recursive/);
  assert.throws(() => snapshotSequence(a, () => undefined, validate), /sequence|reference/i);
  const defs = Array.from({ length: 11 }, (_, i) => definition(`d${i}`, i === 10 ? [message('end')] : [ref('call', `d${i + 1}`)]));
  assert.throws(() => snapshotSequence(defs[0], (id) => defs.find((value) => value.id === id), validate), /nesting/);
  const leaf = definition('leaf', Array.from({ length: 200 }, (_, i) => message(`m${i}`)));
  assert.throws(() => snapshotSequence(definition('a', Array.from({ length: 6 }, (_, i) => ref(`c${i}`, 'leaf'))), () => leaf, validate), /work limit/);
  let persisted = 0;
  const engine = new SequenceEngine({ dispatch: () => assert.fail(), checkLive: () => {}, persist: () => { persisted++; } });
  await assert.rejects(engine.start({ definition: { ...a, dependencies: [b] }, mode: 'simulation' }), /Recursive/);
  assert.equal(persisted, 0);
  assert.equal(engine.active, null);
});

test('revision pins, deletion guards, stale writes and immutable snapshots survive reopen', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'composition-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'runs.sqlite'); let store = new RunStore(file); t.after(() => store.close());
  const child = store.sequenceSave({ definition: definition('child', [message('same-id', 'old <text> %s')]) });
  const parent = store.sequenceSave({ definition: definition('parent', [ref('call', 'child')]) });
  const snapshot = store.sequenceSnapshot({ id: 'parent' });
  store.sequenceSave({ definition: { ...child, steps: [message('same-id', 'new')] }, expectedRevision: 1 });
  assert.throws(() => store.sequenceDelete({ id: 'child', expectedRevision: 1 }), /conflict/);
  assert.throws(() => store.sequenceDelete({ id: 'child', expectedRevision: 2 }), /Referenced by/);
  assert.throws(() => store.sequenceSave({ definition: child, expectedRevision: 1 }), /conflict/);
  assert.throws(() => store.sequenceSave({ definition: definition('missing', [ref('call', 'unknown')]) }), /not found/);
  const engine = new SequenceEngine({ dispatch: () => assert.fail('simulation dispatched hardware'), checkLive: () => {}, persist: async (op, args) => store[op](args) });
  const started = await engine.start({ definition: snapshot, mode: 'simulation' }); await engine.active.done;
  store.sequenceDelete({ id: 'parent', expectedRevision: parent.revision });
  store.sequenceDelete({ id: 'child', expectedRevision: 2 });
  assert.throws(() => store.sequenceGet({ id: 'child' }), /not found/);
  assert.equal(store.sequenceGet({ id: 'child', revision: 1 }).steps[0].message, 'old <text> %s');
  const recreated = store.sequenceSave({ definition: definition('child', [message('new')]) });
  assert.equal(recreated.revision, 3);
  assert.throws(() => store.sequenceDelete({ id: 'child', expectedRevision: 2 }), /conflict/);
  store.close(); store = new RunStore(file);
  assert.equal(store.sequenceGetExecution({ id: started.id }).definition.dependencies[0].revision, 1);
  const event = store.sequenceEvents({ id: started.id }).find((event) => event.type === 'message');
  assert.equal(event.details.message, 'old <text> %s'); assert.equal(event.details.definition_id, 'child');
  assert.deepEqual(event.details.path, ['call:child@1']); assert.ok(event.at_ms > 0); assert.equal(event.block_id, 'same-id');
  assert.equal(store.sequenceGetExecution({ id: started.id }).state, 'completed');
});

test('logs execute only along selected paths, including repeated nested calls with identical block ids', async (t) => {
  const store = new RunStore(':memory:'); t.after(() => store.close());
  const child = definition('child', [message('note', '<img src=x onerror=alert(1)> %s')]);
  const root = definition('root', [message('start'), { id: 'choice', type: 'if', condition,
    then: [ref('yes', 'child'), message('true-log')], else: [message('false-log'), ref('no', 'child')] }, ref('again', 'child')]);
  const engine = new SequenceEngine({ dispatch: () => assert.fail(), checkLive: () => {}, persist: async (op, args) => store[op](args) });
  const started = await engine.start({ definition: { ...root, dependencies: [child] }, mode: 'simulation', simulationTelemetry: envelope }); await engine.active.done;
  const events = store.sequenceEvents({ id: started.id });
  const logs = events.filter((event) => event.type === 'message');
  assert.deepEqual(logs.map((event) => event.block_id), ['start', 'note', 'true-log', 'note']);
  assert.deepEqual(logs[1].details.path, ['choice:then', 'yes:child@1']);
  assert.deepEqual(logs[3].details.path, ['again:child@1']);
  assert.equal(events.filter((event) => event.type === 'nested_completed').length, 2);
  const falseStart = await engine.start({ definition: { ...root, dependencies: [child] }, mode: 'simulation', simulationTelemetry: { ...envelope, packet: { telemetry: { pv: { busVoltageV: 2 } } } } }); await engine.active.done;
  const falseLogs = store.sequenceEvents({ id: falseStart.id }).filter((event) => event.type === 'message');
  assert.deepEqual(falseLogs.map((event) => event.block_id), ['start', 'false-log', 'note', 'note']);
  assert.deepEqual(falseLogs[2].details.path, ['choice:else', 'no:child@1']);
});

test('nested cancellation, timeout, authorization loss and hardware failures use parent lifecycle', async () => {
  for (const scenario of ['cancel', 'timeout', 'auth', 'hardware']) {
    const events = [], sent = [];
    let clock = 0, authorized = true;
    const command = { id: 'write', type: 'command', command: { type: 'led_control', enabled: true } };
    const child = definition('child', [scenario === 'hardware' ? command : { id: 'hold', type: 'delay', durationMs: 500 }, message('never')]);
    const engine = new SequenceEngine({ dispatch: async (command, run) => { sent.push([command, run.sessionId]); return { status: 'timed_out' }; }, checkLive: () => { if (!authorized) throw new Error('operator_authorization_lost'); }, now: () => clock,
      maxDurationMs: 100, persist: async () => {}, onEvent: (event) => { events.push(event); if (event.phase === 'block_started' && event.block_id === 'hold') { if (scenario === 'cancel') engine.active.canceled = true; if (scenario === 'timeout') clock = 101; if (scenario === 'auth') authorized = false; } } });
    await engine.start({ definition: { ...definition('root', [ref('call', 'child')]), dependencies: [child] }, mode: 'live', sessionId: 'owner' });
    const run = engine.active; await run.done;
    assert.equal(run.reason, { cancel: 'canceled', timeout: 'maximum_duration', auth: 'operator_authorization_lost', hardware: 'command_outcome_unknown' }[scenario]);
    assert.equal(events.some((event) => event.phase === 'message'), false);
    assert.equal(run.state, scenario === 'cancel' ? 'canceled' : 'failed');
    if (scenario === 'hardware') assert.equal(sent[0][1], 'owner'); else assert.equal(sent.length, 0);
  }
});

test('transitive references through older revisions still block deletion', (t) => {
  const store = new RunStore(':memory:'); t.after(() => store.close());
  store.sequenceSave({ definition: definition('leaf', [message('leaf-note')]) });
  const mid = store.sequenceSave({ definition: definition('mid', [ref('leaf-call', 'leaf')]) });
  store.sequenceSave({ definition: definition('root', [ref('mid-call', 'mid')]) });
  store.sequenceSave({ definition: { ...mid, steps: [message('new-mid')] }, expectedRevision: 1 });
  assert.throws(() => store.sequenceDelete({ id: 'leaf', expectedRevision: 1 }), /root.*revision 1/);
  assert.equal(store.sequenceGet({ id: 'leaf' }).revision, 1);
});

test('nested register metadata and earlier-read results have separate call scopes', async () => {
  const events = [];
  const read = (id, addr, reg) => ({ id, type: 'registerRead', command: { type: 'i2c_read', addr, reg, len: 2 } });
  const fromRead = (expected) => ({ op: '==', left: { step: 'read' }, right: { constant: expected, unit: 'hex' } });
  const child = { ...definition('child', [read('read', '0x48', '0x00'), { id: 'check', type: 'if', condition: fromRead(0x1234), then: [message('child-yes')], else: [message('child-no')] }]),
    registers: [{ id: 'user-48-00-2', addr: '0x48', reg: '0x00', len: 2, endian: 'little' }] };
  const root = definition('root', [read('read', '0x40', '0x00'), ref('call', 'child'), { id: 'check', type: 'if', condition: fromRead(0x3412), then: [message('parent-yes')], else: [message('parent-no')] }]);
  let clock = 0;
  const engine = new SequenceEngine({ dispatch: async () => ({ status: 'completed', result: { ok: true, data: ['0x34', '0x12'] } }),
    checkLive: () => { clock += 1000; }, now: () => clock, persist: async () => {}, onEvent: (event) => events.push(event) });
  await engine.start({ definition: { ...root, dependencies: [child] }, mode: 'live' }); await engine.active.done;
  assert.deepEqual(events.filter((event) => event.phase === 'message').map((event) => event.block_id), ['child-yes', 'parent-yes']);
});

test('missing references on an unselected conditional path are rejected before any run is persisted', async () => {
  const root = definition('root', [{ id: 'choice', type: 'if', condition, then: [message('yes')], else: [ref('missing', 'absent')] }]);
  const engine = new SequenceEngine({ dispatch: () => assert.fail(), checkLive: () => {}, persist: () => assert.fail('invalid graph persisted') });
  await assert.rejects(engine.start({ definition: root, mode: 'simulation', simulationTelemetry: envelope }), /Missing saved sequence revision/);
});
