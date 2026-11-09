import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function harness(role = null, route = 'dashboard') {
  const nodes = new Map(), events = new Map(), requests = [];
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, value: '', textContent: '', innerHTML: '', clientWidth: 800, scrollWidth: 100,
      addEventListener(type, handler) { this[type] = handler; }, setAttribute() {}, removeAttribute() {}, focus() {},
      replaceChildren() { this.innerHTML = ''; }, querySelectorAll() { return []; }, querySelector() { return null; } });
    return nodes.get(id);
  };
  let hash = '#' + route, serverRole = role;
  const window = {
    addEventListener(type, handler) { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
    dispatchEvent(event) { for (const handler of events.get(event.type) || []) handler(event); }
  };
  const location = { href: 'http://localhost/', get hash() { return hash; }, set hash(value) {
    const next = '#' + value.replace(/^#/, ''); if (hash === next) return;
    hash = next; queueMicrotask(() => window.dispatchEvent({ type: 'hashchange' }));
  } };
  window.location = location;
  const session = () => ({ enabled: true, user: serverRole ? { username: serverRole, role: serverRole } : null, control_active: serverRole === 'operator', csrf: 'test' });
  const context = vm.createContext({ window, location, URL, Headers, Event, console,
    document: { hidden: false, getElementById: node, querySelectorAll: () => [] },
    history: { replaceState(_state, _unused, value) { hash = value; } },
    requestAnimationFrame: queueMicrotask, setInterval: () => 0,
    ResizeObserver: class { observe() {} }, isStreamingMode: () => false,
    fetch: async (url, options = {}) => {
      requests.push(url);
      if (url.endsWith('/login')) serverRole = JSON.parse(options.body).username;
      const unauthorized = url.endsWith('/me') && !serverRole;
      return { ok: !unauthorized, status: unauthorized ? 401 : 200,
        json: async () => unauthorized ? { error: 'Sign in' } : session(), text: async () => '<section>Protected content</section>' };
    }
  });
  for (const name of ['I2C', 'LinkHealth', 'DebugMode', 'Sequences', 'Runs', 'Twin']) {
    context[`init${name}Page`] = () => {}; context[`destroy${name}Page`] = () => {};
  }
  for (const file of ['auth.js', 'router.js']) {
    const source = await readFile(new URL('../../site/assets/js/' + file, import.meta.url), 'utf8');
    vm.runInContext(source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, ''), context);
  }
  await vm.runInContext('initAuth()', context); vm.runInContext('initRouter()', context);
  const flush = () => new Promise(setImmediate);
  await flush();
  const login = async (username) => {
    node('accountUsername').value = username; node('accountPassword').value = 'test';
    await node('accountForm').submit({ preventDefault() {} }); await flush();
  };
  return { node, context, requests, location, login, flush, expire: () => { serverRole = null; } };
}

test('dashboard requires login and resumes the requested viewer section after sign-in', async () => {
  const h = await harness();
  assert.equal(h.location.hash, '#account');
  assert.ok(!h.requests.some((url) => url.includes('/modules/') || url.includes('/operator-pages/')));
  await h.login('viewer');
  assert.equal(h.location.hash, '#communication');
  assert.ok(h.requests.some((url) => url.includes('/modules/communication.html')));
});

test('restricted routes show an error and support switching a viewer to an operator', async () => {
  const h = await harness('viewer', 'sequences');
  assert.match(h.node('page-root').innerHTML, /Operator access required/);
  assert.ok(!h.requests.some((url) => url.includes('/operator-pages/')));
  h.node('operatorSignIn').click(); await h.flush();
  assert.equal(h.location.hash, '#account');
  assert.equal(h.node('accountForm').hidden, false);
  assert.equal(h.node('accountTitle').textContent, 'Sign in as operator');
  await h.login('viewer');
  assert.equal(h.location.hash, '#account');
  assert.match(h.node('accountMessage').textContent, /does not have operator access/);
  await h.login('operator');
  assert.equal(h.location.hash, '#sequences');
  assert.ok(h.requests.includes('/telemetry/operator-pages/sequences'));
  h.expire(); await vm.runInContext('refreshSession()', h.context); await h.flush();
  assert.match(h.node('page-root').innerHTML, /Operator access required/);
  assert.doesNotMatch(h.node('page-root').innerHTML, /Protected content/);
});

test('manual no longer links back to the CubeSat site', async () => {
  const html = await readFile(new URL('../auth/views/manual-document.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /Back to the CubeSat site|href="\/index.html#home"/);
});
