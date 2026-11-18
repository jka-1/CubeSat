// JWT stays in an HttpOnly cookie. Only the CSRF value lives in page memory.
let state = { enabled: null, user: null };
let returnRoute = 'home';
let operatorLogin = false;
const $ = (id) => document.getElementById(id);
const authUrl = '/telemetry/auth/';
function notice(message) { $('accountMessage').textContent = message; }
export function showAccount(from = location.hash.slice(1) || 'home', { operator = false } = {}) {
  if (from !== 'account') returnRoute = from;
  operatorLogin = operator;
  update(state);
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
  document.body.dataset.signedIn = String(Boolean(state.user));
  $('accountButton').hidden = false;
  const accountName = document.querySelector('[data-account-name]');
  if (accountName) {
    const username = state.user?.username || '';
    accountName.textContent = username || 'Sign in';
    document.querySelector('[data-account-avatar]').textContent = username
      .split(/[\s._-]+/).filter(Boolean).slice(0,2).map(part => part[0].toUpperCase()).join('');
    document.querySelector('[data-account-role]').textContent = state.user
      ? (state.user.role === 'operator' ? 'Operator' : 'Viewer') : '';
    const expiry = Date.parse(state.expires_at);
    const utc = Number.isFinite(expiry) ? new Date(expiry).toISOString().slice(11,16) : null;
    document.querySelector('[data-account-session]').textContent = !state.user ? ''
      : utc ? `Signed in · ends ${utc} UTC` : 'Signed in';
  } else $('accountButton').textContent = state.user?.username || 'Sign in';
  $('accountButton').setAttribute('aria-label', state.user
    ? `Open account and settings for ${state.user.username}`
    : 'Sign in');
  if (state.user) $('accountButton').setAttribute('popovertarget', 'accountMenu');
  else {
    $('accountButton').removeAttribute('popovertarget');
    $('accountMenu').hidePopover?.();
  }
  const switchingOperator = operatorLogin && !isOperator();
  $('accountForm').hidden = (!!state.user && !switchingOperator) || state.enabled !== true;
  if ($('dashboardAppearance')) $('dashboardAppearance').hidden = !state.user || switchingOperator;
  $('accountLogout').hidden = !state.user;
  $('accountRetry').hidden = state.enabled !== null;
  $('accountTitle').textContent = switchingOperator ? 'Sign in as operator' : state.user ? 'Your account' : 'Sign in';
  $('accountHelp').textContent = switchingOperator
    ? 'This dashboard section requires an operator account. Sign in with operator credentials to continue.'
    : state.user
    ? `Signed in as ${state.user.username} (${state.user.role}). ${state.user.role === 'viewer' ? 'You can view telemetry and saved runs.' : `Controls ${state.control_active ? 'active' : 'inactive'}; hardware commands also require the command token.`}`
    : state.enabled === false ? 'Website sign-in is not configured on this bridge. Dashboard access is unavailable.'
    : 'Sign in to access the dashboard. Your assigned role determines which sections are available.';
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
  return ['home', 'team', 'resources', 'contact', 'privacy', 'accessibility', 'credits'].includes(route) || (isSignedIn() && (['dashboard', 'communication', 'link-health', 'runs', 'twin'].includes(route) || isOperator()));
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
export async function initAuth({ beforeSignOut = () => true } = {}) {
  const trigger = $('accountButton'), menu = $('accountMenu');
  trigger.addEventListener('click', () => { if (!isSignedIn()) showAccount(); });
  function positionMenu() {
    if (!menu.matches(':popover-open')) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(rect.left, document.documentElement.clientWidth - menu.offsetWidth - 8);
    const below = rect.bottom + 6;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = (below + menu.offsetHeight <= window.innerHeight ? below : Math.max(8, rect.top - menu.offsetHeight - 6)) + 'px';
  }
  menu.addEventListener('toggle', positionMenu);
  window.addEventListener('resize', positionMenu);
  window.addEventListener('hashchange', () => menu.hidePopover?.());
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
      $('accountPassword').value = '';
      if (operatorLogin && data.user?.role !== 'operator') {
        update(data); notice('This account does not have operator access. Use an operator account to continue.'); return;
      }
      operatorLogin = false;
      update(data); leaveAccount();
      notice(editOnly ? 'Another operator has control. You are signed in for editing; hardware controls stay inactive until control is free.' : '');
    } catch (error) { notice(error.message); }
    finally { button.disabled = false; button.textContent = 'Sign in'; }
  });
  async function signOut() {
    if (!await beforeSignOut()) return;
    $('menuError').textContent = '';
    $('accountLogout').disabled = $('menuLogout').disabled = true;
    try {
      await jsonRequest('logout', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf } });
      update({ enabled: true, user: null }); notice('You are signed out.');
      location.hash = 'home';
      window.dispatchEvent(new Event('cubesat-session-ended'));
    } catch (error) {
      if (error.status === 401) { update({ enabled: true, user: null }); location.hash = 'home'; notice('You are signed out.'); }
      else { notice(error.message); $('menuError').textContent = error.message; positionMenu(); }
    } finally { $('accountLogout').disabled = $('menuLogout').disabled = false; }
  }
  $('accountLogout').addEventListener('click', signOut);
  $('menuLogout').addEventListener('click', signOut);
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
