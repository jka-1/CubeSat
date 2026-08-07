import { initI2CPage, destroyI2CPage } from './i2c.js?v=20260807a';

const assetVersion = '20260807a';

const routes = {
  home: `./modules/home.html?v=${assetVersion}`,
  communication: `./modules/communication.html?v=${assetVersion}`,
  partners: `./modules/partners.html?v=${assetVersion}`
};

const pageInitializers = {
  home: () => {},
  communication: initI2CPage,
  partners: () => {}
};

const pageDestroyers = {
  home: () => {},
  communication: destroyI2CPage,
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
