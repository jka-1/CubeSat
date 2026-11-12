import { availableRegisters, operatorRegisters, registerName } from './operator-registers.mjs';
import { WRITABLE_REGISTER_WIDTHS } from './register-policy.mjs?v=20261112-registers';

// Suggestions preserve manual free-text commands. Selecting a known read also restores its width.
export function mountRegisterSuggestions() {
  const addr = document.getElementById('debugAddrInput'), reg = document.getElementById('debugRegInput');
  if (!addr || !reg) return () => {};
  const kind = document.getElementById('debugCommandType'), len = document.getElementById('debugLenInput');
  const addresses = document.createElement('datalist'), registers = document.createElement('datalist');
  addresses.id = 'operatorDeviceSuggestions'; registers.id = 'operatorRegisterSuggestions';
  addr.setAttribute('list', addresses.id); reg.setAttribute('list', registers.id);
  reg.after(addresses, registers);
  const refresh = () => {
    const entries = availableRegisters(), writing = kind.value === 'i2c_write';
    addresses.replaceChildren(...[...new Set(entries.map((item) => item.addr))].map((value) => new Option(value, value)));
    registers.replaceChildren(...entries.filter((item) => item.addr.toUpperCase() === addr.value.trim().toUpperCase() &&
      (!writing || WRITABLE_REGISTER_WIDTHS[item.addr]?.[item.reg] === item.len))
      .map((item) => new Option(`${registerName(item)} (${item.len} B, ${item.endian})`, item.reg)));
  };
  const select = () => {
    const entry = availableRegisters().find((item) => item.addr.toUpperCase() === addr.value.trim().toUpperCase() && item.reg.toUpperCase() === reg.value.trim().toUpperCase());
    if (entry && kind.value === 'i2c_read') len.value = String(entry.len);
  };
  addr.addEventListener('input', refresh); kind.addEventListener('change', refresh); reg.addEventListener('change', select);
  const unsubscribe = operatorRegisters.subscribe(refresh);
  refresh();
  return () => {
    unsubscribe(); addr.removeEventListener('input', refresh); kind.removeEventListener('change', refresh); reg.removeEventListener('change', select);
    addresses.remove(); registers.remove();
  };
}
