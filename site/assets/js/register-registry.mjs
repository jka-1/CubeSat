import { parseUserRegister } from './register-definition.mjs';

export const LEGACY_REGISTER_KEY = 'cubesat.sequence.registers.v1';

// The bridge is authoritative. Polling also covers separate browsers/operator sessions;
// a channel only accelerates refresh for tabs in the same browser.
export function createRegisterRegistry({ request, storage, events, channel, intervalMs = 2000 }) {
  let entries = [], pending = null, timer = null, generation = 0;
  const listeners = new Set();
  const publish = (next) => {
    if (JSON.stringify(next) === JSON.stringify(entries)) return;
    entries = next;
    for (const listener of listeners) listener();
  };
  async function refresh() {
    if (pending) return pending;
    const epoch = generation;
    pending = request('GET').then((data) => { if (epoch === generation) publish(data.registers); }).finally(() => { pending = null; });
    return pending;
  }
  async function add(input) {
    const { entry, errors } = parseUserRegister(input);
    if (errors.length) throw new Error(errors.join(' '));
    const epoch = generation;
    const data = await request('POST', entry);
    if (epoch !== generation) throw new Error('Operator session changed.');
    // Merge the committed response immediately; a following GET reconciles concurrent additions.
    if (data.register.id.startsWith('user-')) publish([...entries.filter((item) => item.id !== data.register.id), data.register].sort((a, b) => a.id.localeCompare(b.id)));
    channel?.postMessage('refresh');
    refresh().catch(() => {});
    return data.register;
  }
  async function migrate() {
    let list;
    try { list = JSON.parse(storage?.getItem(LEGACY_REGISTER_KEY) || '[]'); } catch { return; }
    if (!Array.isArray(list) || !list.length) return;
    const remaining = [];
    for (const item of list) {
      try { await add(item); } catch { remaining.push(item); }
    }
    // Conflicts/offline entries stay recoverable; never erase a failed migration.
    try { if (remaining.length) storage?.setItem(LEGACY_REGISTER_KEY, JSON.stringify(remaining)); else storage?.removeItem(LEGACY_REGISTER_KEY); } catch { /* browser storage may be disabled */ }
  }
  const retry = () => { refresh().catch(() => {}); };
  const start = () => {
    timer = setInterval(retry, intervalMs);
    events?.addEventListener('focus', retry);
    channel?.addEventListener('message', retry);
    refresh().then(migrate).catch(() => {});
  };
  const stop = () => {
    clearInterval(timer); timer = null;
    events?.removeEventListener('focus', retry);
    channel?.removeEventListener('message', retry);
  };
  return {
    list: () => entries.map((item) => ({ ...item })), add, refresh,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => { listeners.delete(listener); if (!listeners.size) stop(); };
    },
    clear() { generation++; publish([]); },
    destroy() { stop(); listeners.clear(); channel?.close(); }
  };
}
