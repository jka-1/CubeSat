# CubeSat site tooltip wording review

This review covers implemented tooltip wording in the current local site, including signed-in viewer pages, operator pages, generated Streaming Telemetry controls and the Digital Twin. Edit the Replacement text fields and return the Word file to have the wording applied to the site.

## Editing and returning the review

1. Edit only the Replacement text field for each ID you want to change. Each field starts with the exact current tooltip text. Leave an unchanged field as it is.
2. Keep the IDs, source locators and Current tooltip text intact. Repeated wording is listed per placement; edit each relevant occurrence. The I2C-ST and DEBUG-ST entries share a generator, so differing replacements require an explicit context-specific implementation decision.
3. For RUNS-CHART-TIMELINE and RUNS-CHART-RESPONSE, edit each conditional variant separately. No inventoried tooltip interpolates live telemetry, a user name or a register value into its wording.
4. Save and attach the edited .docx in a follow-up chat, and ask for the replacements to be applied by stable ID. Markdown can also be edited and returned. If both files are edited, say which is authoritative. Changes are applied only in that follow-up; this inventory does not alter the site.

## Inventory count

| Page or section | Editable records |
| --- | ---: |
| Site navigation | 1 |
| I2C Telemetry details | 6 |
| I2C Telemetry streaming controls | 20 |
| Logged Telemetry | 7 |
| Debug Mode operator controls | 7 |
| Debug Mode streaming controls | 20 |
| Digital Twin | 2 |
| Operator Manual | 1 |
| Legacy dashboard module | 2 |
| **Total** | **66** |

## Scope and coverage limitations

- 66 editable wording records represent 65 distinct control placements: 64 records across 63 placements in current routes, plus 2 declarations in the legacy dashboard module. The extra wording record is the response variant of the same SVG chart title. These are source placements and variants, not a count of simultaneously visible DOM nodes.
- Mechanisms: 59 data-tooltip records, 5 native HTML title attributes and 2 native SVG title variants. Of the data-tooltip records, 40 are generated placements (20 per streaming mount).
- Source baseline: local working tree on November 12 2026, including existing modified and untracked dashboard files; HEAD b504e9d5e9c0c9749f4e1af1b72b291c7ca492c6. The companion Markdown records source hashes. This is a source audit, not an assertion about the deployed version.
- Current access rules are in site/assets/js/auth.js:62. Home is public; I2C Telemetry, Link Health, Logged Telemetry and Twin require sign-in. Debug Mode, Branch Definitions and Manual require an operator. Home, account UI, Link Health, Branch Definitions, Partners and the manual document body contain no tooltip declarations; their count is zero. Tooltip visibility also depends on route, mode, device presence and enabled cards.
- Native title rendering is browser dependent. Both iframe title attributes are retained because they are implemented native title text, while also naming their frames. The SVG title is likewise dual purpose. Standalone aria-label, aria-labelledby, aria-describedby and SVG desc text are excluded when they do not provide a tooltip.
- Excluded HTML head document titles, data-title detail headings, persistent inline help, click-driven operational dialogs and confirmations, details disclosure content, datalist choices, chart selection readouts, and Digital Twin component descriptions shown in the selection panel. These are not implemented hover/help popups.
- No other authored hover/help popup mechanism was found. Streaming metricRow only emits data-tooltip for a supplied truthy tooltip; metrics without one are not given invented text. Register suggestions, Branch Definition blocks, sequence history, run rows, chart markers, streaming faults and Digital Twin component controls were checked for tooltip generation; none adds additional tooltip wording.
- Coverage is based on the local authored HTML, JavaScript, modules, CSS and relevant data, together with bridge operator views and routing. Archived verification prototypes, desktop Python UI, firmware and third-party renderer internals are outside this website inventory. No deployed or authenticated browser session was exercised, and browser-built-in validation or select/file-picker UI is not site-authored tooltip copy.

## Implementation evidence

- `site/assets/js/tooltips.js` — addTooltip at 4–82 and initTooltips at 85–108: popup.textContent copies dataset.tooltip; pointer, focus and touch triggers; MutationObserver decorates added route and streaming nodes.
- `site/assets/js/streaming-view.mjs` — metric definitions at 67–79, metricRow at 81–85, template at 87–137 and render at 156 onward: 8 literal tooltip attributes plus 12 metric literals per mount; card and peripheral visibility conditions.
- `site/assets/js/i2c.js` — startStreamingMode at 1274 onward mounts #i2cStreamRoot; detail panels use data-title as headings, not tooltip copy.
- `site/assets/js/debug-mode.js` — applyStreamingToggle at 11–16 mounts #dmStreamRoot; generated register options contain visible text, not tooltip attributes.
- `site/assets/js/router.js` — routes at 16–27; resolveRoute at 83–86 aliases dashboard to communication; operator controls are removed or hidden before public-view mounting.
- `site/assets/js/runs.js` — updateAnalysisControls at 118–124 switches #chartTitle text; renderChart and event markers do not build hover value popups.
- `site/knight-eps-phase12/viewer/main.mjs` — briefDetail at 162 and listParts at 178 onward populate the selected-part panel and buttons; no per-part hover label generation.
- `telemetry-bridge/server.js` — operator-pages routing at 1853–1862 loads auth/views pages and checks operator access.

## Site navigation

### NAV-STREAMING

- Page/section: Site navigation
- Control or label: Streaming navigation badge
- Source: `site/index.html:45`
- Locator: `#streamingNavBadge[title]`
- Mechanism: Native title attribute
- Status: Current route

**Current tooltip text**

Streaming Telemetry mode is on

**Replacement text**

Streaming Telemetry mode is on

**Notes**

Shown when shared Streaming Telemetry mode is on; fixed text.


## I2C Telemetry details

### I2C-MOCK

- Page/section: I2C Telemetry details
- Control or label: Mock Telemetry switch
- Source: `site/modules/communication.html:9`
- Locator: `.i2c-mock-control[data-tooltip]`
- Mechanism: data-tooltip with information button
- Status: Current route

**Current tooltip text**

Mock Telemetry uses locally generated values. Turn it off to view packets from the ESP32.

**Replacement text**

Mock Telemetry uses locally generated values. Turn it off to view packets from the ESP32.

**Notes**

Information button added beside switch; fixed text.

### I2C-CONNECTION

- Page/section: I2C Telemetry details
- Control or label: Peripheral connection status
- Source: `site/modules/communication.html:24`
- Locator: `.bus-connection-status[data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Shows whether recent ESP32 telemetry is reaching the browser through the bridge. It does not test each I²C device.

**Replacement text**

Shows whether recent ESP32 telemetry is reaching the browser through the bridge. It does not test each I²C device.

**Notes**

Status label changes with connection state; tooltip stays fixed.

### I2C-TEMPERATURE

- Page/section: I2C Telemetry details
- Control or label: Light and temperature detail — Peripheral Temperature
- Source: `site/modules/communication.html:138`
- Locator: `[data-detail-panel="environment"] span[data-tooltip] before #peripheralTemperatureValue`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

MCP9700 temperature reading. Telemetry does not specify where the sensor is mounted.

**Replacement text**

MCP9700 temperature reading. Telemetry does not specify where the sensor is mounted.

**Notes**

Visible when the Light + temperature detail panel is opened; fixed text.

### I2C-LIGHT

- Page/section: I2C Telemetry details
- Control or label: Light and temperature detail — Light Level (TEMT6000)
- Source: `site/modules/communication.html:143`
- Locator: `[data-detail-panel="environment"] span[data-tooltip] before #relativeLightValue`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

TEMT6000 reading shown as a relative light category and sensor voltage; it is not calibrated in lux.

**Replacement text**

TEMT6000 reading shown as a relative light category and sensor voltage; it is not calibrated in lux.

**Notes**

Visible when the Light + temperature detail panel is opened; fixed text.

### I2C-SHUNT

- Page/section: I2C Telemetry details
- Control or label: PV current monitor detail — Shunt Voltage
- Source: `site/modules/communication.html:155`
- Locator: `[data-detail-panel="pv"] span[data-tooltip] before #pvShuntValue`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Voltage across the INA226 current-sense shunt, used to derive current.

**Replacement text**

Voltage across the INA226 current-sense shunt, used to derive current.

**Notes**

Visible when the PV current monitor detail panel is opened; fixed text.

### I2C-SELECTED-INPUT

- Page/section: I2C Telemetry details
- Control or label: MPPT switch detail — Selected Input
- Source: `site/modules/communication.html:164`
- Locator: `[data-detail-panel="mppt"] span[data-tooltip] before #mpptStateValue`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Input path selected by the BQ25798 charger, as reported in telemetry.

**Replacement text**

Input path selected by the BQ25798 charger, as reported in telemetry.

**Notes**

Visible when the MPPT switch detail panel is opened; fixed text.


## I2C Telemetry streaming controls

### I2C-ST-INDICATOR

- Page/section: I2C Telemetry streaming controls
- Control or label: Streaming Telemetry status
- Source: `site/assets/js/streaming-view.mjs:90`
- Locator: `template(); #i2cStreamRoot [data-st="indicator"]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Live means recent packets are arriving. Stale means the displayed values may be outdated.

**Replacement text**

Live means recent packets are arriving. Stale means the displayed values may be outdated.

**Notes**

Streaming mode on. Always present in mounted streaming view; indicator label varies but tooltip is fixed. No placeholders.

### I2C-ST-PV-HEADER

- Page/section: I2C Telemetry streaming controls
- Control or label: PV · INA226 card heading
- Source: `site/assets/js/streaming-view.mjs:99`
- Locator: `template(); #i2cStreamRoot [data-card="pv"] h4`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Photovoltaic (PV) voltage, current, and power from the INA226 monitor.

**Replacement text**

Photovoltaic (PV) voltage, current, and power from the INA226 monitor.

**Notes**

Streaming mode on. PV device must be reported and INA226 card enabled. No placeholders.

### I2C-ST-BMS-HEADER

- Page/section: I2C Telemetry streaming controls
- Control or label: BMS · BQ76942 card heading
- Source: `site/assets/js/streaming-view.mjs:103`
- Locator: `template(); #i2cStreamRoot [data-card="bms"] h4`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Battery management system (BMS) measurements from the BQ76942.

**Replacement text**

Battery management system (BMS) measurements from the BQ76942.

**Notes**

Streaming mode on. BMS device must be reported and BQ76942 card enabled. No placeholders.

### I2C-ST-MPPT-HEADER

- Page/section: I2C Telemetry streaming controls
- Control or label: MPPT · BQ25798 card heading
- Source: `site/assets/js/streaming-view.mjs:115`
- Locator: `template(); #i2cStreamRoot [data-card="mppt"] h4`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Maximum power point tracking (MPPT) charger measurements from the BQ25798.

**Replacement text**

Maximum power point tracking (MPPT) charger measurements from the BQ25798.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled. No placeholders.

### I2C-ST-ACDRV

- Page/section: I2C Telemetry streaming controls
- Control or label: MPPT — ACDRV Path · 0x13
- Source: `site/assets/js/streaming-view.mjs:116`
- Locator: `template(); #i2cStreamRoot [data-card="mppt"] .st-acdrv .st-label`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Charger gate-drive path state reported from BQ25798 register 0x13.

**Replacement text**

Charger gate-drive path state reported from BQ25798 register 0x13.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled. No placeholders.

### I2C-ST-FAULTS

- Page/section: I2C Telemetry streaming controls
- Control or label: MPPT — Active Faults · 0x20
- Source: `site/assets/js/streaming-view.mjs:119`
- Locator: `template(); #i2cStreamRoot [data-v="mppt.activeFaults"] preceding .st-label`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Count of active fault bits reported by BQ25798 register 0x20.

**Replacement text**

Count of active fault bits reported by BQ25798 register 0x20.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled. No placeholders.

### I2C-ST-ADC-DISABLE-0

- Page/section: I2C Telemetry streaming controls
- Control or label: MPPT — ADC Function Disable 0 · 0x2F
- Source: `site/assets/js/streaming-view.mjs:120`
- Locator: `template(); #i2cStreamRoot [data-card="mppt"] .st-label for 0x2F`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Hardware R/W; project write approval remains disabled. Value is not sampled in periodic telemetry.

**Replacement text**

Hardware R/W; project write approval remains disabled. Value is not sampled in periodic telemetry.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled; register is not sampled. No placeholders.

### I2C-ST-ADC-DISABLE-1

- Page/section: I2C Telemetry streaming controls
- Control or label: MPPT — ADC Function Disable 1 · 0x30
- Source: `site/assets/js/streaming-view.mjs:121`
- Locator: `template(); #i2cStreamRoot [data-card="mppt"] .st-label for 0x30`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Read on demand in Debug Mode or a Branch Definition. Value is not sampled in periodic telemetry.

**Replacement text**

Read on demand in Debug Mode or a Branch Definition. Value is not sampled in periodic telemetry.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled; register is not sampled. No placeholders.

### I2C-ST-PV-SHUNTMV

- Page/section: I2C Telemetry streaming controls
- Control or label: INA226 — Shunt · 0x01
- Source: `site/assets/js/streaming-view.mjs:71`
- Locator: `metric("pv.shuntMv"); metricRow(); #i2cStreamRoot [data-metric="pv.shuntMv"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

Voltage across the INA226 current-sense shunt, used to derive current.

**Replacement text**

Voltage across the INA226 current-sense shunt, used to derive current.

**Notes**

Streaming mode on. INA226 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-BMS-PACKV

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ76942 — Pack voltage · 0x36
- Source: `site/assets/js/streaming-view.mjs:72`
- Locator: `metric("bms.packV"); metricRow(); #i2cStreamRoot [data-metric="bms.packV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ76942 PACK pin voltage.

**Replacement text**

BQ76942 PACK pin voltage.

**Notes**

Streaming mode on. BQ76942 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-BMS-INTTEMPC

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ76942 — Internal temp · 0x68
- Source: `site/assets/js/streaming-view.mjs:73`
- Locator: `metric("bms.intTempC"); metricRow(); #i2cStreamRoot [data-metric="bms.intTempC"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ76942 internal temperature reading.

**Replacement text**

BQ76942 internal temperature reading.

**Notes**

Streaming mode on. BQ76942 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-MPPT-VBUSV

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ25798 — VBUS · 0x35
- Source: `site/assets/js/streaming-view.mjs:74`
- Locator: `metric("mppt.vbusV"); metricRow(); #i2cStreamRoot [data-metric="mppt.vbusV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 bus voltage register.

**Replacement text**

BQ25798 bus voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-MPPT-VAC1V

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ25798 — VAC1 · 0x37
- Source: `site/assets/js/streaming-view.mjs:75`
- Locator: `metric("mppt.vac1V"); metricRow(); #i2cStreamRoot [data-metric="mppt.vac1V"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 input voltage register.

**Replacement text**

BQ25798 input voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-MPPT-VBATV

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ25798 — VBAT · 0x3B
- Source: `site/assets/js/streaming-view.mjs:76`
- Locator: `metric("mppt.vbatV"); metricRow(); #i2cStreamRoot [data-metric="mppt.vbatV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 battery voltage register.

**Replacement text**

BQ25798 battery voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-MPPT-VSYSV

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ25798 — VSYS · 0x3D
- Source: `site/assets/js/streaming-view.mjs:77`
- Locator: `metric("mppt.vsysV"); metricRow(); #i2cStreamRoot [data-metric="mppt.vsysV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 system voltage register.

**Replacement text**

BQ25798 system voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-MPPT-IBUSMA

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ25798 — IBUS · 0x31
- Source: `site/assets/js/streaming-view.mjs:78`
- Locator: `metric("mppt.ibusMa"); metricRow(); #i2cStreamRoot [data-metric="mppt.ibusMa"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 bus current register.

**Replacement text**

BQ25798 bus current register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-MPPT-DIETEMPC

- Page/section: I2C Telemetry streaming controls
- Control or label: BQ25798 — Die temp · 0x41
- Source: `site/assets/js/streaming-view.mjs:79`
- Locator: `metric("mppt.dieTempC"); metricRow(); #i2cStreamRoot [data-metric="mppt.dieTempC"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 die temperature register.

**Replacement text**

BQ25798 die temperature register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-PER-TEMPC

- Page/section: I2C Telemetry streaming controls
- Control or label: MCP9700 — Temperature
- Source: `site/assets/js/streaming-view.mjs:131`
- Locator: `metric("per.tempC"); metricRow(); #i2cStreamRoot [data-metric="per.tempC"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

MCP9700 temperature derived from its analog output. Physical mounting location is not specified.

**Replacement text**

MCP9700 temperature derived from its analog output. Physical mounting location is not specified.

**Notes**

Streaming mode on. Peripheral data must be present and MCP9700 enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-PER-TEMPMV

- Page/section: I2C Telemetry streaming controls
- Control or label: MCP9700 — Output
- Source: `site/assets/js/streaming-view.mjs:131`
- Locator: `metric("per.tempMv"); metricRow(); #i2cStreamRoot [data-metric="per.tempMv"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

MCP9700 analog output voltage.

**Replacement text**

MCP9700 analog output voltage.

**Notes**

Streaming mode on. Peripheral data must be present and MCP9700 enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### I2C-ST-PER-LIGHT

- Page/section: I2C Telemetry streaming controls
- Control or label: TEMT6000 — Light Level
- Source: `site/assets/js/streaming-view.mjs:133`
- Locator: `metric("per.light"); metricRow(); #i2cStreamRoot [data-metric="per.light"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

Relative light category and sensor output voltage; this is not a lux measurement.

**Replacement text**

Relative light category and sensor output voltage; this is not a lux measurement.

**Notes**

Streaming mode on. Peripheral data must be present and TEMT6000 enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.


## Logged Telemetry

### RUNS-BRIDGE

- Page/section: Logged Telemetry
- Control or label: Recorder bridge status
- Source: `site/modules/runs.html:8`
- Locator: `.tooltip-status-wrap containing #runsBridgeState`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Shows whether the bridge can record telemetry and serve saved runs.

**Replacement text**

Shows whether the bridge can record telemetry and serve saved runs.

**Notes**

Status label varies; tooltip stays fixed.

### RUNS-START

- Page/section: Logged Telemetry
- Control or label: Capture Control — Start Recording
- Source: `site/modules/runs.html:20`
- Locator: `#runStart[data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Starts recording from the latest fresh hardware packet. Operator access is required.

**Replacement text**

Starts recording from the latest fresh hardware packet. Operator access is required.

**Notes**

Operator controls are hidden for nonoperators. Button may be disabled while a run is active or control is unavailable.

### RUNS-REFRESH

- Page/section: Logged Telemetry
- Control or label: Saved runs — Refresh saved runs
- Source: `site/modules/runs.html:38`
- Locator: `#runsRefresh[title]`
- Mechanism: Native title attribute
- Status: Current route

**Current tooltip text**

Refresh saved runs

**Replacement text**

Refresh saved runs

**Notes**

Native title duplicates the accessible label; included because title implements hover text.

### RUNS-ANALYSIS

- Page/section: Logged Telemetry
- Control or label: Measurement timeline — Analysis
- Source: `site/modules/runs.html:89`
- Locator: `label[for="analysisMode"] parent [data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Choose a timeline or align measurements around an initialization event. This is not a frequency sweep.

**Replacement text**

Choose a timeline or align measurements around an initialization event. This is not a frequency sweep.

**Notes**

Available after selecting a run; fixed text in both timeline and response analysis.

### RUNS-WINDOW

- Page/section: Logged Telemetry
- Control or label: Measurement timeline — Window
- Source: `site/modules/runs.html:100`
- Locator: `label[for="seriesWindow"] parent [data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Full-run chart requests cover at most 24 hours. Longer recordings show the latest 24 hours.

**Replacement text**

Full-run chart requests cover at most 24 hours. Longer recordings show the latest 24 hours.

**Notes**

Available after selecting a run; Window control is hidden in response analysis.

### RUNS-CHART-TIMELINE

- Page/section: Logged Telemetry
- Control or label: Measurement chart — timeline variant
- Source: `site/assets/js/runs.js:123`
- Locator: `updateAnalysisControls(); text("chartTitle", ...); #seriesChart > title#chartTitle`
- Mechanism: Native SVG title
- Status: Current route

**Current tooltip text**

Telemetry measurement timeline

**Replacement text**

Telemetry measurement timeline

**Notes**

Default markup and timeline mode (analysisMode is not response). One SVG title placement with two separately editable variants; graph frame is shown only when numeric samples exist. Fixed text; no placeholders. Also supplies an accessible name.

### RUNS-CHART-RESPONSE

- Page/section: Logged Telemetry
- Control or label: Measurement chart — response variant
- Source: `site/assets/js/runs.js:123`
- Locator: `updateAnalysisControls(); text("chartTitle", ...); #seriesChart > title#chartTitle`
- Mechanism: Native SVG title
- Status: Current route

**Current tooltip text**

Trigger-aligned telemetry response

**Replacement text**

Trigger-aligned telemetry response

**Notes**

Response mode (analysisMode equals response). One SVG title placement with two separately editable variants; graph frame is shown only when numeric samples exist. Fixed text; no placeholders. Also supplies an accessible name.


## Debug Mode operator controls

### DEBUG-CONNECTION

- Page/section: Debug Mode operator controls
- Control or label: Page bridge connection status
- Source: `telemetry-bridge/auth/views/debug-mode.html:8`
- Locator: `.tooltip-status-wrap containing #dmStatus`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Bridge connection shows the event stream is available; individual devices may still be offline.

**Replacement text**

Bridge connection shows the event stream is available; individual devices may still be offline.

**Notes**

Operator-only page; status label varies while tooltip stays fixed.

### DEBUG-TOKEN

- Page/section: Debug Mode operator controls
- Control or label: Bridge — command token status
- Source: `telemetry-bridge/auth/views/debug-mode.html:12`
- Locator: `.tooltip-status-wrap containing #dmAuthPill`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Shows whether the bridge accepted the command token required for hardware commands.

**Replacement text**

Shows whether the bridge accepted the command token required for hardware commands.

**Notes**

Operator-only page; token state label varies while tooltip stays fixed.

### DEBUG-ENABLE

- Page/section: Debug Mode operator controls
- Control or label: Debug control — Enable Debug
- Source: `telemetry-bridge/auth/views/debug-mode.html:27`
- Locator: `#dmDebugOn[data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Requests debug mode from the device through the bridge. Requires operator access and a valid command token.

**Replacement text**

Requests debug mode from the device through the bridge. Requires operator access and a valid command token.

**Notes**

Operator-only page; command availability may disable the button. Fixed text.

### DEBUG-SCAN

- Page/section: Debug Mode operator controls
- Control or label: Debug control — Bus Scan + Probe
- Source: `telemetry-bridge/auth/views/debug-mode.html:35`
- Locator: `#dmScan[data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Scans supported I²C addresses and probes devices; results appear in the bus scan panel.

**Replacement text**

Scans supported I²C addresses and probes devices; results appear in the bus scan panel.

**Notes**

Operator-only page; command availability may disable the button. Fixed text.

### DEBUG-ADD-REGISTER

- Page/section: Debug Mode operator controls
- Control or label: Register Access — Add Register
- Source: `telemetry-bridge/auth/views/debug-mode.html:62`
- Locator: `#dmAddRegister[data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Saves a shared address for reads. It does not grant write access.

**Replacement text**

Saves a shared address for reads. It does not grant write access.

**Notes**

Operator-only page; may be disabled when control is unavailable or busy. Fixed text.

### DEBUG-READ

- Page/section: Debug Mode operator controls
- Control or label: Register Access — Read
- Source: `telemetry-bridge/auth/views/debug-mode.html:68`
- Locator: `#dmRead[data-tooltip]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Reads the selected register and displays raw bytes plus any available conversion.

**Replacement text**

Reads the selected register and displays raw bytes plus any available conversion.

**Notes**

Operator-only page; command availability may disable the button. Fixed text.

### DEBUG-WRITE

- Page/section: Debug Mode operator controls
- Control or label: Register Access — Write information button
- Source: `telemetry-bridge/auth/views/debug-mode.html:69`
- Locator: `.info-tip-wrap[data-tooltip-icon] containing #dmWrite`
- Mechanism: data-tooltip with information button
- Status: Current route

**Current tooltip text**

Writes require an approved register and a value within its width. Acknowledgment does not confirm the stored value unless it is read back.

**Replacement text**

Writes require an approved register and a value within its width. Acknowledgment does not confirm the stored value unless it is read back.

**Notes**

Operator-only page; information button belongs to the wrapper, so its help remains separate from the write button disabled state. Fixed text.


## Debug Mode streaming controls

### DEBUG-ST-INDICATOR

- Page/section: Debug Mode streaming controls
- Control or label: Streaming Telemetry status
- Source: `site/assets/js/streaming-view.mjs:90`
- Locator: `template(); #dmStreamRoot [data-st="indicator"]`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Live means recent packets are arriving. Stale means the displayed values may be outdated.

**Replacement text**

Live means recent packets are arriving. Stale means the displayed values may be outdated.

**Notes**

Streaming mode on. Always present in mounted streaming view; indicator label varies but tooltip is fixed. No placeholders.

### DEBUG-ST-PV-HEADER

- Page/section: Debug Mode streaming controls
- Control or label: PV · INA226 card heading
- Source: `site/assets/js/streaming-view.mjs:99`
- Locator: `template(); #dmStreamRoot [data-card="pv"] h4`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Photovoltaic (PV) voltage, current, and power from the INA226 monitor.

**Replacement text**

Photovoltaic (PV) voltage, current, and power from the INA226 monitor.

**Notes**

Streaming mode on. PV device must be reported and INA226 card enabled. No placeholders.

### DEBUG-ST-BMS-HEADER

- Page/section: Debug Mode streaming controls
- Control or label: BMS · BQ76942 card heading
- Source: `site/assets/js/streaming-view.mjs:103`
- Locator: `template(); #dmStreamRoot [data-card="bms"] h4`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Battery management system (BMS) measurements from the BQ76942.

**Replacement text**

Battery management system (BMS) measurements from the BQ76942.

**Notes**

Streaming mode on. BMS device must be reported and BQ76942 card enabled. No placeholders.

### DEBUG-ST-MPPT-HEADER

- Page/section: Debug Mode streaming controls
- Control or label: MPPT · BQ25798 card heading
- Source: `site/assets/js/streaming-view.mjs:115`
- Locator: `template(); #dmStreamRoot [data-card="mppt"] h4`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Maximum power point tracking (MPPT) charger measurements from the BQ25798.

**Replacement text**

Maximum power point tracking (MPPT) charger measurements from the BQ25798.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled. No placeholders.

### DEBUG-ST-ACDRV

- Page/section: Debug Mode streaming controls
- Control or label: MPPT — ACDRV Path · 0x13
- Source: `site/assets/js/streaming-view.mjs:116`
- Locator: `template(); #dmStreamRoot [data-card="mppt"] .st-acdrv .st-label`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Charger gate-drive path state reported from BQ25798 register 0x13.

**Replacement text**

Charger gate-drive path state reported from BQ25798 register 0x13.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled. No placeholders.

### DEBUG-ST-FAULTS

- Page/section: Debug Mode streaming controls
- Control or label: MPPT — Active Faults · 0x20
- Source: `site/assets/js/streaming-view.mjs:119`
- Locator: `template(); #dmStreamRoot [data-v="mppt.activeFaults"] preceding .st-label`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Count of active fault bits reported by BQ25798 register 0x20.

**Replacement text**

Count of active fault bits reported by BQ25798 register 0x20.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled. No placeholders.

### DEBUG-ST-ADC-DISABLE-0

- Page/section: Debug Mode streaming controls
- Control or label: MPPT — ADC Function Disable 0 · 0x2F
- Source: `site/assets/js/streaming-view.mjs:120`
- Locator: `template(); #dmStreamRoot [data-card="mppt"] .st-label for 0x2F`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Hardware R/W; project write approval remains disabled. Value is not sampled in periodic telemetry.

**Replacement text**

Hardware R/W; project write approval remains disabled. Value is not sampled in periodic telemetry.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled; register is not sampled. No placeholders.

### DEBUG-ST-ADC-DISABLE-1

- Page/section: Debug Mode streaming controls
- Control or label: MPPT — ADC Function Disable 1 · 0x30
- Source: `site/assets/js/streaming-view.mjs:121`
- Locator: `template(); #dmStreamRoot [data-card="mppt"] .st-label for 0x30`
- Mechanism: data-tooltip
- Status: Current route

**Current tooltip text**

Read on demand in Debug Mode or a Branch Definition. Value is not sampled in periodic telemetry.

**Replacement text**

Read on demand in Debug Mode or a Branch Definition. Value is not sampled in periodic telemetry.

**Notes**

Streaming mode on. MPPT device must be reported and BQ25798 card enabled; register is not sampled. No placeholders.

### DEBUG-ST-PV-SHUNTMV

- Page/section: Debug Mode streaming controls
- Control or label: INA226 — Shunt · 0x01
- Source: `site/assets/js/streaming-view.mjs:71`
- Locator: `metric("pv.shuntMv"); metricRow(); #dmStreamRoot [data-metric="pv.shuntMv"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

Voltage across the INA226 current-sense shunt, used to derive current.

**Replacement text**

Voltage across the INA226 current-sense shunt, used to derive current.

**Notes**

Streaming mode on. INA226 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-BMS-PACKV

- Page/section: Debug Mode streaming controls
- Control or label: BQ76942 — Pack voltage · 0x36
- Source: `site/assets/js/streaming-view.mjs:72`
- Locator: `metric("bms.packV"); metricRow(); #dmStreamRoot [data-metric="bms.packV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ76942 PACK pin voltage.

**Replacement text**

BQ76942 PACK pin voltage.

**Notes**

Streaming mode on. BQ76942 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-BMS-INTTEMPC

- Page/section: Debug Mode streaming controls
- Control or label: BQ76942 — Internal temp · 0x68
- Source: `site/assets/js/streaming-view.mjs:73`
- Locator: `metric("bms.intTempC"); metricRow(); #dmStreamRoot [data-metric="bms.intTempC"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ76942 internal temperature reading.

**Replacement text**

BQ76942 internal temperature reading.

**Notes**

Streaming mode on. BQ76942 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-MPPT-VBUSV

- Page/section: Debug Mode streaming controls
- Control or label: BQ25798 — VBUS · 0x35
- Source: `site/assets/js/streaming-view.mjs:74`
- Locator: `metric("mppt.vbusV"); metricRow(); #dmStreamRoot [data-metric="mppt.vbusV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 bus voltage register.

**Replacement text**

BQ25798 bus voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-MPPT-VAC1V

- Page/section: Debug Mode streaming controls
- Control or label: BQ25798 — VAC1 · 0x37
- Source: `site/assets/js/streaming-view.mjs:75`
- Locator: `metric("mppt.vac1V"); metricRow(); #dmStreamRoot [data-metric="mppt.vac1V"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 input voltage register.

**Replacement text**

BQ25798 input voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-MPPT-VBATV

- Page/section: Debug Mode streaming controls
- Control or label: BQ25798 — VBAT · 0x3B
- Source: `site/assets/js/streaming-view.mjs:76`
- Locator: `metric("mppt.vbatV"); metricRow(); #dmStreamRoot [data-metric="mppt.vbatV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 battery voltage register.

**Replacement text**

BQ25798 battery voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-MPPT-VSYSV

- Page/section: Debug Mode streaming controls
- Control or label: BQ25798 — VSYS · 0x3D
- Source: `site/assets/js/streaming-view.mjs:77`
- Locator: `metric("mppt.vsysV"); metricRow(); #dmStreamRoot [data-metric="mppt.vsysV"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 system voltage register.

**Replacement text**

BQ25798 system voltage register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-MPPT-IBUSMA

- Page/section: Debug Mode streaming controls
- Control or label: BQ25798 — IBUS · 0x31
- Source: `site/assets/js/streaming-view.mjs:78`
- Locator: `metric("mppt.ibusMa"); metricRow(); #dmStreamRoot [data-metric="mppt.ibusMa"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 bus current register.

**Replacement text**

BQ25798 bus current register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-MPPT-DIETEMPC

- Page/section: Debug Mode streaming controls
- Control or label: BQ25798 — Die temp · 0x41
- Source: `site/assets/js/streaming-view.mjs:79`
- Locator: `metric("mppt.dieTempC"); metricRow(); #dmStreamRoot [data-metric="mppt.dieTempC"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

BQ25798 die temperature register.

**Replacement text**

BQ25798 die temperature register.

**Notes**

Streaming mode on. BQ25798 device must be reported and its card enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-PER-TEMPC

- Page/section: Debug Mode streaming controls
- Control or label: MCP9700 — Temperature
- Source: `site/assets/js/streaming-view.mjs:131`
- Locator: `metric("per.tempC"); metricRow(); #dmStreamRoot [data-metric="per.tempC"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

MCP9700 temperature derived from its analog output. Physical mounting location is not specified.

**Replacement text**

MCP9700 temperature derived from its analog output. Physical mounting location is not specified.

**Notes**

Streaming mode on. Peripheral data must be present and MCP9700 enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-PER-TEMPMV

- Page/section: Debug Mode streaming controls
- Control or label: MCP9700 — Output
- Source: `site/assets/js/streaming-view.mjs:131`
- Locator: `metric("per.tempMv"); metricRow(); #dmStreamRoot [data-metric="per.tempMv"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

MCP9700 analog output voltage.

**Replacement text**

MCP9700 analog output voltage.

**Notes**

Streaming mode on. Peripheral data must be present and MCP9700 enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.

### DEBUG-ST-PER-LIGHT

- Page/section: Debug Mode streaming controls
- Control or label: TEMT6000 — Light Level
- Source: `site/assets/js/streaming-view.mjs:133`
- Locator: `metric("per.light"); metricRow(); #dmStreamRoot [data-metric="per.light"] .st-label`
- Mechanism: Generated data-tooltip
- Status: Current route

**Current tooltip text**

Relative light category and sensor output voltage; this is not a lux measurement.

**Replacement text**

Relative light category and sensor output voltage; this is not a lux measurement.

**Notes**

Streaming mode on. Peripheral data must be present and TEMT6000 enabled. metricRow interpolates m.tooltip from this fixed literal; no runtime text placeholders.


## Digital Twin

### TWIN-FRAME

- Page/section: Digital Twin
- Control or label: Embedded interactive Digital Twin frame
- Source: `site/modules/twin.html:3`
- Locator: `#knight-eps-twin[title]`
- Mechanism: Native title attribute
- Status: Current route

**Current tooltip text**

Knight EPS interactive digital twin

**Replacement text**

Knight EPS interactive digital twin

**Notes**

Native iframe title also names the frame for assistive technology. Browser and iframe hit area determine native hover availability; it does not generate a part tooltip inside the viewer.

### TWIN-FIT

- Page/section: Digital Twin
- Control or label: Camera controls — Fit model
- Source: `site/knight-eps-phase12/viewer/index.html:2`
- Locator: `#fit-model[title]`
- Mechanism: Native title attribute
- Status: Current route

**Current tooltip text**

Fit visible assembly (F)

**Replacement text**

Fit visible assembly (F)

**Notes**

Native title in embedded and standalone viewer. F is the keyboard shortcut; fixed text. The same viewer control is counted once across these entry points.


## Operator Manual

### MANUAL-FRAME

- Page/section: Operator Manual
- Control or label: Embedded operator manual frame
- Source: `telemetry-bridge/auth/views/manual.html:4`
- Locator: `iframe.manual-frame[title]`
- Mechanism: Native title attribute
- Status: Current route

**Current tooltip text**

Knight EPS operator manual

**Replacement text**

Knight EPS operator manual

**Notes**

Operator-only page. Native iframe title also names the frame for assistive technology; native hover availability depends on browser and iframe hit area.


## Legacy dashboard module

### LEGACY-BRIDGE

- Page/section: Legacy dashboard module
- Control or label: Live System Summary — UDP → SSE Bridge
- Source: `site/modules/dashboard.html:18`
- Locator: `.status-pill[data-tooltip]`
- Mechanism: data-tooltip
- Status: Legacy module outside current router

**Current tooltip text**

The bridge receives ESP32 packets over UDP and sends updates to this page over Server-Sent Events (SSE).

**Replacement text**

The bridge receives ESP32 packets over UDP and sends updates to this page over Server-Sent Events (SSE).

**Notes**

Not mounted by current router: #dashboard resolves to communication. Static module retains this fixed tooltip declaration.

### LEGACY-TEMPERATURE

- Page/section: Legacy dashboard module
- Control or label: Live System Summary — External Temperature
- Source: `site/modules/dashboard.html:35`
- Locator: `span[data-tooltip] before #liveExternalTemp`
- Mechanism: data-tooltip
- Status: Legacy module outside current router

**Current tooltip text**

MCP9700 temperature reading. Telemetry does not specify where the sensor is mounted.

**Replacement text**

MCP9700 temperature reading. Telemetry does not specify where the sensor is mounted.

**Notes**

Not mounted by current router: #dashboard resolves to communication. Static module retains this fixed tooltip declaration.

## Source snapshot hashes

SHA256 of local authored website and bridge files scanned. These hashes identify the baseline, including uncommitted changes; line numbers are advisory and semantic locators should be preferred after edits.

| Source file | SHA256 |
| --- | --- |
| `site/assets/css/debug-mode.css` | `fd1b392ff264532425dc52c81f27dc4edca05c21c547c0732f5062eb292eb83d` |
| `site/assets/css/link-health.css` | `316ba6a54038243168894bc10c764729e5cb46a0512ce539273de146041861d1` |
| `site/assets/css/runs.css` | `07b56f79baccf8919ae14683d15a133e0d5b75360d32bf8ecc6f0be49de54ecb` |
| `site/assets/css/sequence-history.css` | `b7811538d902425857a8a619ee077400af3d0143129b1cb5336250c5407994b9` |
| `site/assets/css/sequences.css` | `20fa7f7e70cc1f387059b23299af477fc92ab0be58e8982eab2bd0070107b8f9` |
| `site/assets/css/streaming.css` | `c806c6796ee78114e1db1c4952d44d19304ab76a9fa7cfcf021e688c5fe9750d` |
| `site/assets/css/styles.css` | `5c8d17cf36c9e1ee964f597d3674551c622049d263cb07e3dc6f8df35c9ad9ad` |
| `site/assets/data/register-map.json` | `6a5924263cc3284f4c60743d7071e7733860e8731bbc525b122cfa55cf8e0db7` |
| `site/assets/js/app.js` | `d6a9ba78644210599468d673035ba1572f6e68b981244f7802677ddbe24259bd` |
| `site/assets/js/auth.js` | `f2199876f0c08f9f35f8c11e77763a19484e684fa3e25b8213f98d02fe039be4` |
| `site/assets/js/dashboard.js` | `aa925bd67f501f2de4ad3fa8a5fbe0f3c4a64210aebe9993002f5b9b4fd85d9b` |
| `site/assets/js/debug-commands.mjs` | `a22d79601c694bca6c013a51e285630733cd7709f357e418bc84e87b301f0c0b` |
| `site/assets/js/debug-mode.js` | `dc02de89125dfd97764d5fe64f5ecace60c5491da56ec4d7020468bc3403016c` |
| `site/assets/js/i2c.js` | `bdefcdee39e53145a560a99fcd860c22e21d14163f18e0e53d0ff100ffac45f3` |
| `site/assets/js/link-health.js` | `a917b59e57b62e4521bc027c22100970d68378605888855230d10a086573d1ed` |
| `site/assets/js/link-stats.mjs` | `ebf2d7c01a03bdcb4fef34edad7257492db9c798777530c7014d6ee7da9b1d25` |
| `site/assets/js/operator-registers.mjs` | `1644edc6d8fd0d2ba4c8cabeaa96d00b35f4f76c7a451f038e5a65b6fa015d81` |
| `site/assets/js/register-controls.mjs` | `e5fe7eeac26a4eef48a76026d0c63afe6646cd56c2348c18bec4d3630bc43a52` |
| `site/assets/js/register-conversions.mjs` | `4d1911e39ebe5459041cd50fe8592c53692f6125f611a622022cdf9b04e7f386` |
| `site/assets/js/register-definition.mjs` | `04e27058edafe0419e3ff6de4b67acde442e47200487786c565bc6c44aa06283` |
| `site/assets/js/register-policy.mjs` | `cc1600af86331d250738df9d4e39ccaccfd094de6573336b1750f9090f46671c` |
| `site/assets/js/register-registry.mjs` | `cf32b587d3b56a43c52e1527bf6924e33ba800d2005de689f0a3d24d8d94c207` |
| `site/assets/js/router.js` | `61dab53aea34ab57ef128d115e094797e3f69b2771a96775cf9ce69382e2ab57` |
| `site/assets/js/runs-model.mjs` | `570b18e5f8bb925896fd490b8ba01d185873525f4e6bc9a7b1f4164d1e02d769` |
| `site/assets/js/runs.js` | `395ffb75bafa2c3b0932be52074614f814ed380f070f02493f027c8fc9de0e00` |
| `site/assets/js/sequence-actions.mjs` | `8d939eda1e4923239d280d524b5032b0c0796baed1af0e8a8d1ef0ecc7e1872e` |
| `site/assets/js/sequence-condition-fields.mjs` | `c7ef20e9543107f75f9ba0de269e2fdf0284ae000dd66e4b0487b9a91d2fa18f` |
| `site/assets/js/sequence-editor-model.mjs` | `c71e733919b1da396c58aa9fed79f0d98a1506e454faa888dece7a121937e588` |
| `site/assets/js/sequence-history.mjs` | `034abfb2dfcf16409770e1f05149b65f7d322d5becb473c35a692d71ba006d13` |
| `site/assets/js/sequence-register-catalog.mjs` | `8d5f9c64c980f534711bea3727d8ad987f436c205a12bc9b993b07ee522510cd` |
| `site/assets/js/sequences.js` | `f30d258b97b25adade7bc21f202b164865bc0b79f65aee74f89eee62b2ab471c` |
| `site/assets/js/streaming-telemetry.mjs` | `2d914f6d6bbb124ba8a7e1eeb25e23f12c15170e0a656763c26e5e9f2098c5e2` |
| `site/assets/js/streaming-view.mjs` | `3f79da8cfe7d7118ee889c601e9b78fec997d462108f1460950e4071e322a895` |
| `site/assets/js/telemetry-model.mjs` | `ab7ab57066fd6fcfefc8c164dd1d09a8200683795c02e2e7d2ad0cfb12886fd5` |
| `site/assets/js/tooltips.js` | `fae5687dec4d10e2ed8884b34978031477f43022af50e00d0fdbebe22a9d7de1` |
| `site/assets/js/twin.js` | `1a659192ac9c262ba0b9de8845c8bb3117b193e36ea9a34517dee40c3a88e7f6` |
| `site/index.html` | `cc4eba3bd32b914dd74581b74c70ce559cbb2ee6a91d3cbf4edb1fe67b874294` |
| `site/knight-eps-phase12/docs/component_manifest.json` | `c0444bb3286d855fe84de125fd73e94a50661e26e1fe90c912ff8b73ffb947e7` |
| `site/knight-eps-phase12/docs/model-upgrades.json` | `6e2ae91237f144c3d1b2f3c9af5af5a507cefdf97a6405aa7a2e8475389a3e0a` |
| `site/knight-eps-phase12/models/display/artwork-masks.json` | `52e36cd23ad34af05bd069963308fc1b4aa69f98d7864ceacc441363d6a26ba4` |
| `site/knight-eps-phase12/models/display/build-report.json` | `eabc7dcdb36e6ab6845ae98679a20c1ee665600e676596011a47c0d26fc91d26` |
| `site/knight-eps-phase12/models/display/closed-primitives-compact.json` | `e915d1b3d0d4b378c77daa82c99e022ec3c77fab17cf3649ebe4025f259e395e` |
| `site/knight-eps-phase12/models/display/compact-report.json` | `70beb6eea1455a20559ca8ff21c59e89a28fe610197b2cb3b16dd98f8903bd85` |
| `site/knight-eps-phase12/models/display/provenance.json` | `e238a6ed3dbcc5c10ba4a6ee6ef0e07d8f3ea003e3914475d970db9a27af7b29` |
| `site/knight-eps-phase12/viewer/dashboard-integration.mjs` | `71e1f404349c3673a390a496e333c308dc911bc181806c6997a52fa2ff1de7b6` |
| `site/knight-eps-phase12/viewer/display.mjs` | `00b3b4f99c5c211e4477c582e80df459e204b999ebe4748131233ac145d2ced3` |
| `site/knight-eps-phase12/viewer/framing.mjs` | `42dc5f52b5aee32c7cfb13c306e4b68d6bb9b94a34c668f1125b82b830e30ffb` |
| `site/knight-eps-phase12/viewer/index.html` | `db291bd94991f1c499dca6615a22a086c38ed9d92fc323d8166b7eee4e76c402` |
| `site/knight-eps-phase12/viewer/inspection.mjs` | `c3f37d707b2805b102516276f27a1e5bbfbf6906b22cbf12ba197ba2dcf65049` |
| `site/knight-eps-phase12/viewer/main.mjs` | `01a90ef2db88babf55cdb7f5df2447efb10d6698fe91f27bccc48c17bef10afe` |
| `site/knight-eps-phase12/viewer/render-optimizations.mjs` | `a8924189efbbaaba4555966ccc61a3fa3af8b6f86fa0c1525eae9959f4094503` |
| `site/knight-eps-phase12/viewer/rendering/certified-culling.mjs` | `6fe8a3c093198a7d1887cac5e6125159f5fe541d2ddff233bdfa1fa7c49b8357` |
| `site/knight-eps-phase12/viewer/rendering/cheap-occlusion.mjs` | `8e864b434332b0ba3f86945be2a05cc7dfd3528702671d02d2bacdd41e751845` |
| `site/knight-eps-phase12/viewer/rendering/decode-coverage.mjs` | `ebfb9d87b7c2a6a172f0c7ce7aecbe82831348a26b1ecaefed55cdd84322e7d7` |
| `site/knight-eps-phase12/viewer/rendering/depth-guard.mjs` | `069794b1dfe14d270665a0e7b0ea907c611ab16511185b6207708c33b52bd55b` |
| `site/knight-eps-phase12/viewer/rendering/fxaa-pass.mjs` | `aaedca66a2ce06e9767c40e360fff35b42dfb92673786c36ac3708aaa01625e1` |
| `site/knight-eps-phase12/viewer/rendering/lean-acrylic.mjs` | `de826832abaf6f18366068863c8596b4ca44e5c023f7aac42f7bbe62f7efa276` |
| `site/knight-eps-phase12/viewer/rendering/legacy-coverage.mjs` | `af11361a4690512fbaf9149c03f23a3701dbb04db2843220064bf36fc1674b69` |
| `site/knight-eps-phase12/viewer/rendering/model-loader.mjs` | `774afe7cce75e6db4a86448c2af1b0a06d9a31fe1d7a12b6008cdca211ee1abf` |
| `site/knight-eps-phase12/viewer/rendering/orthographic-shadow.mjs` | `7e8bed437b983961dac837fe239e0600b33aa4a02318c53027ccc68bcd15fd32` |
| `site/knight-eps-phase12/viewer/rendering/pipeline.mjs` | `58500b50caa383a22f9267a3cbfcff9201e675f3c349c2ff5b3a76e75faab302` |
| `site/knight-eps-phase12/viewer/styles.css` | `90ef56b7af4e126f06ed791a3be5e110b390c9580fc23029837d19d521ca338a` |
| `site/knight-eps-phase12/viewer/telemetry.mjs` | `136e8c02b19c08c2d14f1e91a5cde78876c2097c588bee9201e3cb005a854b72` |
| `site/manual.htm` | `e9846f2cb118c0bb15faff546c3f0e42c2beb38461f55fe6da49cfbe2bda9a6e` |
| `site/modules/communication.html` | `02a83b1f95484fa0ce913ed422c7567005a380cb62c22e914aefb41e1456d43e` |
| `site/modules/dashboard.html` | `cf8d832dac4af0746dcf9d857087c11ec79e6555816e8f43d7a075110122356a` |
| `site/modules/debug-mode.html` | `0932f73dd31269919ab4e2ddf7bb0427a740ad8bf3d71a4388e609281d673bc3` |
| `site/modules/home.html` | `ee7e1ce551b84e6c80ab96925b4ef8b1d9446cc6f65782a6fb22b2e389faa7fa` |
| `site/modules/link-health.html` | `325720855066e152fdeabb907df67e4099de1d0652c1a2d8428b62f3610d9802` |
| `site/modules/manual.html` | `54f07e31f1a0cee7bc95d490177fbf08ea9ed299b88a85b09db0ee12543fc91d` |
| `site/modules/partners.html` | `c1c79db85f56f2748c73895468912275cd41b0727ca40a5ff28729b7d55cccfa` |
| `site/modules/runs.html` | `0031a81e4034c0995f55788eef4db23a099b172af517dbee20fb6fac3ecca68b` |
| `site/modules/sequences.html` | `38db304a23ccae927c4c83c718b91fcdf27711e6837ab52ae42e40f23140468f` |
| `site/modules/twin.html` | `cc6910a56fb045a28d42fe6ad71177b07427444ac43b42d4e0c33c2adcae8009` |
| `telemetry-bridge/auth/session.mjs` | `fc2ff179fb7ef8971b8ec89fbeb2694f504a9a24a6b7339e17dd1ead44f0900f` |
| `telemetry-bridge/auth/views/debug-mode.html` | `141baf20f6710d326f4c241b901f12f5a33880ec7adb1ed5491c3452328cd501` |
| `telemetry-bridge/auth/views/manual-document.html` | `04bddcda424061b6ef9fbc5ef3fb47658b137fb0273b0639b1d13a56c65e1a59` |
| `telemetry-bridge/auth/views/manual.html` | `2910e0eaec5856f6ccf65b7e7822ea329b4cb3c55268436c6a7393d552e35908` |
| `telemetry-bridge/auth/views/sequences.html` | `1374657c246da8e612c66012e1f283ecde8a134272c2c918bb27e9376abb9d12` |
| `telemetry-bridge/server.js` | `42e4cf83015b3fd820f75816b4aa7524e61b8d9e93f8ae37859225e3d1c8bd4d` |
