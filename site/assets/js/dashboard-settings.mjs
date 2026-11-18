const icons = {
  communication: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/><rect x="10" y="10" width="4" height="4"/>',
  'link-health': '<path d="M3 17a13 13 0 0 1 18 0M6 20a9 9 0 0 1 12 0M2 12a17 17 0 0 1 20 0M12 23h.01"/>',
  runs: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 17l3-4 2 2 3-4"/>',
  twin: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>',
  'debug-mode': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  sequences: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v2a4 4 0 0 1-4 4H6"/>',
  manual: '<path d="M12 6c-3-3-7-3-10-2v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2zm0 0v15"/>'
};
const icon = path => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export function initDashboardSettings() {
  const theme = document.getElementById('dashboardTheme');
  const toggle = document.getElementById('sidebarToggle');
  if (!theme || !toggle) return;
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const menuTheme = document.getElementById('menuTheme');
  const setTheme = value => {
    const chosen = value === 'light' ? 'light' : 'dark';
    document.body.dataset.dashboardTheme = chosen;
    theme.value = chosen;
    menuTheme.querySelector('span').textContent = chosen === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    window.dispatchEvent(new Event('dashboard-theme-change'));
    write('knight.dashboardTheme', chosen);
  };
  const setCollapsed = collapsed => {
    if (collapsed) document.querySelector('.sidebar-footer').prepend(toggle);
    else document.getElementById('sidebarTop').append(toggle);
    document.body.dataset.sidebar = collapsed ? 'compact' : 'full';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.title = toggle.getAttribute('aria-label');
    write('knight.sidebar', String(collapsed));
  };
  setTheme(read('knight.dashboardTheme', 'dark'));
  setCollapsed(read('knight.sidebar', 'false') === 'true');
  menuTheme.addEventListener('click', () => {
    setTheme(theme.value === 'light' ? 'dark' : 'light');
    document.getElementById('accountMenu').hidePopover();
    document.getElementById('accountButton').focus();
  });
  theme.addEventListener('change', () => setTheme(theme.value));
  toggle.innerHTML = icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>') + '<span>Sidebar</span>';
  toggle.addEventListener('click', () => setCollapsed(toggle.getAttribute('aria-expanded') === 'true'));
  for (const link of document.querySelectorAll('#dashboardTabs a[data-route]')) {
    const label = link.textContent.trim();
    const words = document.createElement('span');
    words.textContent = label;
    link.innerHTML = icon(icons[link.dataset.route]);
    link.append(words);
    link.title = label;
    link.setAttribute('aria-label', label);
  }
}
