import { initRouter } from './router.js?v=20261109d';
import { initAuth } from './auth.js?v=20261109b';
import { initTooltips } from './tooltips.js?v=20261028c';

await initAuth();
initRouter();
initTooltips();
