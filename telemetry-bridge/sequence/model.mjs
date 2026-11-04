import { METRICS } from '../recording/store.mjs';
import { CONDITION_REGISTERS, CONDITION_FAULTS } from './condition-fields.mjs';
import { READABLE_REGISTERS } from './register-catalog.mjs';

const units = Object.freeze(Object.fromEntries(Object.keys(METRICS).map((key) => [key,
  key.endsWith('Mv') ? 'mV' : key.endsWith('A') ? 'A' : key.endsWith('W') ? 'W' : key.endsWith('C') ? 'C' : 'V'
])));
const actions = new Set(['i2c_read', 'i2c_write', 'sensor_control', 'mppt_acdrv_control', 'led_control', 'debug_control', 'set_scan_period', 'i2c_scan', 'i2c_probe']);
const commandFields = {
  i2c_read: ['type', 'addr', 'reg', 'len'], i2c_write: ['type', 'addr', 'reg', 'data'],
  sensor_control: ['type', 'sensor', 'enabled'], mppt_acdrv_control: ['type', 'state'],
  led_control: ['type', 'enabled'], debug_control: ['type', 'enabled'],
  set_scan_period: ['type', 'period_ms'], i2c_scan: ['type'], i2c_probe: ['type', 'addr']
};
const comparisons = new Set(['==', '!=', '<', '<=', '>', '>=', '&']);
const bad = (message) => { throw new Error(message); };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, label) => {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) bad(`Invalid ${label}`);
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) bad(`Invalid ${label}`);
};

// User-added condition registers live in definition.registers; each is read live at evaluation time.
export const USER_REGISTER_LIMIT = 32;
const hexByte = (value, min, max) => typeof value === 'string' && /^0x[0-9a-f]{1,2}$/i.test(value) && Number(value) >= min && Number(value) <= max;
export const normalizeHex = (value) => `0x${Number(value).toString(16).toUpperCase().padStart(2, '0')}`;
export function validateUserRegisters(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > USER_REGISTER_LIMIT) bad('Invalid user register list');
  const ids = new Set(), targets = new Set();
  return list.map((item) => {
    keys(item, ['id', 'label', 'addr', 'reg', 'len', 'endian'], 'user register');
    if (typeof item.id !== 'string' || !/^user-[A-Za-z0-9_-]{1,60}$/.test(item.id) || ids.has(item.id)) bad('Invalid or duplicate user register id');
    if (!hexByte(item.addr, 0x08, 0x77)) bad('User register address must be a 7-bit address 0x08–0x77');
    if (!hexByte(item.reg, 0x00, 0xff)) bad('User register must be 0x00–0xFF');
    if (![1, 2].includes(item.len)) bad('User register width must be 1 or 2 bytes');
    if (!['big', 'little'].includes(item.endian)) bad('User register byte order must be big or little');
    if (item.label !== undefined && (typeof item.label !== 'string' || item.label.length > 60)) bad('User register label must be 60 characters or fewer');
    const target = `${Number(item.addr)}:${Number(item.reg)}:${item.len}`;
    if (targets.has(target)) bad('Duplicate user register');
    ids.add(item.id); targets.add(target);
    return Object.freeze({ ...item, addr: normalizeHex(item.addr), reg: normalizeHex(item.reg) });
  });
}
const registerField = (id, custom = []) => CONDITION_REGISTERS.find((item) => item.id === id) || custom.find((item) => item.id === id);

function operand(value, custom = []) {
  keys(value, ['metric', 'register', 'fault', 'constant', 'unit', 'step'], 'operand');
  if (typeof value.step === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.step) && Object.keys(value).length === 1) return 'hex';
  if (typeof value.metric === 'string' && Object.hasOwn(units, value.metric) && Object.keys(value).length === 1) return units[value.metric];
  if (typeof value.register === 'string' && registerField(value.register, custom) && Object.keys(value).length === 1) return 'hex';
  if (CONDITION_FAULTS.includes(value.fault) && Object.keys(value).length === 1) return 'boolean';
  if (typeof value.constant === 'number' && Number.isFinite(value.constant) && typeof value.unit === 'string' && [...Object.values(units), 'hex'].includes(value.unit) && Object.keys(value).length === 2 &&
    (value.unit !== 'hex' || Number.isSafeInteger(value.constant) && value.constant >= 0 && value.constant <= 0xffff)) return value.unit;
  if (typeof value.constant === 'boolean' && value.unit === 'boolean' && Object.keys(value).length === 2) return 'boolean';
  bad('Invalid condition operand');
}

export function conditionSteps(condition, out = []) {
  if (!object(condition)) return out;
  if (condition.op === 'NOT') return conditionSteps(condition.condition, out);
  if (condition.op === 'AND' || condition.op === 'OR') { (condition.conditions || []).forEach((part) => conditionSteps(part, out)); return out; }
  for (const side of ['left', 'right']) if (typeof condition[side]?.step === 'string') out.push(condition[side].step);
  return out;
}

export function validateCondition(condition, depth = 0, custom = []) {
  if (depth > 8) bad('Condition nesting limit exceeded');
  if (!object(condition)) bad('Invalid condition');
  if (condition.op === 'AND' || condition.op === 'OR') {
    keys(condition, ['op', 'conditions'], 'logical condition');
    if (!Array.isArray(condition.conditions) || condition.conditions.length < 2 || condition.conditions.length > 8) bad('Invalid logical operands');
    condition.conditions.forEach((part) => validateCondition(part, depth + 1, custom));
  } else if (condition.op === 'NOT') {
    keys(condition, ['op', 'condition'], 'NOT condition');
    validateCondition(condition.condition, depth + 1, custom);
  } else if (comparisons.has(condition.op)) {
    keys(condition, ['op', 'left', 'right'], 'comparison');
    const leftType = operand(condition.left, custom), rightType = operand(condition.right, custom);
    if (leftType !== rightType) bad(`Comparison types or formats differ (${leftType} versus ${rightType})`);
    if (leftType === 'boolean' && !['==', '!='].includes(condition.op)) bad('Fault flags support == and != only');
    if (condition.op === '&' && leftType !== 'hex') bad('Bit-mask AND (&) needs register or hex values');
    if (condition.left.constant !== undefined && condition.right.constant !== undefined) bad('Comparison requires telemetry, register, or fault flag');
  } else bad('Unsupported condition operator');
}

export function evaluateCondition(condition, envelope, registerValues = {}, custom = []) {
  if (condition.op === 'NOT') {
    const result = evaluateCondition(condition.condition, envelope, registerValues, custom);
    return result === null ? null : !result;
  }
  if (condition.op === 'AND' || condition.op === 'OR') {
    const values = condition.conditions.map((part) => evaluateCondition(part, envelope, registerValues, custom));
    if (condition.op === 'AND') return values.includes(false) ? false : values.includes(null) ? null : true;
    return values.includes(true) ? true : values.includes(null) ? null : false;
  }
  const read = (item) => {
    if (item.constant !== undefined) return item.constant;
    if (item.step !== undefined) { const value = registerValues[`step:${item.step}`]; return Number.isInteger(value) ? value : null; }
    const available = (group) => {
      const mask = { pv: 1, bms: 2, mppt: 4 }[group];
      const active = envelope?.packet?.sensor_polling?.active_sensor_mask;
      return envelope?.packet?.telemetry?.[group]?.available !== false &&
        (!Number.isInteger(active) || !mask || Boolean(active & mask)) &&
        (!envelope?.packet?.debug?.devices?.[group]?.state || envelope.packet.debug.devices[group].state === 'present');
    };
    if (item.fault !== undefined) {
      if (!available('mppt')) return null;
      const mask = envelope?.packet?.raw?.mppt?.fault20;
      if (Number.isInteger(mask)) return Boolean(mask & (1 << CONDITION_FAULTS.indexOf(item.fault)));
      const faults = envelope?.packet?.telemetry?.mppt?.faults;
      return Array.isArray(faults) ? faults.includes(item.fault) : null;
    }
    if (item.register !== undefined) {
      const field = registerField(item.register, custom);
      if (!field || !field.addr && !available(field.group)) return null;
      const value = field.path ? field.path.reduce((current, key) => current?.[key], envelope?.packet?.raw) : registerValues[field.id];
      return Number.isInteger(value) ? value : null;
    }
    const parts = METRICS[item.metric].slice('$.packet.telemetry.'.length).replace(/\[(\d+)\]/g, '.$1').split('.');
    let value = envelope?.packet?.telemetry;
    for (const part of parts) value = value?.[part];
    const group = item.metric.split('.')[0];
    const mask = { pv: 1, bms: 2, mppt: 4 }[group];
    const activeMask = envelope?.packet?.sensor_polling?.active_sensor_mask;
    if (mask && Number.isInteger(activeMask) && !(activeMask & mask)) return null;
    if (envelope?.packet?.telemetry?.[group]?.available === false || envelope?.packet?.debug?.devices?.[group]?.state && envelope.packet.debug.devices[group].state !== 'present') return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const left = read(condition.left), right = read(condition.right);
  if (left === null || right === null) return null;
  switch (condition.op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '&': return (left & right) !== 0;
  }
}

export function validateSequence(definition, validateCommand) {
  keys(definition, ['schemaVersion', 'id', 'revision', 'name', 'registers', 'steps'], 'sequence');
  if (definition.schemaVersion !== 1 || typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 120) bad('Invalid sequence header');
  if (definition.id !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(definition.id)) bad('Invalid sequence id');
  if (definition.revision !== undefined) integer(definition.revision, 1, 1_000_000, 'revision');
  const custom = validateUserRegisters(definition.registers);
  const ids = new Set();
  let count = 0;
  const refs = (condition, reads) => {
    for (const id of conditionSteps(condition)) if (!reads.has(id)) bad('Condition references a block result that is not an earlier register read on this path');
  };
  const walk = (steps, depth, reads = new Set()) => {
    if (!Array.isArray(steps) || depth > 8) bad('Invalid sequence steps');
    for (const step of steps) {
      if (++count > 200) bad('Sequence block limit exceeded');
      if (!object(step) || typeof step.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(step.id) || ids.has(step.id)) bad('Invalid or duplicate block id');
      ids.add(step.id);
      if (step.type === 'command' || step.type === 'registerRead' || step.type === 'registerWrite') {
        keys(step, ['id', 'type', 'command'], 'command block');
        if (!object(step.command) || !actions.has(step.command.type) || Object.keys(step.command).some((key) => !commandFields[step.command.type].includes(key))) bad('Unsafe command');
        if (step.type === 'registerRead' && step.command.type !== 'i2c_read' || step.type === 'registerWrite' && step.command.type !== 'i2c_write') bad('Register block command mismatch');
        const normalized = validateCommand(step.command);
        if (step.command.type === 'i2c_read') reads.add(step.id);
        if (step.command.type === 'i2c_read' && !READABLE_REGISTERS.some((item) => item.addr === normalized.expectedResult.addr && item.reg === normalized.expectedResult.reg && item.len === normalized.expectedResult.len)) bad('Unsupported register read or width');
      } else if (step.type === 'delay') {
        keys(step, ['id', 'type', 'durationMs'], 'delay block');
        integer(step.durationMs, 1, 600_000, 'delay');
      } else if (step.type === 'waitUntil') {
        keys(step, ['id', 'type', 'condition', 'timeoutMs'], 'wait block');
        integer(step.timeoutMs, 1, 600_000, 'wait timeout');
        validateCondition(step.condition, 0, custom);
        refs(step.condition, reads);
      } else if (step.type === 'if') {
        keys(step, ['id', 'type', 'condition', 'then', 'else'], 'IF block');
        validateCondition(step.condition, 0, custom);
        refs(step.condition, reads);
        walk(step.then, depth + 1, new Set(reads));
        walk(step.else || [], depth + 1, new Set(reads));
      } else bad('Unsupported block type');
    }
  };
  walk(definition.steps, 0);
  if (count === 0 || Buffer.byteLength(JSON.stringify(definition)) > 65536) bad('Sequence is empty or too large');
  const copy = structuredClone(definition);
  if (definition.registers !== undefined) copy.registers = custom.map((item) => ({ ...item }));
  return copy;
}
