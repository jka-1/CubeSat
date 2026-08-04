CubeSat Modular Site

Structure:
- index.html                     Main shell
- modules/home.html              Portfolio page module
- modules/dashboard.html         Dashboard page module
- modules/communication.html     I2C Control page module
- modules/partners.html          Partners page module
- assets/css/styles.css          Shared styles
- assets/js/app.js               App entry point
- assets/js/router.js            Route/module loader
- assets/js/dashboard.js         Dashboard logic
- assets/js/i2c.js               I2C control logic
- fonts/HorizonDesignSystem.woff2  Place licensed font here

Notes:
1. The site is designed as a modular static front-end.
2. The I2C page visually mirrors the original diagram using red SDA and SCL bus lines.
3. Replace satellite.png and space_background.png with the image assets in the same folder as index.html.
4. If the Horizon Design System font is unavailable locally, place the webfont file in /fonts.
