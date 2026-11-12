import { READABLE_REGISTERS } from './sequence/register-catalog.mjs';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const hex = (value, min, max) => {
  if (typeof value !== 'string' || !/^(0x)?[0-9a-f]{1,2}$/i.test(value.trim())) fail('Invalid register address');
  const number = parseInt(value.replace(/^0x/i, ''), 16);
  if (number < min || number > max) fail('Invalid register address');
  return `0x${number.toString(16).toUpperCase().padStart(2, '0')}`;
};
export function registryEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !['id', 'addr', 'reg', 'len', 'endian', 'label'].includes(key))) fail('Invalid register definition');
  const addr = hex(input.addr, 8, 119), reg = hex(input.reg, 0, 255);
  if (![1, 2].includes(input.len) || !['big', 'little'].includes(input.endian)) fail('Invalid register width or byte order');
  if (input.label !== undefined && (typeof input.label !== 'string' || input.label.trim().length > 60)) fail('Invalid register label');
  const entry = { id: `user-${addr.slice(2)}-${reg.slice(2)}-${input.len}`, addr, reg, len: input.len, endian: input.endian };
  if (input.label?.trim()) entry.label = input.label.trim();
  return entry;
}

// One physical target per shared entry. First committed metadata wins; exact retries are idempotent.
// This catalog never participates in the command write allowlist.
export function existingRegistryEntry(entry, list) {
  const builtin = READABLE_REGISTERS.find((item) => item.addr === entry.addr && item.reg === entry.reg);
  const existing = builtin || list.find((item) => item.addr === entry.addr && item.reg === entry.reg);
  if (!existing) return null;
  if (existing.len !== entry.len || existing.endian !== entry.endian ||
      !builtin && entry.label && existing.label !== entry.label) fail('Register already exists with different metadata', 409);
  return existing;
}
