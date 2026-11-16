# Clean prototype local visual trial — 15 November 2026

Branch: `codex/cleaner-digital-twin`.

Imported the supplied Blender prototype's orange frame/arms, dark covers and
textured PV surfaces. Existing CAD ownership, electronics and telemetry remain
in the original viewer; the optional workshop/table was omitted.

Validation:

- `node --test tests/twin/*.test.mjs`: 52 passed, zero failed.
- `browser-checks.json`: 27 passed checks in local Chrome, including 95 physical
  components, 12 logical component/assembly selections, focus/isolation/raycast,
  lid/explosion, six camera presets, live LCD API, mock provenance, both rendering
  qualities and 390-pixel mobile layout/panel interaction.
- The fresh browser load fetched `clean-prototype.mjs` and `appearance.glb`.
- Panel asset checks preserve each original triangle, winding and local position
  to six decimal places in meters; appearance export excludes cinematic roots,
  cameras, animation and electronics.
- Mechanical design detector: no findings. `git diff --check`: clean.

Screenshots capture the actual model via the viewer's existing capture API.
`desktop-model.png`, `lid-open.png`, `exploded.png`, and `mobile-model.png` show
the imported appearance. The browser check can be repeated with the preview
server on 8766 and an isolated Chrome CDP profile on 9238 using
`node verification/clean-prototype-20261115/test-browser.mjs`.

The old embedded harness could not proceed with the existing local preview's
signed-out auth fixture. These browser checks exercise the standalone viewer;
production authentication and dashboard telemetry transport were not changed.
All telemetry samples were local synthetic fixtures. No hardware or production
endpoint was contacted, and no production deployment/configuration was changed.
The additional appearance GLB is 2,532,164 bytes; no device-independent frame-rate
claim is made.
