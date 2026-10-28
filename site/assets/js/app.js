import { initRouter } from './router.js?v=20261027c';
import { initAuth } from './auth.js?v=20261027a';

await initAuth();
initRouter();
