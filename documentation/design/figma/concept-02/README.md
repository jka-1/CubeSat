# KnightEPS — Concept 02: Precision

Proposed second direction for review. The earlier concept is preserved. No production UI, dependencies, telemetry, hardware behavior, security checks, or deployment configuration changed.

## Review

Figma file key: `vxRU2nhe78t1opffNViSv2`.

New page: **07 · Concept 02 — Precision** (`51:2`). Opened in a new connected Figma app tab, with the overview selected and zoom set to 50%. The ordinary external Figma browser URL did not resolve from this session; the connected editor was verified directly by its visible frame name, dimensions, theme and prototype destinations.

| Composition | Node | Local preview |
| --- | --- | --- |
| Desktop overview | `52:9` | [overview.png](overview.png) |
| Run analysis | `52:216` | [analysis.png](analysis.png) |
| Device inspection | `52:374` | [device.png](device.png) |
| Mobile overview | `52:491` | [mobile.png](mobile.png) |
| Chart and interaction standards | `54:18` | [standards.png](standards.png) |
| Function continuity and edit guide | `54:94` | [coverage.png](coverage.png) |
| Retained hero reference | `54:123` | Uses the previously reviewed hero composition |

## Direction

Use a dark mission navigation shell, light analytical surfaces, stronger alignment, and compact Manrope typography. Keep UCF gold for the principal action and selection; use a darker gold trace so it remains readable on white. IBM Plex Mono is reserved for measurements, timestamps and chart ticks. The hero remains the public-facing visual anchor.

The second concept adds clearer plotting discipline:

- Voltage and current have separate scales and explicit units, aligned to the same 60-second UTC domain.
- Three horizontal references and five regular time ticks keep the grid quiet. Traces are 1.8 px, with no decorative area fills.
- Solid voltage and dashed current distinguish quantities beyond color.
- A selected real sample is represented with its exact illustrative timestamp/value, device address and evidence context.
- A separately labelled source boundary is retained across the plots.
- Missing samples break the path; no smoothing or interpolation bridges the gap.
- Mobile displays one selected quantity at a time with two legible endpoint time labels.
- No-packet, stale and inspection templates specify what to show instead of misleading zeros or hidden age.

The review uses synthetic content: 41 expected sample positions, 38 shown, with missing samples at 14:28:45, 46.5 and 48 seconds. The selected sample at 14:28:30 is 15.240 V and 0.510 A. The source boundary is at 14:28:32.400. These are design examples, not observed test results.

## daisyUI relationship

Read the supplied daisyUI 5 skill and its usage, colors, button, tab and table guides. No daisyUI Figma library was attached or found. Native local components therefore follow its semantic theme and control conventions:

- Default and Primary button styles, each with Default, Focus and Disabled states.
- Default, Selected and Focus tabs corresponding to `tabs-box` / `tab` semantics.
- Base surfaces, content, neutral shell and primary action tokens named for daisyUI roles.
- Readable table structure and clear state labels.

This is a native Figma design, not a browser implementation of daisyUI. No framework was installed into the existing site. The proposed semantic CSS variable syntax is recorded in the Figma collection; implementation remains a later task.

## Editability and verification

The operational compositions contain native text, vectors and unlocked frames, with zero raster UI fills. Only the retained hero has its two original user-supplied image assets. Button Label/Style/State properties, tab properties, and a reusable scientific chart component (`55:25`) support reuse. Ordinary screen frames remain directly editable.

Validated desktop, mobile, analysis, device, standards and coverage exports. Added explicit source-boundary annotations after the first review and checked the final affected exports. Structural inspection found zero locked descendants and no detected auto-layout frame overflow in the seven reviewed compositions. Font families are Manrope, IBM Plex Mono and the retained hero's IBM Plex Serif. Construction scripts were parsed without executing their Figma mutations locally.

Prototype links cover Overview → device inspection, Overview ↔ run analysis, and the retained hero CTA → new Overview. Time range controls, export, bridge access, recording and hardware actions remain visual specifications. The function continuity board retains the existing capabilities and backend/operator boundaries for future implementation.

`state.json` contains exact final layer IDs, chart domains, sample-gap evidence and validation results. JavaScript files record construction phases tied to this file/session; do not blindly replay them against a different file. Review was performed in this chat, following the repository restriction on subagents.
