import { initDashboardSettings } from './dashboard-settings.mjs';
import { initRouter } from './router.js?v=20261118-power-path';
import { initAuth } from './auth.js?v=20261118-telemetry';
import { initTooltips } from './tooltips.js?v=20261028c';

import { confirmSignOutSequences } from './sequences.js?v=20261118-debug-recovery';

initDashboardSettings();
await initAuth({ beforeSignOut: confirmSignOutSequences });
initRouter();
initTooltips();
