import { allowRoute, isOperator, showAccount, refreshSession } from './auth.js?v=20261118-telemetry';
import { initI2CPage, destroyI2CPage } from './i2c.js?v=20261118-telemetry';
import { initLinkHealthPage, destroyLinkHealthPage } from './link-health.js?v=20261118-telemetry';
import { initDebugModePage, destroyDebugModePage } from './debug-mode.js?v=20261118-telemetry';
import { initSequencesPage, destroySequencesPage, confirmLeaveSequences } from './sequences.js?v=20261118-telemetry';
import { initRunsPage, destroyRunsPage } from './runs.js?v=20261118-telemetry';
import { initTwinPage, destroyTwinPage } from './twin.js?v=20261118-twin-theme';
import { isStreamingMode } from './streaming-telemetry.mjs?v=20261109b';
import { initPublicPage, destroyPublicPage } from './public-pages.mjs?v=20261118-telemetry';

function updateStreamingBadge() {
  const badge = document.getElementById('streamingNavBadge');
  if (badge) badge.hidden = currentRoute === 'communication' || !isStreamingMode();
}
window.addEventListener('streaming-telemetry-mode', updateStreamingBadge);

const assetVersion = '20261118-revision';

const routes = {
  home: `./modules/home.html?v=${assetVersion}`,
  privacy: './modules/privacy.html',
  accessibility: './modules/accessibility.html',
  credits: './modules/credits.html',
  team: './modules/team.html?v=20261118',
  resources: './modules/resources.html?v=20261118',
  contact: './modules/contact.html?v=20261118',
  communication: `./modules/communication.html?v=20261118-telemetry`,
  'link-health': `./modules/link-health.html?v=20261112-order-scroll`,
  'debug-mode': '/telemetry/operator-pages/debug-mode',
  runs: `./modules/runs.html?v=20261112-order-scroll`,
  sequences: '/telemetry/operator-pages/sequences',
  twin: `./modules/twin.html?v=20261118-revision`,
  manual: '/telemetry/operator-pages/manual',
  partners: `./modules/partners.html?v=${assetVersion}` // unlinked from nav; reachable only by #partners
};

const pageInitializers = {
  home: () => initPublicPage('home'),
  team: () => initPublicPage('team'),
  resources: () => initPublicPage('resources'),
  contact: () => initPublicPage('contact'),
  communication: initI2CPage,
  'link-health': initLinkHealthPage,
  'debug-mode': initDebugModePage,
  runs: initRunsPage,
  sequences: initSequencesPage,
  twin: initTwinPage,
  partners: () => {}
};

const pageDestroyers = {
  home: destroyPublicPage,
  team: destroyPublicPage,
  resources: destroyPublicPage,
  contact: destroyPublicPage,
  communication: destroyI2CPage,
  'link-health': destroyLinkHealthPage,
  'debug-mode': destroyDebugModePage,
  runs: destroyRunsPage,
  sequences: destroySequencesPage,
  twin: destroyTwinPage,
  partners: () => {}
};

let currentRoute = null;
let navigationId = 0;

function updateSectionScroll() {
  const navigation = document.getElementById('dashboardNavigation');
  const tabs = document.getElementById('dashboardTabs');
  const previous = document.getElementById('dashboardPrevious');
  const next = document.getElementById('dashboardNext');
  if (navigation.hidden) return;
  // Compare with the full available strip so the arrows do not sustain overflow themselves.
  const overflowing = tabs.scrollWidth > tabs.clientWidth + 1 && getComputedStyle(navigation).position !== 'fixed';
  previous.hidden = next.hidden = !overflowing;
  previous.disabled = tabs.scrollLeft <= 1;
  next.disabled = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1;
}

function revealCurrentSection() {
  const tabs = document.getElementById('dashboardTabs');
  if (tabs.hidden) return;
  updateSectionScroll();
  const active = tabs.querySelector('[aria-current="page"]');
  if (active) {
    const strip = tabs.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < strip.left + 8) tabs.scrollLeft -= strip.left + 8 - item.left;
    else if (item.right > strip.right - 8) tabs.scrollLeft += item.right - strip.right + 8;
  }
  updateSectionScroll();
}

function resolveRoute(route) {
  if (route === 'dashboard') return 'communication';
  return routes[route] ? route : 'home';
}

function updateNav(route) {
  const dashboard = !['home', 'team', 'resources', 'contact', 'privacy', 'accessibility', 'credits', 'partners', 'account'].includes(route);
  document.body.dataset.surface = dashboard ? 'dashboard' : 'public';
  const account = document.querySelector('.account-control');
  if (account) document.getElementById(dashboard ? 'dashboardAccount' : 'publicAccount')?.append(account);
  // The same identity link lives in the sidebar at desktop widths.
  placeDashboardBrand();
  document.body.dataset.page = route;
  document.getElementById('publicFooter').hidden = dashboard;
  const titles = {home:'The project',team:'Our team',resources:'Resources',contact:'Contact us',privacy:'Privacy',accessibility:'Accessibility',credits:'Credits & Licenses',account:'Sign in',communication:'Telemetry','link-health':'Network statistics',runs:'Logged telemetry',twin:'Digital twin','debug-mode':'Programming',sequences:'Branch definition',manual:'Manual'};
  document.title = `${titles[route] || 'Dashboard'} · ${dashboard ? 'Orbital Address' : 'KnightEPS'}`;
  document.getElementById('dashboardTabs').hidden = !dashboard;
  document.getElementById('dashboardNavigation').hidden = !dashboard;
  document.querySelectorAll('#dashboardTabs [data-operator-only]').forEach((node) => { node.hidden = !isOperator(); });
  document.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === route || link.dataset.route === 'dashboard' && dashboard;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  revealCurrentSection();
}

function showOperatorDenied(route) {
  const root = document.getElementById('page-root');
  root.hidden = false;
  document.getElementById('accountPanel').hidden = true;
  updateNav('home');
  root.innerHTML = '<section class="page" aria-labelledby="accessDeniedTitle"><h1 id="accessDeniedTitle">Operator access required</h1><p>You do not have permission to open this dashboard section.</p><p>Sign in with an operator account to continue.</p><p><button id="operatorSignIn" class="button" type="button">Sign in as operator</button> <a class="button secondary" href="#dashboard">Back to dashboard</a></p></section>';
  document.getElementById('operatorSignIn').addEventListener('click', () => showAccount(route, { operator: true }));
}

async function loadRoute(route) {
  if (currentRoute === 'sequences' && resolveRoute(route) === 'sequences' && allowRoute('sequences')) return;
  const id = ++navigationId;
  if (currentRoute === 'sequences' && allowRoute('sequences')) {
    const mayLeave = await confirmLeaveSequences();
    if (id !== navigationId) return;
    if (!mayLeave) {
      history.replaceState(null, '', '#sequences');
      return;
    }
  }
  if (route === 'account') {
    if (currentRoute && pageDestroyers[currentRoute]) pageDestroyers[currentRoute]();
    currentRoute = null;
    document.getElementById('page-root').replaceChildren();
    document.getElementById('page-root').hidden = true;
    document.getElementById('accountPanel').hidden = false;
    updateNav('account');
    return;
  }
  const requestedRoute = resolveRoute(route);
  if (!allowRoute(requestedRoute)) {
    if (currentRoute && pageDestroyers[currentRoute]) pageDestroyers[currentRoute]();
    currentRoute = null;
    document.getElementById('page-root').replaceChildren();
    if (['debug-mode', 'sequences', 'manual', 'partners'].includes(requestedRoute)) showOperatorDenied(requestedRoute);
    else showAccount(requestedRoute);
    return;
  }
  const safeRoute = requestedRoute;
  document.getElementById('accountPanel').hidden = true;
  history.replaceState(null, '', `#${safeRoute}`);

  if (currentRoute && pageDestroyers[currentRoute]) {
    pageDestroyers[currentRoute]();
  }

  const root = document.getElementById('page-root');
  currentRoute = null;
  root.replaceChildren();
  updateNav(safeRoute);
  root.hidden = false;
  let response;
  try { response = await fetch(routes[safeRoute]); }
  catch {
    if (id !== navigationId) return;
    root.innerHTML = '<section class="page"><h1>Page unavailable</h1><p>Check your connection and reload this page.</p><button class="button" type="button" id="routeRetry">Retry</button></section>';
    document.getElementById('routeRetry').addEventListener('click', () => loadRoute(safeRoute));
    return;
  }
  const html = await response.text();
  if (id !== navigationId || !allowRoute(safeRoute)) return;

  if (!response.ok) {
    if (response.status === 401) { await refreshSession(); if (id === navigationId) loadRoute(safeRoute); return; }
    if (response.status === 403) { showOperatorDenied(safeRoute); return; }
    root.innerHTML = '<section class="page"><p>Failed to load page module.</p></section>';
    return;
  }

  root.innerHTML = html;
  // Remove operational controls before mounting an otherwise public page.
  if (!isOperator()) root.querySelectorAll('[data-operator-only]').forEach((node) => node.remove());
  root.querySelectorAll('[data-operator-controls]').forEach((node) => { node.hidden = !isOperator(); });
  updateNav(safeRoute);
  currentRoute = safeRoute;
  updateStreamingBadge();

  if (window.location.hash !== `#${safeRoute}`) {
    history.replaceState(null, '', `#${safeRoute}`);
  }

  if (pageInitializers[safeRoute]) {
    pageInitializers[safeRoute]();
  }
  window.scrollTo({top:0, behavior:'instant'});
  root.focus({preventScroll:true});
}

const sidebarDesktop = typeof matchMedia === 'function' ? matchMedia('(min-width: 1001px)') : null;
function placeDashboardBrand() {
  const brand = document.querySelector('.brand');
  const target = document.body.dataset.surface === 'dashboard' && sidebarDesktop?.matches
    ? document.getElementById('sidebarTop') : document.querySelector('.site-header .nav');
  if (brand && target && brand.parentElement !== target) target.prepend(brand);
}

export function initRouter() {
  sidebarDesktop?.addEventListener('change', placeDashboardBrand);
  const tabs = document.getElementById('dashboardTabs');
  document.getElementById('dashboardPrevious').addEventListener('click', () => { tabs.scrollLeft -= Math.max(160, tabs.clientWidth * 0.75); updateSectionScroll(); });
  document.getElementById('dashboardNext').addEventListener('click', () => { tabs.scrollLeft += Math.max(160, tabs.clientWidth * 0.75); updateSectionScroll(); });
  tabs.addEventListener('scroll', updateSectionScroll, { passive: true });
  new ResizeObserver(revealCurrentSection).observe(document.getElementById('dashboardNavigation'));
  window.addEventListener('cubesat-auth-change', () => loadRoute(location.hash.slice(1) || 'home'));
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const route = link.dataset.route;
      if (!route) return;
      event.preventDefault();
      loadRoute(route);
    });
  });

  window.addEventListener('hashchange', () => {
    loadRoute(location.hash.slice(1) || 'home');
  });

  loadRoute(location.hash.slice(1) || 'home');
}
