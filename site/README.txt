CubeSat Modular Site

Structure:
- index.html                     Main shell
- modules/home.html              Portfolio page module
- modules/communication.html     Active telemetry dashboard and I2C control page
- modules/dashboard.html         Legacy dashboard module (not routed)
- modules/partners.html          Partners page module
- assets/css/styles.css          Shared styles
- assets/js/app.js               App entry point
- assets/js/router.js            Route/module loader
- assets/js/i2c.js               Active telemetry dashboard and I2C control logic
- assets/js/dashboard.js         Legacy dashboard logic (not imported)
- assets/js/telemetry-model.mjs  Shared live/mock peripheral telemetry model
- fonts/HorizonDesignSystem.woff2  Place licensed font here

Notes:
1. The site is designed as a modular static front-end.
2. Both #communication and the legacy #dashboard link resolve to modules/communication.html and initialize assets/js/i2c.js.
3. Replace satellite.png and space_background.png with the image assets in the same folder as index.html.
4. If the Horizon Design System font is unavailable locally, place the webfont file in /fonts.
