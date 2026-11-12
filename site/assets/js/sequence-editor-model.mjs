import { WRITABLE_REGISTER_WIDTHS } from './register-policy.mjs?v=20261112-registers';
import { RUN_METRICS } from './runs-model.mjs';
import { CONDITION_REGISTERS, CONDITION_FAULTS } from './sequence-condition-fields.mjs?v=20261112-registers';
import { READABLE_REGISTERS } from './sequence-register-catalog.mjs?v=20261112-registers';

export const METRICS = RUN_METRICS.map(({ id, label, unit }) => ({ id, label, unit: unit === '°C' ? 'C' : unit }));
export const OPERATORS = ['>', '>=', '<', '<=', '==', '!=', '&'];
export const BLOCKS = [
  ['command', 'Command'], ['registerRead', 'Register read'], ['registerWrite', 'Register write'],
  ['runSaved', 'Run Saved Sequence'], ['message', 'Message / log'], ['delay', 'Delay'], ['waitUntil', 'Wait for value'], ['if', 'IF / ELSE']
];
const uid = () => crypto.randomUUID();
// User-added condition registers (sequence JSON `registers`), read live when the condition is evaluated.
export const USER_REGISTER_LIMIT = 32;
export { hex2, parseUserRegister, userRegisterLabel } from './register-definition.mjs';
import { parseUserRegister } from './register-definition.mjs';
export function validateUserRegisters(list, errors = []) {
  if (list === undefined) return errors;
  if (!Array.isArray(list) || list.length > USER_REGISTER_LIMIT) { errors.push(`Added registers: at most ${USER_REGISTER_LIMIT}.`); return errors; }
  const ids = new Set();
  list.forEach((item, i) => {
    const { entry, errors: problems } = parseUserRegister(item || {});
    problems.forEach((problem) => errors.push(`Added register ${i + 1}: ${problem}`));
    if (entry && (item.id !== entry.id || ids.has(item.id))) errors.push(`Added register ${i + 1}: invalid or duplicate id`);
    ids.add(item?.id);
  });
  return errors;
}
export const comparison = () => ({ op: '>', left: { metric: METRICS[0].id }, right: { constant: 0, unit: METRICS[0].unit } });
export function makeBlock(type) {
  const id = uid();
  if (type === 'command') return { id, type, command: { type: 'led_control', enabled: true } };
  if (type === 'registerRead') return { id, type, command: { type: 'i2c_read', addr: '0x40', reg: '0x00', len: 2 } };
  if (type === 'registerWrite') return { id, type, command: { type: 'i2c_write', addr: '0x40', reg: '0x05', data: ['0x00', '0x00'] } };
  if (type === 'runSaved') return { id, type, sequenceId: '', revision: 1 };
  if (type === 'message') return { id, type, message: '' };
  if (type === 'delay') return { id, type, durationMs: 1000 };
  if (type === 'waitUntil') return { id, type, condition: comparison(), timeoutMs: 30000 };
  if (type === 'if') return { id, type, condition: comparison(), then: [], else: [] };
  throw new Error('Unsupported block');
}
export function findList(steps, path) {
  let list = steps;
  for (const part of path) {
    const block = list.find((step) => step.id === part.id);
    if (!block || block.type !== 'if' || !['then', 'else'].includes(part.branch)) return null;
    list = block[part.branch];
  }
  return list;
}
export function countBlocks(steps) { return steps.reduce((total, step) => total + 1 + (step.type === 'if' ? countBlocks(step.then) + countBlocks(step.else) : 0), 0); }
export function validateCondition(condition, path, errors, depth = 0, custom = []) {
  if (depth > 8) { errors.push(`${path}: logical nesting exceeds 8`); return; }
  if (!condition || typeof condition !== 'object') { errors.push(`${path}: condition is missing`); return; }
  if (['AND', 'OR'].includes(condition.op)) {
    if (!Array.isArray(condition.conditions) || condition.conditions.length < 2 || condition.conditions.length > 8) errors.push(`${path}: ${condition.op} needs 2–8 conditions`);
    else condition.conditions.forEach((item, i) => validateCondition(item, `${path} condition ${i + 1}`, errors, depth + 1, custom));
  } else if (condition.op === 'NOT') validateCondition(condition.condition, `${path} NOT`, errors, depth + 1, custom);
  else if (OPERATORS.includes(condition.op)) {
    const type = (operand) => {
      if (operand?.metric && Object.keys(operand).length === 1) return METRICS.find((metric) => metric.id === operand.metric)?.unit;
      if (operand?.step && Object.keys(operand).length === 1) return typeof operand.step === 'string' ? 'hex' : null;
      if (operand?.register && Object.keys(operand).length === 1) return CONDITION_REGISTERS.some((item) => item.id === operand.register) || custom.some((item) => item.id === operand.register) ? 'hex' : null;
      if (operand?.fault && Object.keys(operand).length === 1) return CONDITION_FAULTS.includes(operand.fault) ? 'boolean' : null;
      if (Object.keys(operand || {}).length === 2 && Object.hasOwn(operand, 'constant')) {
        if (operand.unit === 'boolean') return typeof operand.constant === 'boolean' ? 'boolean' : null;
        return typeof operand.constant === 'number' && Number.isFinite(operand.constant) && [...new Set(METRICS.map((item) => item.unit)), 'hex'].includes(operand.unit) &&
          (operand.unit !== 'hex' || Number.isSafeInteger(operand.constant) && operand.constant >= 0 && operand.constant <= 0xffff) ? operand.unit : null;
      }
      return null;
    };
    const types = [type(condition.left), type(condition.right)];
    if (!types[0] || !types[1]) errors.push(`${path}: enter a valid telemetry, register, fault flag, or constant value`);
    else if (types[0] !== types[1]) errors.push(`${path}: comparison types or formats must match (${types.join(' versus ')})`);
    if (types[0] === 'boolean' && !['==', '!='].includes(condition.op)) errors.push(`${path}: fault flags support == and != only`);
    if (condition.op === '&' && types[0] && types[0] !== 'hex') errors.push(`${path}: bit-mask AND (&) needs register or hex values`);
    if (condition.left?.constant !== undefined && condition.right?.constant !== undefined) errors.push(`${path}: comparison needs telemetry, register, or fault flag`);
  } else errors.push(`${path}: choose a comparison or logical operator`);
}
export function validateDraft(definition) {
  const errors = [];
  if (!definition.name?.trim()) errors.push('Enter a Branch Definition name.');
  if (definition.name?.length > 120) errors.push('Name must be 120 characters or fewer.');
  if (!definition.steps.length) errors.push('Connect at least one block to the Branch Definition.');
  if (countBlocks(definition.steps) > 200) errors.push('Branch Definition exceeds 200 blocks.');
  const writable = WRITABLE_REGISTER_WIDTHS;
  validateUserRegisters(definition.registers, errors);
  const custom = Array.isArray(definition.registers) ? definition.registers : [];
  const seen = new Set();
  const stepRefs = (condition, out = []) => {
    if (!condition || typeof condition !== 'object') return out;
    if (condition.op === 'NOT') return stepRefs(condition.condition, out);
    if (condition.op === 'AND' || condition.op === 'OR') { (condition.conditions || []).forEach((part) => stepRefs(part, out)); return out; }
    for (const side of ['left', 'right']) if (condition[side]?.step) out.push(condition[side].step);
    return out;
  };
  const checkRefs = (condition, reads, label) => {
    for (const id of stepRefs(condition)) if (!reads.has(id)) errors.push(`${label}: the selected block result must come from a Register read earlier on the same path`);
  };
  const walk = (steps, path, depth, reads = new Set()) => {
    if (depth > 8) errors.push(`${path}: branch nesting exceeds 8`);
    for (const [index, step] of steps.entries()) {
      const label = `${path} block ${index + 1}`;
      if (step.type === 'waitUntil' || step.type === 'if') checkRefs(step.condition, reads, label);
      if (!step.id || seen.has(step.id)) errors.push(`${label}: missing or duplicate block ID`);
      seen.add(step.id);
      if (step.type === 'message' && (typeof step.message !== 'string' || !step.message.trim() || step.message.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(step.message))) errors.push(`${label}: message must be 1–1000 characters of plain text`);
      if (step.type === 'runSaved' && (!/^[A-Za-z0-9_-]{1,80}$/.test(step.sequenceId) || !Number.isSafeInteger(step.revision) || step.revision < 1 || step.revision > 1000000)) errors.push(`${label}: choose a saved Branch Definition and revision`);
      if (step.type === 'delay' && (!Number.isSafeInteger(step.durationMs) || step.durationMs < 1 || step.durationMs > 600000)) errors.push(`${label}: delay must be 1–600000 ms`);
      if (step.type === 'waitUntil') {
        if (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 600000) errors.push(`${label}: timeout must be 1–600000 ms`);
        validateCondition(step.condition, label, errors, 0, custom);
      }
      if (step.type === 'if') {
        validateCondition(step.condition, label, errors, 0, custom);
        if (!step.then?.length) errors.push(`${label}: TRUE path is disconnected`);
        if (!step.else?.length) errors.push(`${label}: FALSE path is disconnected`);
        walk(step.then || [], `${label} TRUE`, depth + 1, new Set(reads)); walk(step.else || [], `${label} FALSE`, depth + 1, new Set(reads));
      }
      if (['command', 'registerRead', 'registerWrite'].includes(step.type) && !step.command?.type) errors.push(`${label}: choose a command`);
      if (step.type === 'registerRead' || step.command?.type === 'i2c_read') {
        reads.add(step.id);
        if (![...custom, ...READABLE_REGISTERS].some((item) => item.addr === step.command?.addr && item.reg === step.command?.reg && item.len === step.command?.len)) errors.push(`${label}: select a supported register and width`);
      }
      if (step.type === 'registerWrite' || step.command?.type === 'i2c_write') {
        const width = writable[step.command?.addr]?.[step.command?.reg];
        if (!width) errors.push(`${label}: select an approved writable register`);
        if (!Array.isArray(step.command?.data) || step.command.data.length !== width || step.command.data.some((byte) => !/^0x[0-9a-f]{1,2}$/i.test(byte))) errors.push(`${label}: enter ${width || 'valid'} hex byte(s)`);
        if (step.command?.addr === '0x6B' && step.command?.reg === '0x14' && (Number(step.command?.data?.[0]) & 0x40)) errors.push(`${label}: reserved bit 6 must be zero`);
      }
      if (step.type === 'command') {
        const cmd = step.command || {};
        if (cmd.type === 'set_scan_period' && (!Number.isSafeInteger(cmd.period_ms) || cmd.period_ms < 200 || cmd.period_ms > 5000)) errors.push(`${label}: scan period must be 200–5000 ms`);
        if (cmd.type === 'i2c_probe' && (!/^0x[0-9a-f]{1,2}$/i.test(cmd.addr || '') || Number(cmd.addr) < 8 || Number(cmd.addr) > 119)) errors.push(`${label}: probe address must be 0x08–0x77`);
      }
    }
  };
  walk(definition.steps, 'Branch Definition', 0);
  return errors;
}
export function cloneSequence(definition) {
  const copy = structuredClone(definition);
  delete copy.id; delete copy.revision;
  copy.name = `${copy.name} copy`;
  const reset = (steps) => steps.forEach((step) => { step.id = uid(); if (step.type === 'if') { reset(step.then); reset(step.else); } });
  reset(copy.steps);
  return copy;
}
export function moveBlock(steps, sourcePath, id, targetPath, targetIndex) {
  const source = findList(steps, sourcePath), target = findList(steps, targetPath);
  if (!source || !target) return false;
  const index = source.findIndex((step) => step.id === id);
  if (index < 0 || targetPath.some((part) => part.id === id)) return false;
  const [block] = source.splice(index, 1);
  target.splice(Math.max(0, Math.min(target.length, targetIndex - (source === target && index < targetIndex ? 1 : 0))), 0, block);
  return true;
}

// Returns { id, name, revision } when the saved list holds a newer revision of the loaded draft (edited in another client).
export function remoteChange(definition, list) {
  if (!definition?.id || !Array.isArray(list)) return null;
  const item = list.find((entry) => entry.id === definition.id);
  return item && Number(item.revision) > Number(definition.revision || 0) ? { id: item.id, name: item.name, revision: item.revision } : null;
}
