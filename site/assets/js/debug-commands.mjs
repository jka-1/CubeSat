// Pure helpers for the Debug Mode page: sequence-line parsing to bridge commands and scan formatting.
// Accepts the page's short syntax and the Windows tool's i2c-tools syntax (i2cget/i2cset/i2cdetect).
import { toInt } from './register-conversions.mjs?v=20261014a';
import { commandErrorDetail } from './register-policy.mjs?v=20261027b';

const hex = (v) => `0x${toInt(v).toString(16).toUpperCase().padStart(2, '0')}`;

function i2cOpts(tokens) {
  const o = { rest: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-c' || t === '-r' || t === '-l' || t === '-s') { o[t.slice(1)] = tokens[++i]; }
    else if (t.startsWith('--')) { /* i2cconfig flags ignored */ }
    else o.rest.push(t);
  }
  return o;
}

// Returns null (blank/comment), {kind:'delay', ms}, {kind:'config'} (no-op), or {kind:'cmd', body}.
export function parseSequenceLine(line) {
  const s = String(line).split('#', 1)[0].trim();
  if (!s) return null;
  const m = s.match(/^(?:delay|sleep|wait)\s+(\d+)\s*(ms|s)?$/i);
  if (m) return { kind: 'delay', ms: Number(m[1]) * ((m[2] || 'ms').toLowerCase() === 's' ? 1000 : 1) };
  const tokens = s.split(/\s+/); const op = tokens[0].toLowerCase(); const args = tokens.slice(1);
  switch (op) {
    case 'debug': {
      const v = (args[0] || '').toLowerCase();
      if (!['on', 'off', 'enable', 'disable', '1', '0'].includes(v)) throw new Error('debug needs on|off');
      return { kind: 'cmd', body: { type: 'debug_control', enabled: ['on', 'enable', '1'].includes(v) } };
    }
    case 'period': case 'scan_period': case 'set_scan_period': {
      const ms = Number(args[0]);
      if (!Number.isInteger(ms) || ms < 200 || ms > 5000) throw new Error('period must be 200..5000 ms');
      return { kind: 'cmd', body: { type: 'set_scan_period', period_ms: ms } };
    }
    case 'scan': case 'i2cdetect': return { kind: 'cmd', body: { type: 'i2c_scan' } };
    case 'probe': if (!args[0]) throw new Error('probe needs an address'); return { kind: 'cmd', body: { type: 'i2c_probe', addr: hex(args[0]) } };
    case 'read': {
      if (args.length < 2) throw new Error('read <addr> <reg> [len]');
      return { kind: 'cmd', body: { type: 'i2c_read', addr: hex(args[0]), reg: hex(args[1]), len: args[2] ? Number(args[2]) : 2 } };
    }
    case 'write': {
      if (args.length < 3) throw new Error('write <addr> <reg> <byte> [byte...]');
      return { kind: 'cmd', body: { type: 'i2c_write', addr: hex(args[0]), reg: hex(args[1]), data: args.slice(2).map(hex) } };
    }
    case 'i2cget': {
      const o = i2cOpts(args); if (!o.c || !o.r) throw new Error('i2cget needs -c and -r over the bridge');
      return { kind: 'cmd', body: { type: 'i2c_read', addr: hex(o.c), reg: hex(o.r), len: o.l ? Number(o.l) : 1 } };
    }
    case 'i2cset': {
      const o = i2cOpts(args); if (!o.c || !o.r || !o.rest.length) throw new Error('i2cset needs -c, -r and data');
      return { kind: 'cmd', body: { type: 'i2c_write', addr: hex(o.c), reg: hex(o.r), data: o.rest.map(hex) } };
    }
    case 'i2cconfig': return { kind: 'config' };
    default: throw new Error(`unknown command: ${tokens[0]}`);
  }
}

// i2cdetect-style grid for 0x00-0x7F; '--' = no reply, '  ' = outside scanned range 0x08-0x77.
export function formatScanGrid(addresses) {
  const found = new Set((addresses || []).map((a) => toInt(a)));
  const lines = ['    ' + Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, ' ')).join(' ')];
  for (let base = 0; base < 0x80; base += 16) {
    const cells = [];
    for (let i = 0; i < 16; i++) {
      const a = base + i;
      cells.push(a < 0x08 || a > 0x77 ? '  ' : found.has(a) ? a.toString(16).padStart(2, '0') : '--');
    }
    lines.push(`${base.toString(16).padStart(2, '0')}: ${cells.join(' ')}`);
  }
  return lines.join('\n');
}

// One-line human summary of a synchronous /command?wait=1 response.
export function describeResult(body, response) {
  const r = response?.result || {};
  if (response?.status !== 'completed') {
    const error = r.error || response?.error;
    return `${response?.status || 'error'}${error ? ` ${commandErrorDetail(error)}` : ''}`;
  }
  switch (body.type) {
    case 'i2c_read': return `read ${r.addr} ${r.reg} -> ${(r.data || []).join(' ')}`;
    case 'i2c_write': return r.ok === true
      ? `ESP32 acknowledged I²C write ${r.addr} ${r.reg} <- ${(r.write_data || []).join(' ')} (no readback)`
      : 'Write result unconfirmed';
    case 'i2c_scan': return `scan found ${r.count} device(s): ${(r.addresses || []).join(' ') || 'none'} in ${r.scan_us} us`;
    case 'i2c_probe': return `probe ${r.addr}: ${r.present ? 'present' : 'no ACK'} (${r.probe_result})`;
    case 'debug_control': return `debug ${r.enabled ? 'enabled' : 'disabled'} (ack timeout ${r.ack_timeout_ms} ms)`;
    case 'set_scan_period': return `scan period ${r.period_ms} ms (requested ${r.requested_period_ms})`;
    default: return 'ok';
  }
}
