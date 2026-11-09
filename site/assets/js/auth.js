// JWT stays in an HttpOnly cookie. Only the CSRF value lives in page memory.
let state = { enabled: null, user: null };
let returnRoute = 'home';
const $ = (id) => document.getElementById(id);
const authUrl = '/telemetry/auth/';
function notice(message) { $('accountMessage').textContent = message; }
export function showAccount(from = location.hash.slice(1) || 'home') {
  if (from !== 'account') returnRoute = from;
  location.hash = 'account';
  requestAnimationFrame(() => ($('accountForm').hidden ? $('accountBack') : $('accountUsername')).focus());
}
function leaveAccount() {
  location.hash = returnRoute;
  $('accountButton').focus();
}
function update(next) {
  const changed = JSON.stringify(state.user) !== JSON.stringify(next.user) ||
    state.enabled !== next.enabled || state.control_active !== next.control_active;
  state = next;
  $('accountButton').hidden = false;
  $('accountButton').textContent = state.user?.username || 'Sign in';
  $('accountButton').setAttribute('aria-label', state.user
    ? `Open account for ${state.user.username}`
    : 'Sign in');
  $('accountForm').hidden = !!state.user || state.enabled !== true;
  $('accountLogout').hidden = !state.user;
  $('accountRetry').hidden = state.enabled !== null;
  $('accountTitle').textContent = state.user ? 'Your account' : 'Sign in';
  $('accountHelp').textContent = state.user
    ? `Signed in as ${state.user.username} (${state.user.role}). ${state.user.role === 'viewer' ? 'You can view telemetry and saved runs.' : `Controls ${state.control_active ? 'active' : 'inactive'}; hardware commands also require the command token.`}`
    : state.enabled === false ? 'Website sign-in is not configured on this bridge. Public telemetry remains available.'
    : 'Live telemetry is public. Sign in to view saved runs or use your assigned operator permissions.';
  if (changed) window.dispatchEvent(new Event('cubesat-auth-change'));
}
async function jsonRequest(path, options = {}) {
  const response = await fetch(authUrl + path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to sign in. Try again.'), { status: response.status });
  return data;
}
export async function refreshSession() {
  try {
    const data = await jsonRequest('me');
    update(data);
  } catch (error) {
    if (error.status === 401) update({ enabled: true, user: null });
    else { update({ enabled: null, user: null }); notice('Cannot reach the login service. Check the bridge connection and retry.'); }
  }
}
// Saving Branch Definitions only needs an operator account; the exclusive control lease is for hardware.
export function isOperator() { return state.enabled === true && state.user?.role === 'operator'; }
export function isSignedIn() { return state.enabled === true && Boolean(state.user); }
export function canEditSequences() { return isOperator(); }
export function controlActive() { return isOperator() && Boolean(state.control_active); }
export function canOperate() { return controlActive(); }
export function allowRoute(route) {
  return ['home', 'dashboard', 'communication', 'link-health', 'runs', 'twin'].includes(route) || isOperator();
}
export function telemetryUrl(url) {
  const target = new URL(url, location.href);
  if (!isOperator() && target.origin === location.origin && /^\/telemetry\/(events|health|latest)$/.test(target.pathname)) {
    target.pathname = target.pathname.replace('/telemetry/', '/telemetry/public/');
    return target.href;
  }
  return url;
}
export async function apiFetch(url, options = {}) {
  const target = new URL(url, location.href);
  const headers = new Headers(options.headers);
  if (state.enabled !== false && !['GET', 'HEAD'].includes(options.method || 'GET')) {
    if (target.origin !== location.origin) throw new Error('Signed-in commands must use the same site as login.');
    if (!isOperator()) throw new Error('An operator account is required.');
    headers.set('X-CSRF-Token', state.csrf);
  }
  if (!['GET', 'HEAD'].includes(options.method || 'GET') && !isOperator()) throw new Error('An operator account is required.');
  const response = await fetch(['GET', 'HEAD'].includes(options.method || 'GET') ? telemetryUrl(url) : url, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401 && state.enabled !== false) await refreshSession();
  return response;
}
export async function initAuth() {
  $('accountButton').addEventListener('click', () => showAccount());
  $('accountBack').addEventListener('click', leaveAccount);
  $('accountRetry').addEventListener('click', refreshSession);
  $('accountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('accountSubmit'); button.disabled = true; button.textContent = 'Signing in…'; notice('');
    try {
      const credentials = { username: $('accountUsername').value.trim(), password: $('accountPassword').value };
      const send = (body) => jsonRequest('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let data, editOnly = false;
      try { data = await send(credentials); }
      catch (error) {
        // Another operator (e.g. the desktop app) holds control: sign in for editing only.
        if (error.status !== 409) throw error;
        data = await send({ ...credentials, control: false }); editOnly = true;
      }
      $('accountPassword').value = ''; update(data); leaveAccount();
      notice(editOnly ? 'Another operator has control. You are signed in for editing; hardware controls stay inactive until control is free.' : '');
    } catch (error) { notice(error.message); }
    finally { button.disabled = false; button.textContent = 'Sign in'; }
  });
  $('accountLogout').addEventListener('click', async () => {
    $('accountLogout').disabled = true;
    try {
      await jsonRequest('logout', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf } });
      update({ enabled: true, user: null }); notice('You are signed out.');
      location.hash = 'communication';
      window.dispatchEvent(new Event('cubesat-session-ended'));
    } catch (error) {
      if (error.status === 401) { update({ enabled: true, user: null }); location.hash = 'communication'; notice('You are signed out.'); }
      else notice(error.message);
    } finally { $('accountLogout').disabled = false; }
  });
  await refreshSession();
  window.addEventListener('focus', refreshSession);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) { update({ enabled: null, user: null }); refreshSession(); }
  });
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cubesat-session') : null;
  channel?.addEventListener('message', () => refreshSession());
  window.addEventListener('cubesat-session-ended', () => channel?.postMessage('refresh'));
  // Only an operator keeps the control lease alive. Viewer polling would defeat inactivity expiry.
  setInterval(async () => {
    if (state.user?.role !== 'operator' || document.hidden) return;
    try { update(await jsonRequest('heartbeat', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf } })); }
    catch (error) { if (error.status === 401 || error.status === 409) await refreshSession(); }
  }, 15000);
}
