---
type: session
date: 2026-06-19-1727
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-19-gotcha-19-set-option-value-shape-per-column-kind]]"
---

# Dropdown + People cell editors — trailing Clear affordance

## What changed

- `src/components/boards/cells/editors/index.tsx`: extracted a shared `ClearButton`
  from the inline button `StatusEditor` already had, and reused it across all three
  popover selector editors.
- `DropdownEditor` (multi-select) and `PeopleEditor` now render an explicit trailing
  **Clear** at the end of the popover — previously they only cleared implicitly by
  deselecting every option/member. Clear routes through `onClear` (deletes the cell
  value), falling back to dismiss when unwired — same contract as Status.
- `editors.test.tsx`: added a "Clear button routes through onClear" case for both
  Dropdown and People (mirrors the existing Status test).
- Gate green: `pnpm test` (647), `typecheck`, `lint`. Commit `04341e8`.

## Why

Housekeeping consistency: the Status column exposed an explicit Clear button but the
other dropdown-style columns didn't, so clearing them was an undiscoverable
deselect-all gesture. Now every selector column clears the same way.

## Open threads

- Not yet user-verified live (small UI change; covered by unit tests).

## Next session entry point

Back to the main roadmap: Phase 6 (ClickUp depth) — the Phase 6a subitems spec + plan
already exist in `docs/superpowers/`. Start there.
