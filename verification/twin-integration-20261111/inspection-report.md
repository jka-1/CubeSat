# Continuous ground and inspection

11 November 2026. Implemented locally; not deployed. Layout, canonical CAD,
lossless display package, telemetry and production configuration are preserved.

## Behavior

- The constant environment backdrop and separate front-sided shadow receiver
  produce a continuous expanse at every zoom and orbit angle. Underneath,
  ground shadows disappear and the same backdrop stays in place. The receiver
  has no opaque face or visible edge; no enlarged plane or render pass is used.
- Canvas and list double-click focus the picked item; single-click selects.
  Empty double-clicks and drags do not initiate focus.
- All 20 payload members resolve to one logical Payload entry, including its
  case, board, LCD, screws and spacers. Selection/highlighting, isolation,
  visibility, framing and orbit share that ownership. Original member IDs
  remain accepted as aliases. The dedicated LCD binding is unchanged.
- PCBs face the camera head-on from their component side, including the sensor
  as its lid opens. Batteries approach from outside the holder. Transitions
  arc around the target instead of crossing the object in a straight line.
- Focus temporarily fades actual intervening parts. Clips leave their opaque
  instance batch while faded, then return. Fit/reset or selecting another part
  restores context without changing visibility or the explicit x-ray setting.
- Reset assembly now waits for geometry to settle before fitting isometric;
  its pending fit previously cancelled its own camera transition.

Autodesk's [viewer settings](https://help.autodesk.com/cloudhelp/ENU/ADSKVIEWER-Help/files/AutodeskViewerTools/ADSKVIEWER_Help_AutodeskViewerTools_ViewerSettings_html.html)
document separate environment backgrounds/ground shadows and composite object
selection. Those concepts informed this implementation; no proprietary viewer
code was imported.

## Bounded validation

31 focused tests passed. After finding a focus-ghost interaction with fixture
instancing during review, only the three affected fixture/render optimization
tests were rerun; all passed. Browser qualification passed quality/shadow and
depth restoration, resize, cleanup and reload. A targeted real-browser check
also confirmed the ghosted BMS clip renders transparently as its own object,
leaves its opaque batch, and returns to the full 26-member batch afterward.

19 inspection browser assertions passed, including native pointer
single/double clicks, empty double-click, native payload picking, all 20
payload aliases, complete payload isolation/visibility, all seven PCB face
normals and picking, moving-lid focus, outside battery focus, restoration,
isometric reset and mobile overflow. Head-on direction agreement exceeded
0.9999 for every PCB. Focus computation took 3.6–15.6 ms in this run;
this excludes later image submission and is not an animation frame budget.

The single 10-second timer-driven orbit regression had 150 valid GPU queries,
8.01 ms median and 8.52 ms p95, with no disjoint
queries or new programs during the recorded orbit. It is capacity evidence on
the existing Intel Iris Plus 655 / 1910×1440 drawing buffer, not native 60 Hz
presentation proof or a new thermal qualification. No broad sustained workload
or production load test was repeated for these interaction changes.

Screenshots: `results/inspection-floor-above.png`, `inspection-floor-far.png`,
`inspection-floor-under.png`, `inspection-MCU_Final.png`,
`inspection-Regulator_01.png`, `inspection-battery.png`, `inspection-payload.png`
and `inspection-mobile.png`. Numerical results are in
`results/inspection-summary.json`; full browser logs in
`results/production-inspection.json`, `production-fixture-focus.json`,
`production-qualify.json`, and `production-timer60-clock-screen60.json`.
Unit results are `inspection-focused-tests.txt` and `inspection-fixture-tests.txt`.

Earlier floor/loading reports describe the preceding finite Lambert floor.
The compressed assets and telemetry server are unchanged from that follow-up;
its network/concurrency findings remain historical evidence for those paths.
