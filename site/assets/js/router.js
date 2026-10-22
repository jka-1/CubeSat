import { initI2CPage, destroyI2CPage } from './i2c.js?v=20261019b';
import { initLinkHealthPage, destroyLinkHealthPage } from './link-health.js?v=20261013a';
import { initDebugModePage, destroyDebugModePage } from './debug-mode.js?v=20261019b';
import { isStreamingMode } from './streaming-telemetry.mjs?v=20261019b';

function updateStreamingBadge() {
  const badge = document.getElementById('streamingNavBadge');
  if (badge) badge.hidden = !isStreamingMode();
}
window.addEventListener('streaming-telemetry-mode', updateStreamingBadge);

const assetVersion = '20260929e';

const routes = {
  home: `./modules/home.html?v=${assetVersion}`,
  communication: `./modules/communication.html?v=20261019b`,
  'link-health': `./modules/link-health.html?v=20261013a`,
  'debug-mode': `./modules/debug-mode.html?v=20261019b`,
  partners: `./modules/partners.html?v=${assetVersion}`
};

const pageInitializers = {
  home: () => {},
  communication: initI2CPage,
  'link-health': initLinkHealthPage,
  'debug-mode': initDebugModePage,
  partners: () => {}
};

const pageDestroyers = {
  home: () => {},
  communication: destroyI2CPage,
  'link-health': destroyLinkHealthPage,
  'debug-mode': destroyDebugModePage,
  partners: () => {}
};

let currentRoute = null;

function resolveRoute(route) {
  if (route === 'dashboard') return 'communication';
  return routes[route] ? route : 'home';
}

function updateNav(route) {
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === route);
  });
}

async function loadRoute(route) {
  const safeRoute = resolveRoute(route);

  if (currentRoute && pageDestroyers[currentRoute]) {
    pageDestroyers[currentRoute]();
  }

  const root = document.getElementById('page-root');
  const response = await fetch(routes[safeRoute]);

  if (!response.ok) {
    root.innerHTML = '<section class="page"><p>Failed to load page module.</p></section>';
    return;
  }

  root.innerHTML = await response.text();
  updateNav(safeRoute);
  updateStreamingBadge();
  currentRoute = safeRoute;

  if (window.location.hash !== `#${safeRoute}`) {
    history.replaceState(null, '', `#${safeRoute}`);
  }

  if (pageInitializers[safeRoute]) {
    pageInitializers[safeRoute]();
  }
}

export function initRouter() {
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
