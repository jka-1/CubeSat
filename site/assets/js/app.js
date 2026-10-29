import { initRouter } from './router.js?v=20261029e';
import { initAuth } from './auth.js?v=20261028d';
import { initTooltips } from './tooltips.js?v=20261028c';

await initAuth();
initRouter();
initTooltips();
