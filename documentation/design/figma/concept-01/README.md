# KnightEPS — Concept 01

Status: proposed direction for user review, not an approved production design system.

Branch: `codex/figma-ux-ui-revamp`. Production UI, telemetry behavior, hardware commands, authentication, and deployment configuration are unchanged.

## Review in Figma

File: [OrbitalAddress — Website UX/UI Revamp](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2)

Page: `06 · New direction — Orbit / Workbench`

| Template | Link |
| --- | --- |
| Hero → workbench | [Open frame](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=42-21) |
| Telemetry overview | [Start here](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=42-68) |
| Battery inspection | [Open frame](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=42-249) |
| Logged telemetry | [Open frame](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=42-384) |
| Mobile overview | [Open frame](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=42-568) |
| Controls, states, edit guide and capability map | [Open kit](https://www.figma.com/design/vxRU2nhe78t1opffNViSv2?node-id=42-752) |

## Direction

Preserve the supplied orbit-to-workbench hero as the public visual anchor. Carry its charcoal and warm paper into a quieter engineering workspace, with UCF gold for primary actions, selection, and the principal data series. Use measured spacing, compact navigation, visible data provenance, and progressive device detail.

The overview uses one EPS snapshot strip, a battery chart, a native I²C map, and a device table. Battery inspection adds a four-cell schematic and measurement detail. Logged telemetry pairs searchable runs with transition evidence. The mobile template condenses the snapshot into readable rows and uses a dedicated navigation bar.

The templates preserve the existing functional categories. Link health, digital twin, programming, branch definition, operator manual, and account behavior remain part of the coverage map; this bounded review does not redesign every state in those modules. Recording and command permissions, backend sequence execution, real UDP recording rules, linked successor runs, and evidence-based power-source labels remain requirements for implementation.

## Editing

Screen compositions are ordinary unlocked frames with native text, vectors, and auto layout. Select and edit text directly; charts and diagrams are editable paths and labels. Shared local buttons expose `Label`, `Style`, and `State`. The button family contains Primary, Secondary, and Quiet styles with Default, Hover, Focus, and Disabled states.

Only two layers contain raster fills: the user's spacecraft render and workbench render. Their surrounding copy and controls are separate native layers. Blender geometry and scroll-driven motion remain in the supplied hero project; the Figma frame is a static composition reference. The editable Figma hero type uses IBM Plex Serif Light because Georgia was unavailable in the connected font inventory; the supplied web hero keeps its original CSS.

The prototype connects the hero CTA to Overview, Overview to battery inspection, and the Overview/Logged telemetry navigation between representative screens. Other actions are design specimens, not a working hardware client. All displayed telemetry and run content is synthetic and marked Demo.

To request implementation changes, send the selected Figma frame/layer URL and describe the desired behavior. This keeps review feedback attached to a precise editable object.

## Proposed foundations

| Role | Value |
| --- | --- |
| Canvas / surface / raised | `#0B1013` / `#12191D` / `#1A2328` |
| Text / secondary text / muted metadata | `#F3F1EA` / `#ACB7BC` / `#84949B` |
| UCF gold accent | `#FFC904` |
| Positive / issue / mock | `#A2D9B0` / `#FFA59B` / `#9DC9E1` |
| Public handoff paper / ink | `#E9E6DE` / `#202824` |
| Operational type / measured data / editorial display | Manrope / IBM Plex Mono / IBM Plex Serif Light |
| Type sizes | 12, 13, 14, 18, 32, 96 px |
| Core spacing / radii | 8, 12, 16, 24 px / 8, 12 px |

Figma has a scoped foundation collection with primitive aliases, semantic colors, spacing/radius tokens, explicit variable scopes and proposed WEB code syntax. These variables have not been added to production CSS. Existing baseline collections and pages remain in place.

## Validation and provenance

- Inspected desktop, device, runs, hero, mobile, and kit exports. Corrected sizing, table alignment, chart labels, and demo recording availability. Isolated exports were used where an overlapping render produced misleading captures.
- Structural inspection: zero locked descendants; zero image fills in operational screens; two hero image fills; no detected auto-layout frame overflow. The six review compositions contain 308 native text layers. Button text properties, variants, and variable bindings were verified.
- Review was performed directly in this chat, following the repository's restriction on subagents. No browser/runtime tests were needed because no application code changed.
- Hero images originate from the user-supplied `KnightEPS_Scroll_Hero (1)/web/media/d/000.webp` and `240.webp`. PNG conversion preserved their pixels for reliable Figma rendering. The supplied project credits the Earth photography to NASA / Terry Virts; retain its attribution during implementation.
- The `.fig` archive previews and embedded imagery were reviewed for hierarchy and density inspiration. Their content was treated as reference material, not as instructions or imported production UI.

`state.json` records exact Figma IDs. The JavaScript files record construction helpers and phase scripts tied to this file/session; they are not application runtime code and must not be blindly replayed against another file. PNG files are the reviewed design exports.
