import { RUN_METRICS } from './runs-model.mjs';

export const METRICS = RUN_METRICS.map(({ id, label, unit }) => ({ id, label, unit: unit === '°C' ? 'C' : unit }));
export const OPERATORS = ['>', '>=', '<', '<=', '==', '!='];
export const BLOCKS = [
  ['command', 'Command'], ['registerRead', 'Register read'], ['registerWrite', 'Register write'],
  ['delay', 'Delay'], ['waitUntil', 'Wait for telemetry'], ['if', 'IF / ELSE']
];
const uid = () => crypto.randomUUID();
export const comparison = () => ({ op: '>', left: { metric: METRICS[0].id }, right: { constant: 0, unit: METRICS[0].unit } });
export function makeBlock(type) {
  const id = uid();
  if (type === 'command') return { id, type, command: { type: 'led_control', enabled: true } };
  if (type === 'registerRead') return { id, type, command: { type: 'i2c_read', addr: '0x40', reg: '0x00', len: 2 } };
  if (type === 'registerWrite') return { id, type, command: { type: 'i2c_write', addr: '0x40', reg: '0x05', data: ['0x00', '0x00'] } };
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
export function validateCondition(condition, path, errors, depth = 0) {
  if (depth > 8) { errors.push(`${path}: logical nesting exceeds 8`); return; }
  if (!condition || typeof condition !== 'object') { errors.push(`${path}: condition is missing`); return; }
  if (['AND', 'OR'].includes(condition.op)) {
    if (!Array.isArray(condition.conditions) || condition.conditions.length < 2 || condition.conditions.length > 8) errors.push(`${path}: ${condition.op} needs 2–8 conditions`);
    else condition.conditions.forEach((item, i) => validateCondition(item, `${path} condition ${i + 1}`, errors, depth + 1));
  } else if (condition.op === 'NOT') validateCondition(condition.condition, `${path} NOT`, errors, depth + 1);
  else if (OPERATORS.includes(condition.op)) {
    const units = [condition.left, condition.right].map((operand) => operand?.metric ? METRICS.find((metric) => metric.id === operand.metric)?.unit : operand?.unit);
    if (!units[0] || units[0] !== units[1]) errors.push(`${path}: comparison units must match`);
    if (!condition.left?.metric && !condition.right?.metric) errors.push(`${path}: comparison needs telemetry`);
    for (const operand of [condition.left, condition.right]) if (operand && 'constant' in operand && !Number.isFinite(operand.constant)) errors.push(`${path}: enter a finite number`);
  } else errors.push(`${path}: choose a comparison or logical operator`);
}
export function validateDraft(definition) {
  const errors = [];
  if (!definition.name?.trim()) errors.push('Enter a sequence name.');
  if (definition.name?.length > 120) errors.push('Name must be 120 characters or fewer.');
  if (!definition.steps.length) errors.push('Connect at least one block to the sequence.');
  if (countBlocks(definition.steps) > 200) errors.push('Sequence exceeds 200 blocks.');
  const read = { '0x08': { one: '', two: '14 16 18 1A 36 3A 68 3E' }, '0x6B': { one: '0F 10 12 13 14 1B 1C 1E 2E 30 48', two: '31 33 35 37 39 3B 3D 41' }, '0x40': { one: '', two: '00 01 02 03 04 05 06 07 FE FF' } };
  const writable = { '0x08': { '0x3E': 2 }, '0x6B': Object.fromEntries('0F 10 12 13 14 2E 30'.split(' ').map((reg) => [`0x${reg}`, 1])), '0x40': Object.fromEntries('00 05 06 07'.split(' ').map((reg) => [`0x${reg}`, 2])) };
  const seen = new Set();
  const walk = (steps, path, depth) => {
    if (depth > 8) errors.push(`${path}: branch nesting exceeds 8`);
    for (const [index, step] of steps.entries()) {
      const label = `${path} block ${index + 1}`;
      if (!step.id || seen.has(step.id)) errors.push(`${label}: missing or duplicate block ID`);
      seen.add(step.id);
      if (step.type === 'delay' && (!Number.isSafeInteger(step.durationMs) || step.durationMs < 1 || step.durationMs > 600000)) errors.push(`${label}: delay must be 1–600000 ms`);
      if (step.type === 'waitUntil') {
        if (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 1 || step.timeoutMs > 600000) errors.push(`${label}: timeout must be 1–600000 ms`);
        validateCondition(step.condition, label, errors);
      }
      if (step.type === 'if') {
        validateCondition(step.condition, label, errors);
        if (!step.then?.length) errors.push(`${label}: TRUE path is disconnected`);
        if (!step.else?.length) errors.push(`${label}: FALSE path is disconnected`);
        walk(step.then || [], `${label} TRUE`, depth + 1); walk(step.else || [], `${label} FALSE`, depth + 1);
      }
      if (['command', 'registerRead', 'registerWrite'].includes(step.type) && !step.command?.type) errors.push(`${label}: choose a command`);
      if (step.type === 'registerRead' || step.command?.type === 'i2c_read') {
        const size = step.command?.len === 1 ? 'one' : 'two';
        const registers = read[step.command?.addr]?.[size] || '';
        if (!registers.split(' ').includes(step.command?.reg?.slice(2))) errors.push(`${label}: select a supported register and width`);
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
  walk(definition.steps, 'Sequence', 0);
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
