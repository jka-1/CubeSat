import { initRouter } from './router.js?v=20261109a';
import { initAuth } from './auth.js?v=20261104d';
import { initTooltips } from './tooltips.js?v=20261028c';

await initAuth();
initRouter();
initTooltips();
