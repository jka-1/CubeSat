import { initRouter } from './router.js?v=20261028a';
import { initAuth } from './auth.js?v=20261028a';
import { initTooltips } from './tooltips.js?v=20261028a';

await initAuth();
initRouter();
initTooltips();
