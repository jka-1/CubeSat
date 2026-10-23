import { initRouter } from './router.js?v=20261023a';
import { initAuth } from './auth.js?v=20261022a';

await initAuth();
initRouter();
