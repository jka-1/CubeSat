---
"name": "KnightEPS / Orbital Address"
"description": "Project storytelling and a protected CubeSat electrical-power instrument interface."
"colors":
  "graphite": "#0d1113"
  "ink": "#15191f"
  "muted": "#4c5664"
  "paper": "#f4f4f3"
  "surface": "#fff"
  "hairline": "#dce0e6"
  "selection-amber": "#a95c00"
  "film-amber": "#f2a33a"
  "selected-surface": "#fff4e4"
  "selected-ink": "#744400"
  "success": "#21724a"
  "warning": "#805e00"
  "danger": "#b32d27"
"typography":
  "display":
    "fontFamily": "Barlow Condensed, sans-serif"
    "fontSize": "clamp(78px,13vw,190px)"
    "fontWeight": 700
    "lineHeight": 0.95
    "letterSpacing": "-.03em"
  "headline":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "clamp(44px,5.55vw,80px)"
    "fontWeight": 800
    "lineHeight": 1.08
    "letterSpacing": "-.03em"
  "page-title":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "30px"
    "fontWeight": 800
    "lineHeight": 1.2
    "letterSpacing": "-.03em"
  "panel-title":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "16px"
    "fontWeight": 800
    "letterSpacing": "-.01em"
  "body":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "14px"
    "lineHeight": 1.55
  "button":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "14px"
    "fontWeight": 700
    "lineHeight": 1.4
  "navigation":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "13px"
    "fontWeight": 600
    "lineHeight": 1.4
  "field":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "17px"
  "measurement":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "clamp(20px,2.2vw,30px)"
    "fontWeight": 500
    "lineHeight": 1.2
    "letterSpacing": "-.03em"
  "product-identity":
    "fontFamily": "Manrope, sans-serif"
    "fontSize": "17px"
    "fontWeight": 700
    "lineHeight": 1.2
    "letterSpacing": "-.02em"
"rounded":
  "control": "4px"
  "field": "5px"
  "navigation": "6px"
  "table": "8px"
  "instrument": "10px"
  "container": "12px"
"spacing":
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "22": "22px"
  "24": "24px"
  "32": "32px"
  "40": "40px"
"components":
  "button-primary":
    "backgroundColor": "{colors.ink}"
    "textColor": "{colors.surface}"
    "typography": "{typography.button}"
    "rounded": "{rounded.control}"
    "padding": "11px 18px"
  "button-secondary":
    "backgroundColor": "{colors.surface}"
    "textColor": "{colors.ink}"
    "typography": "{typography.button}"
    "rounded": "{rounded.control}"
    "padding": "11px 18px"
  "public-input":
    "backgroundColor": "{colors.surface}"
    "textColor": "{colors.graphite}"
    "typography": "{typography.field}"
    "rounded": "{rounded.control}"
    "padding": "16px 18px"
    "height": "60px"
  "dashboard-navigation-active":
    "backgroundColor": "{colors.selected-surface}"
    "textColor": "{colors.selected-ink}"
    "typography": "{typography.navigation}"
    "rounded": "{rounded.navigation}"
    "padding": "12px"
  "status-chip":
    "textColor": "{colors.muted}"
    "rounded": "{rounded.field}"
  "instrument-panel":
    "backgroundColor": "{colors.surface}"
    "textColor": "{colors.ink}"
    "rounded": "{rounded.instrument}"
    "padding": "22px"
  "measurement-summary":
    "backgroundColor": "{colors.surface}"
    "textColor": "{colors.ink}"
    "typography": "{typography.measurement}"
    "rounded": "{rounded.instrument}"
    "padding": "20px"
  "mode-option":
    "textColor": "{colors.muted}"
    "rounded": "{rounded.control}"
    "padding": "8px 16px"
---

# Design System: KnightEPS / Orbital Address

## Overview

**Creative North Star: "KnightEPS / Orbital Address"**

The supplied KnightEPS public pages and Orbital Address telemetry kit establish one engineering identity with two working densities. Public pages use broad paper and graphite fields, condensed identity lettering, real project photography and the supplied orbit-to-workbench film. Protected instrument pages default to dark, bordered surfaces with a light option, compact Manrope labels and monospaced measurements.

This is a code-led extraction of the implemented, user-pinned visual world. The palette, local fonts and material choices come from the supplied references and finished source. Route-specific composition, hero timing and preservation promises live in the surface briefs; they are not universal component rules.

**Key Characteristics:**
- Paper and graphite public fields. Cool graphite dashboard instruments with a light option.
- Barlow Condensed identity, Manrope interface, Manrope evidence and a Manrope product wordmark.
- Flat bordered instruments with restrained amber selection and explicit status text.
- Native scrolling, keyboard focus and a system reduced-motion alternative to the film.

Extracted from `site/assets/css/overhaul.css`, `dashboard.css`, `fonts.css`, `hero.css` and `twin-chrome.css`, with components sampled from `site/index.html`, `site/modules/communication.html`, `site/modules/contact.html`, `site/modules/runs.html` and `site/assets/js/telemetry-overview.mjs`. Frontmatter is normative; the sidecar supplies runnable component specimens and non-frontmatter extensions. No browser-computed style or generated-comp match is claimed by this extraction.

## Colors

### Primary

Selection Amber marks charts, focus, selected detail and inspection affordances. Film Amber marks the supplied sequence's progress and light accents. The primary filled control uses Ink with Surface text, matching the implemented daisyUI theme.

### Neutral

Paper is the public page ground. Surface is the public form and light dashboard instrument ground. The dashboard defaults to dark: canvas #0c0e12, instrument #14181f, raised control #1d242e, divider #343e4c, ink #f1f3f6, muted text #b0bdcc and action #f2a33a. Dashboard appearance is saved through the sidebar account. Graphite anchors public identity fields and the access-page statement. Ink carries instrument text, Muted supports secondary labels, and Hairline divides white surfaces. Selected Surface and Selected Ink identify the current dashboard destination.

Success, Warning and Danger are semantic states, paired with visible labels. These are not additional brand accents. The dark digital-twin viewport remains its own existing material; its surrounding controls use this light instrument system.

**The Instrument Ground Rule.** Use white surfaces and hairline borders to group working data; reserve graphite fields for the public identity and existing twin viewport.

## Typography

Both families ship locally with `font-display: swap`. Barlow Condensed supplies the compressed KnightEPS wordmark, hero identity and access statement. Manrope carries interface and public editorial text. Manrope carries measurements and packet evidence.

The frontmatter records the implemented desktop hierarchy: cinematic display, public headline, dashboard page title, panel title, body, button, navigation, public field, measurement and product identity. Public navigation uses uppercase Manrope (12px, weight 800); dashboard navigation uses sentence case. The hero display changes to `clamp(68px,17vw,120px)` at the mobile breakpoint, while public text and access statements use their own responsive sizes.

**The Identity and Evidence Rule.** Use the condensed public identity and Manrope product wordmark in their established roles; use Manrope for interface text and Manrope for measurement and packet evidence.

## Layout

Public content uses broad section spacing and 40px desktop edges, becoming 20px on phones. The public navigation reaches 1760px; footer content reaches 1680px. Public access forms use a split statement/form composition, then stack below 720px.

The dashboard has a 76px header and 232px fixed destination rail that collapses to 74px on wide screens, with content padding `32px clamp(20px,2.5vw,44px) 72px`. Below 1000px, the destination rail becomes a horizontal scrollable navigation row and content takes the full width. Below 720px, dashboard edges become 16px. Simple is the interactive bus. Advanced begins with a chart-free subsystem readout that changes from four columns to two below 1300px and to one below 550px. The chart and cell workbench stack below 1200px. Packet evidence is in a disclosure.

Instrument gaps commonly use 16px or 24px. Panels use 22px padding, summaries and device cards 20px; mobile panel padding becomes 18px. Most actionable controls have a minimum height of 44px; the compact detail-level switch and chart selects use 38px. Tables, raw packets and long lists retain bounded scrolling instead of compressing evidence into unreadable fragments. These measurements describe the implemented surfaces, not a requirement to copy every page's grid.

## Elevation & Depth

Working cards are flat with white fill and a hairline border. The detail dialog uses `0 24px 80px #15191f35`; dark tooltips use `0 6px 24px #15191f22`. The twin's mobile sidebar uses `-12px 0 32px #15191f1f`. The unchanged 3D model supplies the depth inside the twin viewport. The supplied hero has cinematic veiling and a vignette; these are film-specific treatments.

**The Flat Instrument Rule.** Working cards rest flat. Reserve the documented shadows for overlays and tooltips.

## Shapes

Controls have small, deliberate corners; instruments have softer, bounded corners. The frontmatter distinguishes 4px public controls, 5px dashboard fields, 6px navigation, 8px tables, 10px overview instruments, and 12px shared cards/dialogs. Most grouping uses 1px borders. Avoid treating legacy variable names such as `--gold` or `--black-card` as an instruction to restore the old identity: the active theme aliases resolve to the selected dashboard appearance.

## Components

### Buttons

Primary buttons use Ink, Surface text, a 1px matching border, control corners and `11px 18px` padding; secondary buttons use Surface, Ink and Hairline. Hover changes the primary background to `#343d46` and lifts it 1px; active presses it down 1px. Disabled buttons use half opacity and no translation. Focus is an amber 2px outline with a 4px offset. The transition is 0.18s for background and transform.

### Chips

Status chips are compact, bordered and softly squared. Neutral chips use muted text; online/live uses Success on a pale green field; offline/stale uses Warning on pale amber. Status text remains explicit and live indicators do not pulse. A chip specimen is informational, not an invented action.

### Cards / Containers

Overview panels use instrument corners and 22px padding; measurement summaries use 20px. Shared run, sequence and streaming containers use container corners and hairline borders with no resting shadow. Panel titles use the panel-title hierarchy. Measurement summaries include both the value and its source; the unavailable state is a valid specimen.

### Inputs / Fields

Public account/contact inputs are 60px high with `16px 18px` padding, a `#9ca7a7` border and control corners. Contact textarea height is 120px and remains vertically resizable. Dashboard fields use a `#b5bdc6` border, field corners, 13px text and at least 44px height. The shared amber focus treatment remains visible. Contact validation and account errors remain adjacent textual feedback.

### Navigation

Public links are restrained uppercase text with an underline on hover/current route. The dashboard's destination links use navigation corners, sentence case, at least 46px height and amber-tinted selected fill/border. Hover uses a cool neutral field. On small screens, destinations scroll horizontally and retain their labels. The product header separates the Orbital Address identity, and return-to-project action. The signed-in account and appearance settings are at the foot of the sidebar.

### Telemetry detail switch

The Simple/Advanced switch is a compact segmented group: neutral tray, white selected segment, small control corners and `aria-pressed` state. It reveals progressively denser views of the same packet stream. The sidecar specimen previews appearance and control semantics; it does not run the product's telemetry or routing logic.

## Do's and Don'ts

### Do:
- **Do** preserve the supplied paper/graphite fields, local font roles, project photography and original hero film.
- **Do** keep measurement units, missing values, source labels and keyboard focus legible on the light instrument ground.
- **Do** use active navigation, status text and semantic control states together with color.
- **Do** keep wide evidence tables and plots readable through their implemented scroll containers.

### Don't:
- **Don't** restore the superseded black-and-gold PMDS identity as the default for new surfaces.
- **Don't** turn gate-drive input selection into a measured-flow claim or a four-cell sum into a measured PACK pin claim.
- **Don't** apply the public cinematic stage to ordinary instrument pages or replace the existing twin viewport with a new visual scene.
- **Don't** require motion to reach public content or inspect telemetry.
