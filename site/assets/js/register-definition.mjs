export const hex2 = (value) => `0x${Number(value).toString(16).toUpperCase().padStart(2, '0')}`;
export function parseUserRegister({ addr, reg, len = 1, endian = 'big', label = '' } = {}) {
  const errors = [];
  const a = String(addr ?? '').trim(), r = String(reg ?? '').trim(), name = String(label ?? '').trim();
  const asHex = (text) => /^(0x)?[0-9a-f]{1,2}$/i.test(text) ? parseInt(text.replace(/^0x/i, ''), 16) : NaN;
  const addrValue = asHex(a), regValue = asHex(r);
  if (!(addrValue >= 0x08 && addrValue <= 0x77)) errors.push('Device address must be a 7-bit hex address 0x08–0x77.');
  if (!(regValue >= 0 && regValue <= 0xff)) errors.push('Register must be hex 0x00–0xFF.');
  if (![1, 2].includes(Number(len))) errors.push('Width must be 1 or 2 bytes.');
  if (!['big', 'little'].includes(endian)) errors.push('Byte order must be big or little endian.');
  if (name.length > 60) errors.push('Label must be 60 characters or fewer.');
  if (errors.length) return { errors };
  const entry = { id: `user-${hex2(addrValue).slice(2)}-${hex2(regValue).slice(2)}-${Number(len)}`, addr: hex2(addrValue), reg: hex2(regValue), len: Number(len), endian };
  if (name) entry.label = name;
  return { entry, errors: [] };
}
export const userRegisterLabel = (item) => `${item.label ? `${item.label} · ` : ''}${item.addr} ${item.reg} (${item.len} B${item.len === 2 ? `, ${item.endian}` : ''})`;

export const registerKey = (item) => `${item.addr}:${item.reg}:${item.len}`;
// Definition snapshots take precedence: refreshing the registry never rewrites saved/unsaved metadata.
export function mergeRegisters(...lists) {
  const entries = new Map();
  for (const list of lists) for (const item of list) if (!entries.has(registerKey(item))) entries.set(registerKey(item), item);
  return [...entries.values()];
}
