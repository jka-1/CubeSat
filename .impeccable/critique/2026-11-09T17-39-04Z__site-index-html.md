---
target: Review these button placements
total_score: 26
max_score: 32
na_heuristics: 9,10
p0_count: 0
p1_count: 0
target_identity: "file:/Users/itzjaclechtman/Documents/Senior Design/CubeSat-telemetry-baseline/site/index.html"
target_fingerprint: "sha256:f6158d4006a5f76f898fd378775b888fca31015fffb01716814d9883de6d0e20"
target_path: /Users/itzjaclechtman/Documents/Senior Design/CubeSat-telemetry-baseline/site/index.html
timestamp: 2026-11-09T17-39-04Z
slug: site-index-html
---
Method: dual-agent (A: placement_design · B: placement_evidence)

The placements work well overall. Keep the desktop grouping and focus the next refinement on mobile tab discovery. The two navigation levels fit the engineering console and clearly separate site/account navigation from telemetry sections.

Strengths: Home, Dashboard, and Sign in share aligned 44px targets. Primary controls are viewport-centered at 320px and 390px, without overflow. Dashboard and the current dashboard section both expose their active state and aria-current.

Priority issues:
1. P2 — Hidden mobile tabs lack a clear scroll cue. At 390px, the section strip is 648px wide inside a 390px viewport. Logged Telemetry starts at x334.9; Digital Twin at x511.5. Add an overflow indicator and ensure the selected section is revealed. Keyboard Tab successfully scrolls the strip, so discoverability rather than reachability is the problem.
2. P3 — Secondary targets are 40.5px high versus 44px primary targets. Set a consistent 44px minimum for dashboard links. This is a consistency refinement, not a claim of WCAG failure.

Minor observation: desktop primary controls are centered in the remaining space beside the brand, not the viewport. At 1280px, primary midpoint814.25 differs from viewport/subnav midpoint640. The desktop composition is balanced, but it does not use a shared center line.

| # | Navigation heuristic | Score / 4 |
|---|---|---:|
|1|Visibility of system status|3|
|2|Match with real world|4|
|3|User control and freedom|4|
|4|Consistency and standards|3|
|5|Error prevention|3|
|6|Recognition rather than recall|3|
|7|Flexibility and efficiency|3|
|8|Aesthetic and minimalist design|3|
|9|Error recovery|n/a — not assessed in placement scope|
|10|Help/documentation|n/a — outside placement scope|
|Total||26/32 — Good|

Cognitive load: three primary controls and four viewer destinations are manageable as separate groups. Seven operator sections warrant better scrolling cues rather than immediate menu restructuring.

Emotional journey: desktop is organized and predictable. Hidden destinations introduce uncertainty on mobile.

Persona notes: power users benefit from stable ordering and direct destinations. Mobile users may miss Digital Twin. Keyboard users can reach and scroll to offscreen sections; current-page semantics are present.

Detector evidence: 2 advisories, no placement findings. Hairline border with wide shadow concerns the existing brand glow. Decorative grid background concerns an actual I2C schematic surface, making that contextual interpretation questionable. Neither warrants expanding the requested placement review.

Design question to consider: should the primary and secondary navigation share the viewport center line, or should the current brand-balanced desktop grouping remain?
