import { initRouter } from './router.js?v=20261111-sync';
import { initAuth } from './auth.js?v=20261109e';
import { initTooltips } from './tooltips.js?v=20261028c';

await initAuth();
initRouter();
initTooltips();
