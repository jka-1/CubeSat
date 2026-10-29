import test from 'node:test';
import assert from 'node:assert/strict';
import { SequenceEngine } from '../sequence/engine.mjs';
import { evaluateCondition, validateSequence } from '../sequence/model.mjs';
import { RunStore } from '../recording/store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONDITION_FAULTS } from '../sequence/condition-fields.mjs';
import { READABLE_REGISTERS } from '../../site/assets/js/sequence-register-catalog.mjs';

const metric = { metric: 'pv.busVoltageV' };
const condition = (op, value) => ({ op, left: metric, right: { constant: value, unit: 'V' } });
const telemetry = (value) => ({ source: 'udp', received_at: new Date().toISOString(), packet: { seq: 1, device_id: 'eps', telemetry: { pv: { available: true, busVoltageV: value } } }, network: { remote_address: '127.0.0.1', remote_port: 3333 } });
const definition = (steps) => ({ schemaVersion: 1, id: 'test', revision: 1, name: 'Test', steps });
const command = (id) => ({ id, type: 'command', command: { type: 'led_control', enabled: true } });
function harness({ result = { status: 'completed', result: { ok: true } }, authorized = true, simulation = false } = {}) {
  const events = [], sent = [], stored = [];
  const engine = new SequenceEngine({
    dispatch: async (value) => { sent.push(value); return result; },
    checkLive: async () => { if (!authorized) throw new Error('operator_authorization_lost'); },
    persist: async (op, value) => { stored.push([op, value]); },
    onEvent: (event) => events.push(event)
  });
  engine.onTelemetry(telemetry(6));
  const start = async (steps) => {
    const snapshot = await engine.start({ definition: definition(steps), mode: simulation ? 'simulation' : 'live', sessionId: 'operator', target: { address: '127.0.0.1', port: 3333 }, deviceId: 'eps', simulationTelemetry: telemetry(6) });
    const run = engine.active;
    await run.done;
    return { snapshot, run };
  };
  return { engine, events, sent, stored, start };
}

test('validates blocks, register reads, commands and bounded conditions', () => {
  const validate = (cmd) => ({ expectedResult: { addr: cmd.addr, reg: cmd.reg, len: cmd.len } });
  assert.equal(validateSequence(definition([command('a')]), validate).steps.length, 1);
  assert.throws(() => validateSequence(definition([command('a'), command('a')]), validate), /duplicate/);
  assert.throws(() => validateSequence(definition([{ id: 'x', type: 'registerRead', command: { type: 'i2c_read', addr: '0x40', reg: '0xAA', len: 2 } }]), validate), /Unsupported register/);
  assert.throws(() => validateSequence(definition([{ id: 'x', type: 'waitUntil', timeoutMs: 100, condition: condition('>', 5) }, { id: 'y', type: 'delay', durationMs: 600001 }]), validate), /delay/);
  assert.throws(() => validateSequence(definition([{ ...command('a'), command: { type: 'led_control', enabled: true, request_id: 'forged' } }]), validate), /Unsafe/);
  assert.throws(() => validateSequence(definition([{ id: 'x', type: 'if', condition: { op: 'NOT', condition: { op: '>' } }, then: [] }]), validate), /operand|comparison|condition/i);
  assert.equal(evaluateCondition({ op: 'NOT', condition: condition('>', 5) }, null), null);
});

test('register words and all MPPT fault flags validate and evaluate without changing saved shape', () => {
  const validate = (cmd) => ({ expectedResult: { addr: cmd.addr, reg: cmd.reg, len: cmd.len } });
  const packet = telemetry(6);
  packet.packet.raw = { pv: { bus: 0x100 }, mppt: { fault20: 0b10000101 } };
  packet.packet.telemetry.mppt = { faults: ['VAC1_OVP_STAT', 'CONV_OCP_STAT', 'BAT_REG_STAT'] };
  const register = { op: '==', left: { register: 'pv.bus' }, right: { constant: 0x100, unit: 'hex' } };
  const wait = { id: 'raw', type: 'waitUntil', timeoutMs: 100, condition: register };
  assert.deepEqual(validateSequence(definition([wait]), validate).steps[0], wait);
  assert.equal(evaluateCondition(register, packet), true);
  assert.throws(() => validateSequence(definition([{ ...wait, condition: { ...register, right: { constant: 256, unit: 'V' } } }]), validate), /types or formats differ/);
  assert.throws(() => validateSequence(definition([{ ...wait, condition: { ...register, right: { constant: '0x100', unit: 'hex' } } }]), validate), /Invalid condition operand/);
  for (const [bit, fault] of CONDITION_FAULTS.entries()) {
    const condition = { op: '==', left: { fault }, right: { constant: Boolean(0b10000101 & (1 << bit)), unit: 'boolean' } };
    assert.equal(validateSequence(definition([{ ...wait, condition }]), validate).steps.length, 1);
    assert.equal(evaluateCondition(condition, packet), true);
  }
  assert.throws(() => validateSequence(definition([{ ...wait, condition: { op: '>', left: { fault: CONDITION_FAULTS[0] }, right: { constant: true, unit: 'boolean' } } }]), validate), /support == and != only/);
  packet.packet.telemetry.mppt.available = false;
  assert.equal(evaluateCondition({ op: '==', left: { fault: CONDITION_FAULTS[0] }, right: { constant: true, unit: 'boolean' } }, packet), null);
});

test('live conditions read supported registers and compare decoded values', async () => {
  const h = harness({ result: { status: 'completed', result: { ok: true, data: ['0x34', '0x12'] } } });
  const register = READABLE_REGISTERS.find((item) => item.id === '0x08:0x14');
  const wait = { id: 'read-condition', type: 'waitUntil', timeoutMs: 1000,
    condition: { op: '==', left: { register: register.id }, right: { constant: 0x1234, unit: 'hex' } } };
  const validate = (cmd) => ({ expectedResult: { addr: cmd.addr, reg: cmd.reg, len: cmd.len } });
  for (const item of READABLE_REGISTERS) {
    const candidate = { ...wait, condition: { ...wait.condition, left: { register: item.id } } };
    assert.equal(validateSequence(definition([candidate]), validate).steps.length, 1, item.id);
  }
  const { run } = await h.start([wait]);
  assert.equal(run.state, 'completed');
  assert.deepEqual(h.sent, [{ type: 'i2c_read', addr: register.addr, reg: register.reg, len: register.len }]);
  assert.equal(h.events.find((event) => event.phase === 'comparison')?.details.evidence.comparisons[0].values.left, 0x1234);
  assert.ok(h.stored.some(([operation, event]) => operation === 'sequenceEvent' && event.type === 'command_result'));
});

test('condition reads preserve simulation isolation and report device failures', async () => {
  const register = '0x6B:0x13';
  const wait = { id: 'read-condition', type: 'waitUntil', timeoutMs: 100,
    condition: { op: '==', left: { register }, right: { constant: 0x61, unit: 'hex' } } };
  const simulated = harness({ simulation: true });
  const fixture = telemetry(6);
  fixture.packet.register_values = { [register]: 0x61 };
  const started = await simulated.engine.start({ definition: definition([wait]), mode: 'simulation', simulationTelemetry: fixture });
  const simulationRun = simulated.engine.active;
  await simulationRun.done;
  assert.equal(started.mode, 'simulation');
  assert.equal(simulationRun.state, 'completed');
  assert.deepEqual(simulated.sent, []);

  const failed = harness({ result: { status: 'failed', result: { ok: false, error: 'ESP_FAIL' } } });
  const { run } = await failed.start([wait]);
  assert.equal(run.reason, 'command_failed');
  assert.equal(failed.events.find((event) => event.phase === 'command_error')?.details.error, 'ESP_FAIL');
});

test('simulation waits on raw register and branches on fault with persisted comparison evidence', async () => {
  const h = harness({ simulation: true });
  const packet = telemetry(6);
  packet.source = 'simulation';
  packet.packet.raw = { pv: { bus: 0x100 }, mppt: { fault20: 0x20 } };
  packet.packet.telemetry.mppt = { faults: ['VBAT_OVP_STAT'] };
  const started = await h.engine.start({ definition: definition([
    { id: 'raw', type: 'waitUntil', timeoutMs: 100, condition: { op: '==', left: { register: 'pv.bus' }, right: { constant: 0x100, unit: 'hex' } } },
    { id: 'fault', type: 'if', condition: { op: '==', left: { fault: 'VBAT_OVP_STAT' }, right: { constant: true, unit: 'boolean' } }, then: [command('yes')], else: [command('no')] }
  ]), mode: 'simulation', simulationTelemetry: packet });
  const run = h.engine.active;
  await run.done;
  assert.equal(started.mode, 'simulation');
  assert.equal(run.state, 'completed');
  assert.equal(h.sent.length, 0);
  assert.ok(h.stored.some(([operation, event]) => operation === 'sequenceEvent' && event.type === 'comparison' && event.details.evidence.comparisons[0].values.left === 0x100));
  assert.ok(h.events.some((event) => event.details?.selected === 'then'));
});

test('successful command and branch execution records acknowledgment evidence', async () => {
  const h = harness();
  const { run } = await h.start([{ id: 'if', type: 'if', condition: condition('>', 5), then: [command('yes')], else: [command('no')] }]);
  assert.equal(run.state, 'completed');
  assert.equal(h.sent.length, 1);
  assert.equal(h.events.find((e) => e.type === 'sequence_event' && e.details?.selected === 'then')?.details.selected, 'then');
  assert.equal(h.events.find((e) => e.phase === 'comparison')?.details.result, true);
  assert.equal(h.events.find((e) => e.details?.device_reported_success === true)?.details.hardware_state_verified, false);
  assert.ok(h.stored.some(([op]) => op === 'sequenceEvent'));
});

test('false branch and timeout are distinct outcomes', async () => {
  const h = harness();
  h.engine.onTelemetry(telemetry(2));
  const { run } = await h.start([{ id: 'if', type: 'if', condition: condition('>', 5), then: [command('yes')], else: [command('no')] }]);
  assert.equal(run.state, 'completed');
  assert.equal(h.events.find((e) => e.details?.selected)?.details.selected, 'else');
  assert.equal(h.events.find((e) => e.phase === 'comparison')?.details.result, false);
  const t = harness();
  const ended = await t.start([{ id: 'wait', type: 'waitUntil', timeoutMs: 20, condition: condition('>', 10) }]);
  assert.equal(ended.run.state, 'failed');
  assert.equal(ended.run.reason, 'condition_timeout');
  assert.match(t.events.find((e) => e.type === 'sequence_event' && e.phase === 'condition')?.details.error, /did not become TRUE/);
});

test('failed or timed-out commands stop before the next block', async () => {
  for (const status of ['failed', 'timed_out']) {
    const h = harness({ result: { status, result: { ok: false } } });
    const { run } = await h.start([command('first'), command('second')]);
    assert.equal(run.state, 'failed');
    assert.equal(h.sent.length, 1);
    assert.equal(run.reason, status === 'timed_out' ? 'command_outcome_unknown' : 'command_failed');
    assert.ok(h.events.some((event) => event.phase === 'command_error' && event.details?.block_id === 'first'));
    assert.equal(h.events.find((event) => event.phase === 'command_result')?.details.telemetry_snapshot.device_id, 'eps');
  }
  const events = [];
  const thrown = new SequenceEngine({ dispatch: async () => { throw new Error('socket failure'); },
    checkLive: () => {}, persist: async () => {}, onEvent: (event) => events.push(event) });
  thrown.onTelemetry(telemetry(6));
  await thrown.start({ definition: definition([command('first'), command('second')]), mode: 'live',
    sessionId: 'operator', target: { address: '127.0.0.1', port: 3333 }, deviceId: 'eps' });
  const failed = thrown.active;
  await failed.done;
  assert.equal(failed.reason, 'command_outcome_unknown');
  assert.equal(events.find((event) => event.phase === 'command_error')?.details.error, 'socket failure');
});

test('authorization loss, cancellation, and simulation isolation', async () => {
  const unauthorized = harness({ authorized: false });
  const { run } = await unauthorized.start([command('blocked')]);
  assert.equal(run.reason, 'operator_authorization_lost');
  assert.equal(unauthorized.sent.length, 0);
  const cancel = harness();
  const started = await cancel.engine.start({ definition: definition([{ id: 'delay', type: 'delay', durationMs: 500 }]), mode: 'simulation' });
  const active = cancel.engine.active;
  await cancel.engine.cancel(started.id);
  await active.done;
  assert.equal(active.state, 'canceled');
  const simulation = harness({ simulation: true });
  const simulated = await simulation.start([command('dry')]);
  assert.equal(simulated.run.state, 'completed');
  assert.equal(simulation.sent.length, 0);
});

test('operator disconnect during a live delay prevents the next command', async () => {
  let connected = true;
  const sent = [], events = [];
  const engine = new SequenceEngine({ dispatch: async (value) => { sent.push(value); return { status: 'completed', result: { ok: true } }; },
    checkLive: () => { if (!connected) throw new Error('operator_authorization_lost'); },
    persist: async () => {}, onEvent: (event) => events.push(event) });
  engine.onTelemetry(telemetry(6));
  await engine.start({ definition: definition([{ id: 'delay', type: 'delay', durationMs: 500 }, command('after')]),
    mode: 'live', sessionId: 'operator', target: { address: '127.0.0.1', port: 3333 }, deviceId: 'eps' });
  const active = engine.active;
  connected = false;
  await active.done;
  assert.equal(active.state, 'failed');
  assert.equal(active.reason, 'operator_authorization_lost');
  assert.equal(sent.length, 0);
  assert.ok(events.some((event) => event.phase === 'block_failed' && event.details.block_id === 'delay'));
});

test('saved revisions, execution events, and recovery state are durable store records', (t) => {
  const store = new RunStore(':memory:');
  t.after(() => store.close());
  const saved = store.sequenceSave({ definition: definition([command('one')]) });
  assert.equal(saved.revision, 1);
  assert.throws(() => store.sequenceSave({ definition: saved, expectedRevision: 0 }), /revision conflict/);
  const next = store.sequenceSave({ definition: saved, expectedRevision: 1 });
  assert.equal(next.revision, 2);
  store.sequenceStart({ id: 'execution-1', definition: next, mode: 'live', operator_name: 'operator', recording_session_id: 'run-session', device_id: 'eps', started_ms: 1 });
  store.sequenceEvent({ execution_id: 'execution-1', order: 1, at_ms: 2, type: 'command_intent', block_id: 'one', details: { command: 'led_control' } });
  store.sequenceState({ id: 'execution-1', state: 'failed', reason: 'command_outcome_unknown', ended_ms: 3 });
  assert.equal(store.sequenceUnsafeStatus(), true);
  assert.equal(store.sequenceGetExecution({ id: 'execution-1' }).recording_session_id, 'run-session');
  assert.equal(store.sequenceEvents({ id: 'execution-1' })[0].details.command, 'led_control');
  store.sequenceRecover({ id: 'execution-1' });
  assert.equal(store.sequenceUnsafeStatus(), false);
  const liveEnvelope = telemetry(6);
  liveEnvelope.type = 'telemetry';
  liveEnvelope.packet.debug = { enabled: false };
  assert.throws(() => store.sequenceStartLive({ id: 'execution-1', definition: next, mode: 'live', operator_name: 'operator', device_id: 'eps', started_ms: Date.now(), envelope: liveEnvelope, metadata: {} }));
  assert.equal(store.active(), null, 'failed execution insert rolls back recording start');
  const live = store.sequenceStartLive({ id: 'execution-2', definition: next, mode: 'live', operator_name: 'operator', device_id: 'eps', started_ms: Date.now(), envelope: liveEnvelope, metadata: {} });
  assert.equal(live.execution.recording_session_id, live.run.session_id);
  assert.equal(live.execution.recording_run_id, live.run.id);
  assert.equal(store.sequenceListExecutions().find((item) => item.id === 'execution-2').recording_run_id, live.run.id);
});

test('simulation results, branches, and partial cancellation survive storage reopen', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sequence-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'runs.sqlite');
  let store = new RunStore(file);
  const saved = store.sequenceSave({ definition: definition([
    { id: 'choice', type: 'if', condition: condition('>', 5), then: [command('yes')], else: [command('no')] }
  ]) });
  const engine = new SequenceEngine({ dispatch: () => { throw new Error('Mock run must not send a command'); },
    checkLive: () => {}, persist: async (op, args) => store[op](args) });
  const start = await engine.start({ definition: saved, mode: 'simulation', operatorName: 'operator', simulationTelemetry: telemetry(2) });
  await engine.active.done;
  const row = store.sequenceGetExecution({ id: start.id });
  assert.equal(row.state, 'completed');
  assert.equal(row.mode, 'simulation');
  assert.equal(row.revision, 1);
  assert.equal(row.completed_steps, 2);
  assert.equal(row.recording_run_id, null);
  const branch = store.sequenceEvents({ id: start.id }).find((event) => event.type === 'branch');
  assert.equal(branch.details.selected, 'else');
  assert.equal(branch.details.evidence.comparisons[0].values.left, 2);
  const delayRun = await engine.start({ definition: definition([{ id: 'first', type: 'delay', durationMs: 1 }, { id: 'second', type: 'delay', durationMs: 500 }]), mode: 'simulation' });
  const running = engine.active;
  await new Promise((resolve) => setTimeout(resolve, 30));
  await engine.cancel(delayRun.id); await running.done;
  assert.equal(store.sequenceGetExecution({ id: delayRun.id }).state, 'canceled');
  assert.equal(store.sequenceGetExecution({ id: delayRun.id }).completed_steps, 1);
  store.close(); store = new RunStore(file);
  assert.equal(store.sequenceGetExecution({ id: start.id }).state, 'completed');
  assert.equal(store.sequenceEvents({ id: start.id }).filter((event) => event.type === 'branch').length, 1);
  assert.equal(store.sequenceListExecutions().length, 2);
  store.close();
});

test('restart closes incomplete sequence exactly once and preserves completed steps', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sequence-restart-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'runs.sqlite');
  let store = new RunStore(file);
  store.sequenceStart({ id: 'interrupted', definition: definition([command('one')]), mode: 'live', operator_name: 'operator', started_ms: 1 });
  store.sequenceEvent({ execution_id: 'interrupted', order: 1, at_ms: 2, type: 'block_completed', block_id: 'one', details: {} });
  store.close(); store = new RunStore(file, 3);
  assert.deepEqual([store.sequenceGetExecution({ id: 'interrupted' }).state, store.sequenceGetExecution({ id: 'interrupted' }).reason, store.sequenceGetExecution({ id: 'interrupted' }).completed_steps], ['failed', 'bridge_restart', 1]);
  assert.equal(store.sequenceUnsafeStatus(), true);
  assert.equal(store.sequenceEvents({ id: 'interrupted' }).filter((event) => event.type === 'state').length, 1);
  store.close(); store = new RunStore(file, 4);
  assert.equal(store.sequenceEvents({ id: 'interrupted' }).filter((event) => event.type === 'state').length, 1);
  store.close();
});
