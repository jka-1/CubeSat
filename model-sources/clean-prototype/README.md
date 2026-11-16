# Clean prototype appearance

Local visual trial on `codex/cleaner-digital-twin`, using the user-supplied
`KnightEPS_Orbit_to_Workbench.blend` (source hash is recorded beside the export).
The original Blender file is not modified or committed.

The branch imports the prototype's orange chassis/arms, graphite covers and
textured photovoltaic faces, laminate edges and backing. The cinematic flight
concept and workshop/table are excluded. Electronics, battery, fixtures, live
LCD, component IDs, transforms, ownership and all existing controls remain in
the original viewer. Only solar panel vertex buffers are exchanged to carry
UVs and material groups; their 92 triangles per panel preserve original local
positions and winding to six decimal places in meters.

The additional GLB is approximately 2.4 MiB. It loads alongside the existing
certified display package. Its panels use conservative double-sided rendering;
the original certificate continues to apply only to unchanged geometry.

Rebuild with Blender 4.5 LTS, from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --disable-autoexec \
  '/path/to/KnightEPS_Orbit_to_Workbench.blend' \
  --python scripts/export-clean-prototype.py -- \
  "$PWD/site/knight-eps-phase12/models/clean-prototype/appearance.glb"
```

Local preview (loopback only; telemetry endpoints unavailable):

```sh
python3 tests/twin/preview.py
```

Open the standalone viewer at
<http://127.0.0.1:8766/site/knight-eps-phase12/viewer/>. The dashboard shell
retains its existing sign-in requirement. Use the existing
**Mock demonstration** option for synthetic data. No production configuration
or hardware communication is changed.

Deployment uses `bash scripts/deploy-clean-prototype.sh --check` followed by
`bash scripts/deploy-clean-prototype.sh` from a committed release checkout on
the droplet. It backs up and installs only the appearance GLB/provenance and
two rendering modules, refuses unexpected live loader changes, and rolls back
on a failed postcheck. It does not restart the bridge.
