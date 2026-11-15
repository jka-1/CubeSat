# Website UX/UI revamp — Figma handoff

[Open the editable Figma file](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=26-2)

Branch: `codex/figma-ux-ui-revamp`

Source commit: `e8aedb9`

Created: November 15, 2026

## Working in Figma

Use **04 · UX UI revamp — edit here** for design updates. Pages 01–03 preserve the current desktop, mobile, and detail-state baseline. Page 05 contains shared controls. There are 31 baseline frames and 31 corresponding working copies, 10 local component definitions, and shared typography/color styles.

Select a changed frame, copy its Figma link, and send it in this chat with the desired changes. The next implementation pass should read that frame through Figma MCP, compare it with its baseline, and update this branch. Figma edits do not automatically change the website.

The text, control labels, hierarchy, native vector icons, and navigation are editable. Raster fills are limited to source content assets: the star-field background, satellite image, chart references, and Digital Twin canvas references. Scrollable containers retain their underlying layers; expand their frames to edit content below the visible scroll window.

## Route and source map

| Route | UI source | Behavior source | Access |
| --- | --- | --- | --- |
| `#home` | `site/modules/home.html` | `site/assets/js/router.js` | Public |
| `#communication` / `#dashboard` alias | `site/modules/communication.html` | `site/assets/js/i2c.js`, streaming modules | Signed-in |
| `#link-health` | `site/modules/link-health.html` | `site/assets/js/link-health.js` | Signed-in |
| `#runs` | `site/modules/runs.html` | `site/assets/js/runs.js`, runs model | Signed-in |
| `#twin` | `site/modules/twin.html`, `site/knight-eps-phase12/viewer/` | `site/assets/js/twin.js`, viewer modules | Signed-in |
| `#debug-mode` | `telemetry-bridge/auth/views/debug-mode.html` | `site/assets/js/debug-mode.js` | Operator |
| `#sequences` | `telemetry-bridge/auth/views/sequences.html` | `site/assets/js/sequences.js`, sequence models | Operator |
| `#manual` | `telemetry-bridge/auth/views/manual.html`, `manual-document.html` | Router, guarded backend route | Operator |
| `#partners` (unlinked) | `site/modules/partners.html` | Router | Operator |
| `#account` | `site/index.html` | `site/assets/js/auth.js` | Account/sign-in states |

The legacy `site/modules/dashboard.html` is not routed and is not a separate current screen.

## Implementation constraints

- Preserve authenticated routes, viewer/operator roles, control leases, CSRF protection, and command-token checks.
- Preserve SSE and live/mock/streaming telemetry provenance and reconnect behavior.
- Preserve recording, search/filter, chart analysis, packet/event inspection, and CSV export.
- Preserve register policy, shared registers, command confirmations, and hardware safety checks.
- Preserve Branch Definition editing, ordering, revisions, nested definitions, validation, simulation, execution, recovery, and saved history.
- Preserve Digital Twin model/telemetry integration, selection, camera, assembly, and rendering controls.
- Implement visual changes in source HTML/CSS and the relevant UI code; avoid backend, firmware, or production configuration changes unless separately requested.

## Baseline limitations

- The preview uses synthetic account and recording data, and offline telemetry. No real account credentials, hardware commands, or production changes were used.
- The licensed Horizon font is absent from the repository and unavailable in the Figma runtime. The baseline uses Arial-compatible Arimo.
- Figma is a static design workspace. It does not execute the website's telemetry, authentication, recording, command, or WebGL behavior.
- The Digital Twin viewport is represented by its loading/blank canvas reference. Its desktop controls and mobile collapsed state are native editable layers. The 3D assembly itself remains in the website.
- The Home reference freezes the satellite animation into a clear static pose and adjusts the heading line breaks for the fallback font.
- The Branch Definition example intentionally exposes validation feedback; it is an unfinished synthetic definition rather than a runnable saved definition.
- Layout and style changes in the revamp page can be extensive while the behavior contracts above remain intact.

## Frame map

| Screen | Current reference | Revamp copy |
| --- | --- | --- |
| 01 · Home · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=18-2) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-327) |
| 02 · I²C Telemetry · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=18-33) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-358) |
| 03 · Network Statistics · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=18-183) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-508) |
| 04 · Logged Telemetry · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=18-403) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-728) |
| 05 · Digital Twin · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=18-626) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-951) |
| 06 · Programming · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-2) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-1241) |
| 07 · Branch Definition · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-289) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-1528) |
| 08 · Manual · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-466) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-1705) |
| 09 · Partners · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-1574) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-2813) |
| 10 · Account · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-1725) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-2964) |
| 11 · Account / operator · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-1761) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3000) |
| 01 · I²C Telemetry / overview · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-1790) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-5623) |
| 02 · I²C Telemetry / environment · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-1997) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-5830) |
| 03 · I²C Telemetry / pv · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-2175) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-6008) |
| 04 · I²C Telemetry / mppt · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-2366) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-6199) |
| 05 · I²C Telemetry / bms · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-2554) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-6387) |
| 06 · I²C Telemetry / streaming · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-2789) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-6622) |
| 07 · Branch Definition / example · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-2970) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-6803) |
| 08 · Branch Definition / library · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-3209) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-7042) |
| 09 · Logged Telemetry / response · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-3416) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-7249) |
| 10 · Programming / denied · 1440 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-3752) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-7583) |
| 01 · Home · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-3782) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3029) |
| 02 · I²C Telemetry · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-3813) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3060) |
| 03 · Network Statistics · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-4000) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3247) |
| 04 · Logged Telemetry · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-4229) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3476) |
| 05 · Digital Twin · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-4477) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3722) |
| 06 · Programming · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-4566) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-3811) |
| 07 · Branch Definition · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-4889) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-4134) |
| 08 · Manual · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-5074) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-4319) |
| 09 · Partners · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-6191) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-5436) |
| 10 · Account · 390 | [Baseline](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=20-6342) | [Edit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=24-5587) |

## Local authoring helpers

`tools/figma/preview.py` starts a loopback-only fixture server and exports source DOM geometry. It serves only the local site and fixture operator HTML; website API mutations return 405. Its internal geometry-export endpoint writes generated snapshots locally.

```sh
python3 tools/figma/preview.py --port 4173
```

Open `http://127.0.0.1:4173/capture.html?screens=home,communication&width=1440` to render/export source geometry. Use `width=390` for mobile. Wait for the page's check marks before preparing geometry; Digital Twin assets may take longer.

`tools/figma/prepare.py` compacts exported snapshots for `tools/figma/build-native.js`, which is executed inside Figma's Plugin API wrapper. Use chunks below the MCP's 50,000-character code limit and persist returned IDs between chunks. Treat these as authoring helpers, not production application entry points. Never overwrite the user's revamp frames with a new source export.

`state.json` records the file/session, baseline and working frame IDs, components, and implementation branch. `validation.json` records the final editable-layer/image inventory.

Validation: all 62 mapped screen frames exist; native text/instance counts and image fills were inspected; representative desktop, mobile, modal, editor, shared-control, and start-page renders were reviewed. Helper Python/JavaScript syntax checks pass. The `site/` and `telemetry-bridge/` source trees are unchanged.
