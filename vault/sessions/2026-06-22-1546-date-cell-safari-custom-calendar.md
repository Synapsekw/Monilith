---
type: session
date: 2026-06-22-1546
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]"
---

# Date cell — Safari custom calendar

## What changed

- Replaced the date cell's native `<input type="date">` (`DateEditor`,
  `src/components/boards/cells/editors/index.tsx`) with a custom calendar in the existing Popover,
  auto-opened on edit with a visible lucide affordance.
- New `src/components/ui/calendar.tsx` — a shadcn-style react-day-picker (v10) primitive themed with
  Pulse tokens (full Tailwind `classNames`, no base CSS import, custom lucide chevrons).
- `DateEditor` now **preserves an existing range `end`** by duration-shift instead of dropping it
  (old `onCommit({ date })` collapsed Gantt/Calendar spans); local ISO↔Date conversion avoids the
  UTC off-by-one.
- TDD: `calendar.test.tsx` (4) + rewrote `DateEditor` tests (6) in `editors.test.tsx`.
- Merged `task/date-cell-calendar` → `develop` (`0b67351`); spec + plan in
  `docs/superpowers/{specs,plans}/2026-06-22-date-cell-custom-calendar*`.

## Why

Root cause: the calendar was the native browser control. Chrome draws the calendar icon via
`::-webkit-calendar-picker-indicator`; macOS Safari renders no such pseudo-element (no CSS can force
it) and its dropdown is unstylable OS chrome — so the icon was missing and the picker looked
unpolished only in Safari. Rendering our own calendar makes both the icon and the dropdown identical
and polished across browsers.

## How to test (for the user)

1. Pull `develop`, `pnpm dev`, open a board with a **Date** column (or add one).
2. Click a date cell → a calendar popover opens immediately with a visible calendar (not the native field).
3. Open the same board in **Safari and Chrome** → calendar looks identical/polished in both; the
   missing-icon-in-Safari bug is gone.
4. Pick a day → it commits; reopen → the picked day is highlighted.
5. On a multi-day item (a bar in Timeline/Gantt or Calendar view), edit its **start** date → the span
   keeps its length (end shifts) instead of collapsing to a milestone.
6. Open a populated date cell → click **Clear** → the cell empties.

## Open threads

- **Deferred:** the two native `<input type="date">` in `TimeTrackingCell.tsx` (~lines 310, 406)
  weren't converted — cheap follow-up now that the Calendar primitive exists.
- **Merged on evidence, not a clean full gate.** The live-Supabase integration suite flaked 3× under
  contention from ~5 concurrent worktree sessions (different unrelated files each run —
  invites/subitems/goals/dashboards, codes 23503/P0002; all pass per-file, e.g. 10/10 in isolation).
  Deterministic gates (typecheck/lint/971 unit/build) green on the rebased state. This is the
  already-documented [[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]
  — worth watching whether N parallel sessions make `finish-task.sh`'s integration gate routinely
  unreachable.

## Next session entry point

Roadmap remains **7c Workload/capacity** (now in flight in `task/workload-7c`, merged `d95678d`) and
the 7b per-option done-mapping follow-up. Quick win available: convert `TimeTrackingCell`'s date
inputs to the new `Calendar` primitive.
