// JWT stays in an HttpOnly cookie. Only the CSRF value lives in page memory.
let state = { enabled: null, user: null };
let expiryTimer;
const $ = (id) => document.getElementById(id);
const authUrl = '/telemetry/auth/';
function notice(message) { $('accountMessage').textContent = message; }
function showAccount() {
  $('accountPanel').hidden = false;
  requestAnimationFrame(() => ($('accountForm').hidden ? $('accountClose') : $('accountUsername')).focus());
}
function update(next) {
  const changed = JSON.stringify(state.user) !== JSON.stringify(next.user) || state.enabled !== next.enabled;
  state = next;
  clearTimeout(expiryTimer);
  $('accountButton').hidden = state.enabled === false;
  $('accountButton').textContent = state.user ? `${state.user.username} · ${state.user.role}` : 'Sign in';
  $('accountForm').hidden = !!state.user || state.enabled !== true;
  $('accountLogout').hidden = !state.user;
  $('accountRetry').hidden = state.enabled !== null;
  $('accountTitle').textContent = state.user ? 'Your account' : 'Sign in';
  $('accountHelp').textContent = state.user
    ? `Signed in as ${state.user.username}. ${state.user.role === 'viewer' ? 'You can view telemetry and saved runs.' : 'Hardware commands also require the command token.'}`
    : 'Use your CubeSat account to view telemetry and saved runs. Ask the project administrator if you need an account.';
  if (state.user) expiryTimer = setTimeout(() => {
    update({ enabled: true, user: null }); notice('Your session expired. Sign in again.');
  }, Math.max(1, Date.parse(state.expires_at) - Date.now()));
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
export function canOperate() { return state.enabled === false || state.user?.role === 'operator'; }
export function allowRoute(route) {
  if (['home', 'partners'].includes(route) || state.enabled === false || state.user) return true;
  showAccount();
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
  $('accountButton').addEventListener('click', showAccount);
  $('accountClose').addEventListener('click', () => { $('accountPanel').hidden = true; $('accountButton').focus(); });
  $('accountRetry').addEventListener('click', refreshSession);
  $('accountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('accountSubmit'); button.disabled = true; button.textContent = 'Signing in…'; notice('');
    try {
      const data = await jsonRequest('login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('accountUsername').value.trim(), password: $('accountPassword').value }) });
      $('accountPassword').value = ''; $('accountPanel').hidden = true; update(data);
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
  // Detect logout in another tab; streams are also revoked immediately by the bridge.
  setInterval(() => { if (state.user && !document.hidden) refreshSession(); }, 30000);
}
