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
  $('accountButton').hidden = state.enabled === false;
  $('accountButton').textContent = state.user
    ? (state.user.username.toLowerCase() === state.user.role ? state.user.role : `${state.user.username} · ${state.user.role}`)
    : 'Sign in';
  $('accountForm').hidden = !!state.user || state.enabled !== true;
  $('accountLogout').hidden = !state.user;
  $('accountRetry').hidden = state.enabled !== null;
  $('accountTitle').textContent = state.user ? 'Your account' : 'Sign in';
  $('accountHelp').textContent = state.user
    ? `Signed in as ${state.user.username}. ${state.user.role === 'viewer' ? 'You can view telemetry and saved runs.' : 'Hardware commands also require the command token.'}`
    : 'Use your CubeSat account to view telemetry and saved runs. Ask the project administrator if you need an account.';
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
export function canOperate() { return state.enabled === false || (state.user?.role === 'operator' && state.control_active); }
export function allowRoute(route) {
  if (['home', 'partners'].includes(route) || state.enabled === false || state.user) return true;
  return false;
}
export async function apiFetch(url, options = {}) {
  const target = new URL(url, location.href);
  const headers = new Headers(options.headers);
  if (state.enabled !== false && !['GET', 'HEAD'].includes(options.method || 'GET')) {
    if (target.origin !== location.origin) throw new Error('Signed-in commands must use the same site as login.');
    if (!state.user) throw new Error('Sign in before sending commands.');
    headers.set('X-CSRF-Token', state.csrf);
  }
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
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
      const data = await jsonRequest('login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('accountUsername').value.trim(), password: $('accountPassword').value }) });
      $('accountPassword').value = ''; update(data); leaveAccount();
      notice('');
    } catch (error) { notice(error.message); }
    finally { button.disabled = false; button.textContent = 'Sign in'; }
  });
  $('accountLogout').addEventListener('click', async () => {
    $('accountLogout').disabled = true;
    try {
      await jsonRequest('logout', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf } });
      update({ enabled: true, user: null }); notice('You are signed out.');
    } catch (error) {
      if (error.status === 401) { update({ enabled: true, user: null }); notice('You are signed out.'); }
      else notice(error.message);
    } finally { $('accountLogout').disabled = false; }
  });
  await refreshSession();
  window.addEventListener('focus', refreshSession);
  // Only an operator keeps the control lease alive. Viewer polling would defeat inactivity expiry.
  setInterval(async () => {
    if (state.user?.role !== 'operator' || document.hidden) return;
    try { update(await jsonRequest('heartbeat', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf } })); }
    catch (error) { if (error.status === 401 || error.status === 409) await refreshSession(); }
  }, 15000);
}
