// Port of cubesat-i2c-tool/cubesat_i2c/conversions.py (value = raw * scale + offset).
// Parity with the Python is tested in telemetry-bridge/test/register-conversions.test.js.

export function bytesToRaw(data, width, endian, signed = false) {
  const bytes = Array.from(data).slice(0, width);
  if (bytes.length < width) throw new Error(`expected ${width} bytes, got ${bytes.length}`);
  const ordered = endian === 'little' ? bytes.slice().reverse() : bytes;
  let raw = 0n;
  for (const b of ordered) raw = (raw << 8n) | BigInt(b & 0xff);
  const bits = BigInt(8 * width);
  if (signed && raw >= (1n << (bits - 1n))) raw -= 1n << bits;
  return Number(raw);
}

// Python '%.*f' semantics: exact binary value, ties to even (JS toFixed rounds ties up).
export function formatFixed(x, precision) {
  const neg = x < 0 || Object.is(x, -0);
  const exact = Math.abs(x).toFixed(Math.min(100, precision + 60));
  const [intPart, fracPart = ''] = exact.split('.');
  let digits = intPart + fracPart.slice(0, precision);
  const rest = fracPart.slice(precision);
  let roundUp = false;
  if (rest[0] > '5') roundUp = true;
  else if (rest[0] === '5') roundUp = /[1-9]/.test(rest.slice(1)) || (Number(digits[digits.length - 1]) % 2 === 1);
  if (roundUp) {
    const arr = digits.split('');
    let i = arr.length - 1;
    while (i >= 0) { if (arr[i] === '9') { arr[i] = '0'; i--; } else { arr[i] = String(Number(arr[i]) + 1); break; } }
    digits = (i < 0 ? '1' : '') + arr.join('');
  }
  const ip = digits.slice(0, digits.length - precision) || '0';
  const out = precision > 0 ? `${ip}.${digits.slice(digits.length - precision)}` : ip;
  return (neg ? '-' : '') + out.replace(/^0+(?=\d)/, '');
}

export function decodeBits(reg, raw) {
  const fields = reg.bitfields || [];
  if (!fields.length) return '';
  const parts = fields.map((f) => {
    const [hi, lo] = Array.isArray(f.bits) ? f.bits : [f.bits, f.bits];
    const v = Math.floor(raw / 2 ** lo) & ((1 << (hi - lo + 1)) - 1);
    return `${f.name}=${v}`;
  });
  return `  [${parts.join(', ')}]`;
}

export function convert(reg, data) {
  const width = Number(reg.width ?? 1);
  const raw = bytesToRaw(data, width, reg.endian ?? 'big', !!reg.signed);
  const unit = reg.unit ?? '';
  const mask = 2 ** (8 * width);
  if (reg.scale === null || reg.scale === undefined) {
    const u = ((raw % mask) + mask) % mask;
    const bits = u.toString(2).padStart(8 * width, '0');
    return { raw, value: null, text: `0x${u.toString(16).toUpperCase().padStart(2 * width, '0')} (0b${bits})${decodeBits(reg, raw)}` };
  }
  const value = raw * Number(reg.scale) + Number(reg.offset ?? 0);
  const prec = Number(reg.precision ?? 3);
  return { raw, value, text: `${formatFixed(value, prec)} ${unit}` };
}

// Integer/text -> bus-order bytes (port of protocol.value_to_bytes / parse_value_input).
export function toInt(v) {
  if (typeof v === 'number') return v;
  const s = String(v).trim().toLowerCase();
  if (s.startsWith('0x')) return parseInt(s.slice(2), 16);
  if (s.startsWith('0b')) return parseInt(s.slice(2), 2);
  if (/^-?[0-9]+$/.test(s)) return parseInt(s, 10);
  if (/^[0-9a-f]+$/.test(s)) return parseInt(s, 16);
  throw new Error(`invalid number: ${v}`);
}

export function valueToBytes(value, width, endian) {
  let v = BigInt(toInt(value));
  const bits = BigInt(8 * width);
  if (v < 0n) v &= (1n << bits) - 1n;
  if (v >= (1n << bits)) throw new Error(`value 0x${v.toString(16)} does not fit in ${width} byte(s)`);
  const out = [];
  for (let i = 0; i < width; i++) out.unshift(Number((v >> BigInt(8 * i)) & 0xffn));
  return endian === 'little' ? out.reverse() : out;
}

export function parseValueInput(text, width, endian) {
  const parts = String(text).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error('empty value');
  if (parts.length > 1) {
    const out = parts.map(toInt);
    if (out.some((b) => !(b >= 0 && b <= 0xff))) throw new Error('each byte must be 0x00-0xff');
    return out;
  }
  return valueToBytes(parts[0], width, endian);
}
