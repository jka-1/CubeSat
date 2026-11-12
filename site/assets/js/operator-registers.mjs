import { apiFetch, isOperator } from './auth.js?v=20261109e';
import { createRegisterRegistry } from './register-registry.mjs';
import { READABLE_REGISTERS } from './sequence-register-catalog.mjs?v=20261112-registers';
import { mergeRegisters } from './register-definition.mjs';

let storage;
try { storage = localStorage; } catch { /* persistence is provided by the bridge */ }
export const operatorRegisters = createRegisterRegistry({
  storage, events: window,
  channel: typeof window.addEventListener === 'function' && typeof BroadcastChannel === 'function' ? new BroadcastChannel('cubesat-register-registry') : null,
  async request(method, entry) {
    if (!isOperator()) throw new Error('An operator account is required.');
    const response = await apiFetch('/telemetry/registers', { method, cache: 'no-store',
      ...(entry ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) } : {}) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Register registry unavailable.'), { status: response.status });
    return data;
  }
});
window.addEventListener?.('cubesat-auth-change', () => { if (!isOperator()) operatorRegisters.clear(); });
export const availableRegisters = (own = []) => mergeRegisters(own, READABLE_REGISTERS, operatorRegisters.list());
export function registerName(item) {
  const names = { '0x6B:0x2F': 'REG2F ADC Function Disable 0', '0x6B:0x30': 'REG30 ADC Function Disable 1' };
  return names[`${item.addr}:${item.reg}`] ? `${item.label || item.reg} · ${names[`${item.addr}:${item.reg}`]}` : item.label || item.reg;
}
