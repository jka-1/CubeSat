# Floor, loading and concurrency follow-up

11 November 2026. Local implementation only; no deployment, production
configuration, backend, security, telemetry or canonical CAD changes.

The ground now uses an opaque matte Lambert material with a dim emissive
base. It receives existing Studio shadows and stays visible in Performance.
No reflection pass, larger shadow map or physical floor shader was added.
Desktop and mobile captures are `results/loading-after-final.png` and
`results/loading-mobile.png`; layout and original CAD are preserved.

## Loading

The default modern-browser transfer is now the static gzip derivative:
34,590,388 → 8,075,595 bytes, 76.7% less model data. Decompressed bytes are
identical to the existing certified GLB. Original GLB/RGBA delivery remains
available to browsers without DecompressionStream. The decoder accepts
both gzip bytes and transparent HTTP decoding. The normal build emits and
hashes the additional file; the deployment file list includes it.

Model and full-resolution artwork preparation overlap. SHA verification,
shader precompilation, initial bindings and the full Studio first frame are
retained. `performance().loading` exposes stage timings for future reports.

With HTTP cache disabled, simulated 20 Mbps download and 40 ms latency on the
same Intel Iris Plus 655 machine/Chrome profile:

| Stage / result | Before | Final |
|---|---:|---:|
| Navigation to ready | 18.42 s | 6.77 s |
| Model download | 14.48 s | 3.92 s |
| First new floor shader run, navigation to ready | — | 8.30 s |

These are bounded individual runs on the local server. GPU driver shader
caches were not cleared. Network simulation does not emulate every older
phone CPU or production server. The mobile check tests layout/loading on
the same hardware, not performance on a separate phone.

## Concurrent viewers

Nine independent authenticated viewer sessions connected to an isolated real
bridge on loopback. Every connection received status fanout at nine active
viewers; closing three delivered the six-viewer status to all remaining
viewers; closing all returned the bridge to zero streams. No hardware or
production traffic was sent. A separate nine-way local static download burst
returned nine valid compressed files (72,680,355 bytes total).

The renderer runs per client. The dashboard uses its shared EventSource and
forwards readings into the iframe, so opening the twin does not add another
telemetry stream within that page. Existing server code broadcasts to a Set
of responses and removes closed connections. Nothing in these paths imposes
a three- or nine-viewer limit. Normal broadcast capacity looks sufficient
for the requested group; the test is not a production Apache/proxy/uplink
capacity measurement, and does not test sustained slow-reader backpressure.

Nine simultaneous first model downloads now total 72.7 MB, previously
311.3 MB. Transfer-only lower bounds are 5.8 s through a shared 100 Mbps
bottleneck or 29.1 s through a shared 20 Mbps bottleneck; scripts/artwork,
device preparation and protocol overhead add time. Shared Wi-Fi/server
bandwidth can therefore still delay simultaneous first visits.

## Bounded verification

27 focused tests passed, including complete gzip/HTTP-decoded model equality,
truncation rejection, canonical geometry/artwork proof and telemetry adapter
checks. Build script parsing and deployment shell syntax passed. Browser
qualification passed selection, depth/interior fallbacks, actual Studio
shadow-shader restoration, resize, disposal and reload without errors.

One short timer-driven workload covered orbit (30 s), lid (15 s), and
explosion (15 s), including the full floor, shadows, acrylic and FXAA:

| Phase | Valid GPU queries | GPU median | GPU p95 |
| orbit | 450 | 7.88 ms | 8.35 ms |
| lid | 225 | 8.57 ms | 9.77 ms |
| explosion | 225 | 9.14 ms | 10.89 ms |

All phases stayed inside the existing 14 ms GPU headroom gate; no disjoint
queries or new shader programs appeared during those phases. One final lid
query was unresolved at the phase boundary and was excluded. This short
check is not a new five-minute thermal qualification, and timer-driven
capacity is not native 60 Hz presentation proof. The 60 fps design target
is unchanged.

Machine-readable evidence is in `results/loading-floor-summary.json`,
`results/loading-*.json`, `results/concurrent-*.json`,
`results/production-qualify.json`, `results/production-timer60-clock-load60.json`
and `results/loading-focused-tests.txt`. The earlier five-minute thermal
results and original integration provenance describe the preceding shadow
catcher version. `loading-floor-provenance.json` identifies this follow-up.
