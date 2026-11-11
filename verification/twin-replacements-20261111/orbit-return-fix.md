# Floor-board orbit return correction

11 November 2026. Local only; nothing deployed.

The previous return moved the target back to the chassis while retaining the
PCB inspection camera-up vector. Floor PCB focus points nearly along world Y;
keeping its inspection up vector made the subsequent assembly orbit unstable.
The prior browser assertions checked target/distance but did not drag afterward.

The shared return now restores world Y-up. Within five degrees of a vertical
view, it eases to that small clearance using the inspection's screen-up heading,
preserving camera distance. Other angles retain their existing offset. Both the
animated and reduced-motion paths use the same pose. Isolation is unchanged.
No model, rendering loop, geometry, quality or telemetry code was changed.

Changed: `viewer/main.mjs`, `viewer/inspection.mjs`, entry-point cache version,
`tests/twin/inspection.test.mjs`, targeted browser driver and rendering docs.

Validation:
- Seven inspection tests pass, including positive/negative vertical views,
  different inspection headings, nonsingular transitions, unchanged distance
  and ordinary camera angles.
- The targeted browser test passed focus → empty-canvas deselection → native
  drag for INA226, both regulators, BMS, MPPT, MCU, battery pack and payload.
  Each returned to the chassis with world Y-up; subsequent drags changed the
  camera orientation without roll or pivot movement.
- Two isolation checks retain local camera-up, target and visibility.
- Syntax and diff whitespace checks pass. No renderer errors.

Evidence: `../twin-integration-20261111/results/replacement-production-orbit-return.json`.
The earlier failed assertion is retained in `orbit-return-before.json`.
Normal preview is left open without instrumentation.
