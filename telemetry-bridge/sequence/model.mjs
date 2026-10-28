import { METRICS } from '../recording/store.mjs';

const units = Object.freeze(Object.fromEntries(Object.keys(METRICS).map((key) => [key,
  key.endsWith('Mv') ? 'mV' : key.endsWith('A') ? 'A' : key.endsWith('W') ? 'W' : key.endsWith('C') ? 'C' : 'V'
])));
const actions = new Set(['i2c_read', 'i2c_write', 'sensor_control', 'mppt_acdrv_control', 'led_control', 'debug_control', 'set_scan_period', 'i2c_scan', 'i2c_probe']);
const readWidths = new Map([
  ['0x08', new Map('14 16 18 1A 36 3A 68 3E'.split(' ').map((reg) => [`0x${reg}`, 2]))],
  ['0x6B', new Map([...('0F 10 12 13 14 1B 1C 1E 2E 30 48'.split(' ').map((reg) => [`0x${reg}`, 1])), ...('31 33 35 37 39 3B 3D 41'.split(' ').map((reg) => [`0x${reg}`, 2]))])],
  ['0x40', new Map('00 01 02 03 04 05 06 07 FE FF'.split(' ').map((reg) => [`0x${reg}`, 2]))]
]);
const commandFields = {
  i2c_read: ['type', 'addr', 'reg', 'len'], i2c_write: ['type', 'addr', 'reg', 'data'],
  sensor_control: ['type', 'sensor', 'enabled'], mppt_acdrv_control: ['type', 'state'],
  led_control: ['type', 'enabled'], debug_control: ['type', 'enabled'],
  set_scan_period: ['type', 'period_ms'], i2c_scan: ['type'], i2c_probe: ['type', 'addr']
};
const comparisons = new Set(['==', '!=', '<', '<=', '>', '>=']);
const bad = (message) => { throw new Error(message); };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, label) => {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) bad(`Invalid ${label}`);
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) bad(`Invalid ${label}`);
};

function operand(value) {
  keys(value, ['metric', 'constant', 'unit'], 'operand');
  if (typeof value.metric === 'string' && Object.hasOwn(units, value.metric) && value.constant === undefined && value.unit === undefined) return units[value.metric];
  if (typeof value.constant === 'number' && Number.isFinite(value.constant) && typeof value.unit === 'string' && Object.values(units).includes(value.unit) && value.metric === undefined) return value.unit;
  bad('Invalid telemetry operand');
}

export function validateCondition(condition, depth = 0) {
  if (depth > 8) bad('Condition nesting limit exceeded');
  if (!object(condition)) bad('Invalid condition');
  if (condition.op === 'AND' || condition.op === 'OR') {
    keys(condition, ['op', 'conditions'], 'logical condition');
    if (!Array.isArray(condition.conditions) || condition.conditions.length < 2 || condition.conditions.length > 8) bad('Invalid logical operands');
    condition.conditions.forEach((part) => validateCondition(part, depth + 1));
  } else if (condition.op === 'NOT') {
    keys(condition, ['op', 'condition'], 'NOT condition');
    validateCondition(condition.condition, depth + 1);
  } else if (comparisons.has(condition.op)) {
    keys(condition, ['op', 'left', 'right'], 'comparison');
    if (operand(condition.left) !== operand(condition.right)) bad('Comparison units differ');
    if (condition.left.metric === undefined && condition.right.metric === undefined) bad('Comparison requires telemetry');
  } else bad('Unsupported condition operator');
}

export function evaluateCondition(condition, envelope) {
  if (condition.op === 'NOT') {
    const result = evaluateCondition(condition.condition, envelope);
    return result === null ? null : !result;
  }
  if (condition.op === 'AND' || condition.op === 'OR') {
    const values = condition.conditions.map((part) => evaluateCondition(part, envelope));
    if (condition.op === 'AND') return values.includes(false) ? false : values.includes(null) ? null : true;
    return values.includes(true) ? true : values.includes(null) ? null : false;
  }
  const read = (item) => {
    if (item.constant !== undefined) return item.constant;
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
  }
}

export function validateSequence(definition, validateCommand) {
  keys(definition, ['schemaVersion', 'id', 'revision', 'name', 'steps'], 'sequence');
  if (definition.schemaVersion !== 1 || typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 120) bad('Invalid sequence header');
  if (definition.id !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(definition.id)) bad('Invalid sequence id');
  if (definition.revision !== undefined) integer(definition.revision, 1, 1_000_000, 'revision');
  const ids = new Set();
  let count = 0;
  const walk = (steps, depth) => {
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
        if (step.command.type === 'i2c_read' && readWidths.get(normalized.expectedResult.addr)?.get(normalized.expectedResult.reg) !== normalized.expectedResult.len) bad('Unsupported register read or width');
      } else if (step.type === 'delay') {
        keys(step, ['id', 'type', 'durationMs'], 'delay block');
        integer(step.durationMs, 1, 600_000, 'delay');
      } else if (step.type === 'waitUntil') {
        keys(step, ['id', 'type', 'condition', 'timeoutMs'], 'wait block');
        integer(step.timeoutMs, 1, 600_000, 'wait timeout');
        validateCondition(step.condition);
      } else if (step.type === 'if') {
        keys(step, ['id', 'type', 'condition', 'then', 'else'], 'IF block');
        validateCondition(step.condition);
        walk(step.then, depth + 1);
        walk(step.else || [], depth + 1);
      } else bad('Unsupported block type');
    }
  };
  walk(definition.steps, 0);
  if (count === 0 || Buffer.byteLength(JSON.stringify(definition)) > 65536) bad('Sequence is empty or too large');
  return structuredClone(definition);
}
