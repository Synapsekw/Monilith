---
type: session
date: 2026-06-21-1946
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-19-1018-name-column-resize-autofit]]"
  - "[[2026-06-21-gotcha-33-drag-width-must-be-int]]"
---

# Name column resize snap-back fix

## What changed

- **Bug**: dragging the Table **Name** column to a new width snapped it back to
  auto-fit on release. Configurable columns looked fine but silently never
  persisted (reverted on reload).
- **Root cause**: both resize handlers computed `startW + (clientX - startX)`
  with no rounding. Under browser zoom / fractional display scaling `clientX` is
  sub-pixel → fractional width → the resize server actions' `z.number().int()`
  rejected it → mutation threw → `onError` rolled back the optimistic cache.
  Name reveals it (clears live width on release → falls to auto-fit); the
  configurable columns mask it (keep `liveWidths`). See
  [[2026-06-21-gotcha-33-drag-width-must-be-int]].
- **Fix**: new pure `clampDragWidth(value, min, max)` (round + clamp) in
  `src/lib/boards/name-column-width.ts`, used in `NameColumnHeader`
  (`BoardTable.tsx`) and `ColumnHeader.tsx`. Fixes the visible Name bug and the
  latent configurable-column persist bug.
- Commit `6a4dac0` on `develop` (pushed). Gate green: typecheck / lint /
  **821 tests** (new `clampDragWidth` cases) / build (run in main checkout).
- Investigation only — confirmed DB column + check constraint exist and the
  owner passes the `can_edit_board` RLS check, ruling out schema/permission.

## Why

The Name column auto-fit + resize feature ([[2026-06-19-1018-name-column-resize-autofit]])
was user-verified, but the client never satisfied the server's integer contract,
so any sub-pixel pointer environment (zoomed Retina) broke persistence.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev` locally (develop does not deploy to prod).
2. Open any board in **Table** view.
3. Drag the right edge of the **Name** column and release → it stays resized.
4. Reload → the Name width persists.
5. Resize a configurable column (e.g. Status) and reload → it persists too.
6. Double-click the Name resize handle → returns to auto-fit (unchanged).

## Open threads

- No automated test covers the pointer-drag DOM wiring itself (same gap noted in
  the original feature); the pure rounding/clamp logic is now unit-tested.

## Next session entry point

Bug closed and on `develop`. Resume roadmap work (e.g. the `task/mirror-columns-6d2`
in-flight worktree, or the next planned track).
