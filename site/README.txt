CubeSat Modular Site

Structure:
- index.html                     Main shell
- modules/home.html              Portfolio page module
- modules/communication.html     Active telemetry dashboard and I2C control page
- modules/dashboard.html         Legacy dashboard module (not routed)
- modules/link-health.html       Wireless link health page (SSE + /health)
- modules/partners.html          Partners page module
- assets/css/styles.css          Shared styles
- assets/js/app.js               App entry point
- assets/js/router.js            Route/module loader
- assets/js/i2c.js               Active telemetry dashboard and I2C control logic
- assets/js/dashboard.js         Legacy dashboard logic (not imported)
- assets/js/telemetry-model.mjs  Shared live/mock peripheral telemetry model
- assets/js/link-health.js       Link health page (canvas charts, tiles, stats table)
- assets/js/link-stats.mjs       Link statistics (same algorithm as link_monitor.mjs and the Windows app)
- assets/css/link-health.css     Link health page styles
- fonts/HorizonDesignSystem.woff2  Place licensed font here

Notes:
1. The site is designed as a modular static front-end.
2. Both #communication and the legacy #dashboard link resolve to modules/communication.html and initialize assets/js/i2c.js.
3. Replace satellite.png and space_background.png with the image assets in the same folder as index.html.
4. If the Horizon Design System font is unavailable locally, place the webfont file in /fonts.

Debug Mode page (#debug-mode)
  modules/debug-mode.html, assets/js/debug-mode.js, assets/js/debug-commands.mjs,
  assets/js/register-conversions.mjs (port of the Windows tool's conversions.py),
  assets/data/register-map.json (exported by cubesat-i2c-tool/tools/export_register_map.py),
  assets/css/debug-mode.css.
  Uses /telemetry/events, /telemetry/health and POST /telemetry/command?wait=1 with X-Command-Token.
  Needs the debug firmware (v5 packets) for presence tiles; see DEBUG_MODE.md.
