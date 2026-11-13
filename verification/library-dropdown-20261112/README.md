# Saved-definition dropdown verification

The saved-definition selector now contains the reorderable library. The separate Arrange library control is removed. Load remains explicit; selecting or moving an item preserves unfinished editor content. Save is the primary toolbar action, with Duplicate and Delete in the ellipsis popup. Keyboard users can navigate choices with arrows, Home and End, select with Enter, and dismiss with Escape. Reorder arrows retain their existing hover/focus treatment.

Validation used disposable authenticated fixtures on loopback, with no hardware commands or production changes:

- 23 focused Node tests passed (`focused-tests.txt`).
- 23 browser checks passed, including order persistence, stale-version recovery, retry, touch edge scrolling, selection, keyboard navigation and editor preservation (`browser-regressions.txt`).
- Actual editor dragging preserved unfinished name, chosen definition, canvas and pinned revision (`unsaved-editor.json`).
- Desktop, tablet and phone layouts at 1440, 768, 390 and 320 pixels have no horizontal page overflow or selector/Load overlap (`layout-audit.json` and PNGs).
- Actual editor keyboard navigation changes focus without loading; Enter chooses and closes the dropdown. Load then opens the selected revision. Duplicate retains blocks, creates an unsaved copy, closes its popup and returns focus to the ellipsis trigger.
- JavaScript syntax and `git diff --check` passed. Impeccable detector returned no findings (`design-detect.json`); its relative-link warnings refer to the backend view's source location, which the authenticated site resolves correctly.

The prior separate Arrange panel opened in the local fixture; a production root cause was not established. This change removes that separate interaction and versions the affected asset import chain. No new tooltip titles were added, and tooltip documentation was left unchanged. This verification does not establish deployment to the live server.
