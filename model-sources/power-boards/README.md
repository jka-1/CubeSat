# Supplied power-board replacements

Copied locally from the two files explicitly supplied on 11 November 2026.
No external upload, decimation, quantization, texture resizing or nonuniform scaling.

| Integration ID | Original path | SHA-256 |
| --- | --- | --- |
| `BMS_BQ76942` | `/Users/itzjaclechtman/Downloads/Knight_EPS_BMS_Final_green.glb` | `19157890e571f6dc2b74fff6eea2dc763ac4936c0612e53cda3ce80f8ff53145` |
| `Charger_BMS034A_EVM` | `/Users/itzjaclechtman/Downloads/Knight_EPS_MPPT_High_Fidelity_Gerber_v4.glb` | `ca9d409e9b038669eaef278d4e0ecd4fb3e41a0667d531ff192458be4e378613` |

The MPPT top artwork explicitly reads BMS034A / BQ25798EVM. Its 88.9 × 88.9 mm
substrate, connector layout and CAD axes match the previous MPPT. The other
supplied file has the battery-management layout (BAT+/BAT−, PACK+, CHG/DSG,
cell-sense header), matching the existing user-confirmed BQ76942 CAD outline
and component envelopes. The file itself does not establish an independently
verified chip marking; identity relies on the supplied pair and existing CAD.

Both files use millimeter coordinates, with populated component sides +Z.
Both have indexed geometry, flat scene transforms, no supplied NORMAL attributes,
and two multicolor PNGs. Their original topology generates the missing normals;
future supplied normals are transformed rather than recomputed. Materials,
PNG bytes and UVs are retained. New multicolor artwork uses the embedded RGBA
path on modern and older browsers; it is not converted to constant-color R8.

MPPT: source substrate [0,0,−1.5595599413] to [88.9000015259,88.9000015259,0] mm;
uniform .001 scaling and local translation
[−.04395015165,−.04112153128,−.00322057074] m retain its existing underside,
XY datums and connector direction. 117,816 triangles, 475 source draws → 34.

BMS: source substrate [−5.0799999237,−5.0799999237,−1.5849599838] to
[64.7699966431,58.4199981689,0] mm; uniform .001 scaling and translation
[−.03330040314794,−.02667,−.002468798309565] m reproduce the old blue
substrate's local bounds, including underside Z = −.004053758457303047 m.
Its original populated component envelope and orientation remain seated at the
same support. 32,036 triangles, 178 source draws → 23. No fixtures are moved
for either replacement; historical regulator corrections remain unchanged.

Run `node scripts/build-detailed-twin.mjs`, then
`python3 scripts/build-display-twin.py`. Set `KNIGHT_TWIN_OUTPUT` to a staging
directory for the canonical build. Source hashes are checked before import.

The recoverable pre-change package is
`verification/twin-replacements-20261111/baseline-assets.tgz`.
`staged-audit.json` records byte-exact geometry/material preservation for the
other 93 components and unchanged transforms for all 95 physical components.
Physical mounting fit remains illustrative, as in the existing manifest.
