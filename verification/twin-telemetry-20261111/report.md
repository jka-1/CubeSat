# Complete, fresh Twin telemetry and six-value LCD

11 November 2026. Local implementation only. No push, deployment, hardware
access, server changes or authentication changes.

The dashboard adapter previously forwarded only BMS pack voltage, ambient
temperature and relative light. It dropped all six MPPT ADC values, MCU
temperature and other decoded readings. Forwarding also reset the sample's
age and used a separate 15-second gate rather than the shared source threshold.

The adapter now forwards complete, presence-gated snapshots: all six screenshot
MPPT readings, MCU temperature, four INA226 quantities, BMS pack/cells/internal
temperature, peripheral inputs and device RSSI. It retains original source age
with bridge clock skew correction, rejects older arrivals, and clears newly
unavailable channels instead of retaining previous numbers. True zero readings
remain zero. No raw register conversion or hardware value is invented. BMS PACK
and MPPT VBAT remain separate; INA226 current is labelled PV current.

The payload LCD uses the requested system overview: battery voltage, PV current,
ambient temperature, relative light, MCU temperature and MPPT die temperature,
arranged three per column. The small top Wi-Fi glyph uses actual device RSSI
and dims for stale/disconnected/mock readings. No extra SSE or polling connection
is opened. The same 768 × 582 canvas still drives both the physical model LCD
and preview. Missing readings are shown explicitly; mock demonstration remains
labelled and now fills all six values, with relative light in its 0–1 scale.

Component details expose the six MPPT channels and BMS/INA226 measurements.
Telemetry drawers show additional channels. Public legacy fields and custom
LCD presentation states remain supported. The browser entry/import versions
were advanced together, preserving the shared stream module identity. The
site-only deployment helper now includes the changed telemetry contract module;
it was syntax checked, not executed against a site.

Validation:
- 36 focused tests passed: source adapter, display, inspection, rendering and
  model preservation (`focused-tests.txt`). Five new display tests cover the
  six layout positions, accessible text, timestamp/expiry semantics, empty
  snapshot clearing, signal truthfulness and presentation behavior.
- 22 shared streaming/authentication tests passed (`shared-auth-tests.txt`).
- 10 assertions passed through the actual dashboard, shared decoder and embedded
  viewer with a temporary synthetic auth/SSE fixture (`browser-results.json`).
  The screenshot MPPT values, including 0 mA, reached the viewer and selected
  board with correct units; all six overview fields/RSSI reached the LCD.
  Source age, staleness, missing-channel clearing, out-of-order rejection,
  reconnect timing, one shared stream and mobile width passed.
- The initial browser age fixture was older than a freshly accepted sample and
  was correctly rejected. The chronological correction is documented in the
  driver; first results are retained in `browser-first-check.json`.
- Desktop/mobile/LCD captures were inspected. The mechanical detector's sole
  advisory concerns repeated em-dash unavailable-value placeholders; those
  placeholders are intentional and retained.
- Syntax and whitespace checks passed. The normal viewer is left open after
  verifying/clearing mock demonstration values (`normal-preview.json`).

Sources changed: `site/assets/js/twin.js`, the viewer telemetry/display/controller
modules, component display fields, viewer HTML, and cache versions in the parent
app/router/Twin fragment. New focused display tests and updated adapter tests
record the contract. Model geometry, materials, camera behavior, rendering
pipeline and live backend remain unchanged. The new LCD is redrawn on packets
or the existing one-second status tick; no per-frame telemetry work was added.

All browser values in this evidence are local synthetic checks. Live hardware
verification remains for the deployed system. No broad GPU benchmark was repeated
for a canvas/text and telemetry adapter change.
