import { randomUUID } from 'node:crypto';
import { evaluateCondition } from './model.mjs';
import { CONDITION_REGISTERS, CONDITION_FAULTS } from './condition-fields.mjs';

const terminal = new Set(['completed', 'failed', 'canceled']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function telemetrySnapshot(envelope) {
  const telemetry = envelope?.packet?.telemetry || {};
  const metrics = {};
  for (const [group, names] of Object.entries({ pv: ['busVoltageV', 'currentA', 'powerW'],
    bms: ['packVoltageV'], mppt: ['vbusV', 'vbatV', 'ibusA'], peripheral: ['temperatureC', 'lightVoltageMv'] })) {
    for (const name of names) {
      const value = telemetry[group]?.[name];
      if (typeof value === 'number' && Number.isFinite(value)) metrics[`${group}.${name}`] = value;
    }
  }
  for (let i = 0; i < 4; i++) {
    const value = telemetry.bms?.cellVoltagesV?.[i];
    if (typeof value === 'number' && Number.isFinite(value)) metrics[i === 3 ? 'bms.cellSlot4V' : `bms.cell${i + 1}V`] = value;
  }
  return { source: envelope?.source ?? null, device_id: envelope?.packet?.device_id ?? null,
    seq: envelope?.packet?.seq ?? null, received_at: envelope?.received_at ?? null, metrics };
}
function conditionEvidence(condition, envelope) {
  const comparisons = [];
  const visit = (part) => {
    if (part.op === 'NOT') return visit(part.condition);
    if (part.op === 'AND' || part.op === 'OR') return part.conditions.forEach(visit);
    const values = {};
    for (const side of ['left', 'right']) {
      const operand = part[side];
      if (operand.constant !== undefined) values[side] = operand.constant;
      else if (operand.register !== undefined) {
        const field = CONDITION_REGISTERS.find((item) => item.id === operand.register);
        values[side] = field?.path.reduce((value, key) => value?.[key], envelope?.packet?.raw) ?? null;
      } else if (operand.fault !== undefined) {
        const bit = CONDITION_FAULTS.indexOf(operand.fault), mask = envelope?.packet?.raw?.mppt?.fault20;
        values[side] = Number.isInteger(mask) ? Boolean(mask & (1 << bit)) :
          Array.isArray(envelope?.packet?.telemetry?.mppt?.faults) ? envelope.packet.telemetry.mppt.faults.includes(operand.fault) : null;
      } else {
        const path = operand.metric.split('.');
        const group = envelope?.packet?.telemetry?.[path[0]];
        values[side] = path[0] === 'bms' && path[1]?.startsWith('cell')
          ? group?.cellVoltagesV?.[Number(path[1].match(/\d+/)?.[0] || 1) - 1] ?? null
          : group?.[path[1]] ?? null;
      }
    }
    comparisons.push({ op: part.op, left: part.left, right: part.right, values,
      result: evaluateCondition(part, envelope) });
  };
  visit(condition);
  return { condition, comparisons, seq: envelope?.packet?.seq ?? null,
    received_at: envelope?.received_at ?? null, source: envelope?.source ?? null };
}

export class SequenceEngine {
  constructor({ dispatch, checkLive, persist, onEvent = () => {}, onTerminal = async () => {}, now = Date.now, maxDurationMs = 1_800_000 }) {
    Object.assign(this, { dispatch, checkLive, persist, onEvent, onTerminal, now, maxDurationMs });
    this.active = null;
    this.telemetry = null;
  }
  async event(run, type, details = {}) {
    const event = { execution_id: run.id, order: ++run.order, at_ms: this.now(), type, block_id: details.block_id || null, details };
    await this.persist('sequenceEvent', event);
    this.onEvent({ ...event, phase: event.type, type: 'sequence_event' });
    return event;
  }
  async state(run, state, reason = null) {
    run.state = state;
    run.reason = reason;
    await this.persist('sequenceState', { id: run.id, state, reason, ended_ms: terminal.has(state) ? this.now() : null });
    await this.event(run, 'state', { state, reason });
    if (terminal.has(state)) await this.onTerminal(run);
  }
  onTelemetry(envelope) {
    if (envelope?.source !== 'udp') return;
    this.telemetry = envelope;
    const run = this.active;
    if (run?.mode === 'live' && run.state !== 'canceled' && !terminal.has(run.state)) {
      if (envelope.packet.device_id !== run.deviceId || envelope.network?.remote_address !== run.target.address || envelope.network?.remote_port !== run.target.port) return;
      const seq = envelope.packet.seq;
      if (Number.isInteger(run.lastSeq) && Number.isInteger(seq)) {
        const delta = (seq - run.lastSeq + 65535) % 65535;
        if (delta === 0 || delta > 32767) return;
      }
      if (Number.isInteger(run.uptime) && Number.isInteger(envelope.packet.device_uptime_ms) && envelope.packet.device_uptime_ms + 5000 < run.uptime) run.abortReason = 'device_reboot';
      run.lastSeq = seq;
      run.uptime = envelope.packet.device_uptime_ms;
      run.telemetry = envelope;
    }
  }
  async start({ definition, mode, sessionId = null, operatorName = null, target = null, deviceId = null, recordingEnvelope = null, simulationTelemetry = null, id = randomUUID() }) {
    if (this.active) throw Object.assign(new Error('Another sequence is active'), { statusCode: 409 });
    const run = { id, definition: structuredClone(definition), mode, sessionId, target, deviceId, state: 'idle', reason: null, order: 0, startedMs: this.now(), lastSeq: mode === 'live' ? this.telemetry?.packet?.seq ?? null : null, uptime: mode === 'live' ? this.telemetry?.packet?.device_uptime_ms ?? null : null, telemetry: mode === 'simulation' ? simulationTelemetry : this.telemetry, abortReason: null, paused: false, canceled: false, inFlight: false, currentBlock: null };
    this.active = run;
    try {
      const saved = await this.persist('sequenceStart', { id, definition: run.definition, mode, operator_name: operatorName, device_id: deviceId, started_ms: run.startedMs, envelope: recordingEnvelope });
      run.recordingRunId = saved?.run?.id || null;
      await this.state(run, 'running');
    } catch (error) { this.active = null; throw error; }
    run.done = this.execute(run);
    return this.snapshot(run);
  }
  snapshot(run = this.active) {
    if (!run) return null;
    return { id: run.id, mode: run.mode, state: run.state, reason: run.reason, current_block: run.currentBlock, started_ms: run.startedMs, recording_run_id: run.recordingRunId || null };
  }
  async check(run) {
    if (run.canceled) throw new Error('canceled');
    if (run.abortReason) throw new Error(run.abortReason);
    if (this.now() - run.startedMs > this.maxDurationMs) throw new Error('maximum_duration');
    if (run.mode === 'live') await this.checkLive(run);
    while (run.paused) {
      if (run.canceled) throw new Error('canceled');
      if (this.now() - run.pauseStarted > 60_000) throw new Error('pause_timeout');
      if (this.now() - run.startedMs > this.maxDurationMs) throw new Error('maximum_duration');
      if (run.mode === 'live') await this.checkLive(run);
      await sleep(100);
    }
  }
  async condition(run, blockId, condition, timeoutMs, acceptFalse) {
    const deadline = this.now() + timeoutMs;
    let lastEnvelope;
    while (this.now() <= deadline) {
      await this.check(run);
      const envelope = run.telemetry;
      if (envelope !== lastEnvelope) {
        lastEnvelope = envelope;
        const result = evaluateCondition(condition, envelope);
        const evidence = conditionEvidence(condition, envelope);
        await this.event(run, 'comparison', { block_id: blockId, result, evidence });
        if (result === true || acceptFalse && result === false) return { result, evidence };
      }
      await sleep(100);
    }
    const error = new Error('condition_timeout');
    error.evidence = conditionEvidence(condition, run.telemetry);
    throw error;
  }
  async blocks(run, steps) {
    for (const step of steps) {
      await this.check(run);
      run.currentBlock = step.id;
      await this.event(run, 'block_started', { block_id: step.id, block_type: step.type,
        telemetry_snapshot: telemetrySnapshot(run.telemetry) });
      try {
        if (['command', 'registerRead', 'registerWrite'].includes(step.type)) {
          await this.event(run, 'command_intent', { block_id: step.id, command: step.command });
          await this.check(run);
          if (run.mode === 'live' && Number.isFinite(run.lastCommandAt)) {
            while (this.now() - run.lastCommandAt < 1_000) { await this.check(run); await sleep(100); }
          }
          run.inFlight = run.mode === 'live';
          let result;
          try {
            if (run.mode === 'live') run.lastCommandAt = this.now();
            result = run.mode === 'simulation' ? { status: 'simulated' } : await this.dispatch(step.command, run);
          } catch (error) {
            if (run.mode === 'live') run.abortReason = 'command_outcome_unknown';
            await this.event(run, 'command_error', { block_id: step.id, command: step.command,
              error: error.message, outcome_unknown: run.mode === 'live' });
            throw new Error(run.mode === 'live' ? 'command_outcome_unknown' : error.message);
          }
          finally { run.inFlight = false; }
          await this.event(run, 'command_result', { block_id: step.id, ...result,
            telemetry_snapshot: telemetrySnapshot(run.telemetry),
            transport_acknowledged: result.status === 'completed' || result.status === 'failed',
            device_reported_success: result.status === 'completed' && result.result?.ok === true,
            hardware_state_verified: step.command.type === 'mppt_acdrv_control' && result.result?.verified === true,
            register_write_read_back: false });
          if (run.mode === 'live' && (result.status !== 'completed' || result.result?.ok !== true)) {
            if (result.status === 'timed_out') run.abortReason = 'command_outcome_unknown';
            await this.event(run, 'command_error', { block_id: step.id, command: step.command,
              status: result.status, error: result.error || result.result?.error || (result.status === 'timed_out' ? 'No device response before timeout; hardware outcome is unknown.' : 'Device reported command failure.'),
              outcome_unknown: result.status === 'timed_out' });
            throw new Error(result.status === 'timed_out' ? 'command_outcome_unknown' : 'command_failed');
          }
          await this.check(run);
        } else if (step.type === 'delay') {
          const deadline = this.now() + step.durationMs;
          while (this.now() < deadline) { await this.check(run); await sleep(Math.min(100, deadline - this.now())); }
        } else if (step.type === 'waitUntil') {
          try {
            const decision = await this.condition(run, step.id, step.condition, step.timeoutMs, false);
            await this.event(run, 'condition', { block_id: step.id, ...decision });
          } catch (error) {
            if (error.message === 'condition_timeout') await this.event(run, 'condition', { block_id: step.id,
              result: null, evidence: error.evidence, error: 'Condition did not become TRUE before the timeout.' });
            throw error;
          }
        } else if (step.type === 'if') {
          const decision = await this.condition(run, step.id, step.condition, 30_000, true);
          await this.event(run, 'branch', { block_id: step.id, ...decision, selected: decision.result ? 'then' : 'else' });
          await this.blocks(run, decision.result ? step.then : step.else || []);
        }
        await this.event(run, 'block_completed', { block_id: step.id });
      } catch (error) {
        await this.event(run, 'block_failed', { block_id: step.id, error: error.message });
        throw error;
      }
    }
  }
  async execute(run) {
    try {
      await this.blocks(run, run.definition.steps);
      await this.state(run, 'completed');
    } catch (error) {
      try { await this.state(run, run.canceled ? 'canceled' : 'failed', error.message); }
      catch {
        run.state = 'failed'; run.reason = 'storage_failure';
        await this.onTerminal(run).catch(() => {});
      }
    } finally { if (this.active === run) this.active = null; }
  }
  async pause(id) {
    const run = this.active;
    if (!run || run.id !== id || run.state !== 'running') throw Object.assign(new Error('Sequence is not running'), { statusCode: 409 });
    run.paused = true; run.pauseStarted = this.now();
    while (run.inFlight && !terminal.has(run.state)) await sleep(50);
    if (terminal.has(run.state)) return this.snapshot(run);
    await this.state(run, 'paused');
    return this.snapshot(run);
  }
  async resume(id) {
    const run = this.active;
    if (!run || run.id !== id || run.state !== 'paused') throw Object.assign(new Error('Sequence is not paused'), { statusCode: 409 });
    if (run.mode === 'live') await this.checkLive(run);
    run.paused = false;
    await this.state(run, 'running');
    return this.snapshot(run);
  }
  async cancel(id) {
    const run = this.active;
    if (!run || run.id !== id) throw Object.assign(new Error('Sequence is not active'), { statusCode: 409 });
    run.canceled = true;
    return this.snapshot(run);
  }
}
