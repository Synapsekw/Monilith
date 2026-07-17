---
type: session
date: 2026-07-17-2044
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[finish-task-blocked-by-hook-shebang-test]]"
---

# Timeline zoom + fill + sub-item nesting + date sources, and the finish-task hook-test fix

## What changed

- **Timeline zoom levels** (`4179a71`): px/day now varies with zoom instead of a fixed 28px. Added Week/Month/Quarter/Year (`PX_PER_DAY`), coarser `ZOOM_DAY_COUNT` floors, and `buildQuarterTicks` for the Year header. Config schema `zoom` enum widened.
- **Fill-to-width + tick wrapping** (`6b756a7`): `fittedDayW` makes the zoom scale a _floor_ — a short range stretches px/day to fill the measured track (scroller − name rail), re-fit via `ResizeObserver`; header ticks got `whitespace-nowrap`.
- **Sub-item nesting + timestamp date sources** (`a503fe7`): `buildGanttRows` now orders parent→children (reusing `bucketItems`) with `depth`/`hasChildren`/`childCount`; collapsed by default. An **unscheduled parent with scheduled children is shown as a collapsible header row** so its sub-items are never stranded (the QCC bug). Start/End pickers offer **Created at / Updated at** (synthetic read-only cells; drag/resize disabled); schema accepts the sentinels.
- **finish-task hook-test fix** (`0316b43` → merged `41a1dd5`): a `pre` Vitest transform plugin blanks a leading `#!` shebang line in `.mjs` so Rolldown's SSR parser stops failing on `maybe-write-session.test.mjs`. Dogfooded — `finish-task.sh` ran its full gate clean and self-merged.
- Deleted the stale `_draft-2026-07-17-1350.md` (belonged to the already-wrapped datetime session `[[2026-07-17-1647-report-fixes-timestamp-streaming]]`).

## Why

User feedback on the Timeline view: too zoomed-in / scroll-heavy, flat sub-items (QCC's 161 items / 141 sub-items rendered as a flat wall, and after the first nesting cut, collapsed to an empty-looking 2 rows because its top-level items are undated), and a want for `created_at` as a layout date. The hook-test fix removes the pre-existing blocker that forced every merge this session onto a manual fast-forward path.

## How to test (for the user)

1. Pull `develop`, `pnpm dev`, open a board → **Timeline**.
2. Toggle **Week / Month / Quarter / Year** — the grid fills the width at every level (no dead space) and header ticks stay on one line (`Q1 '26` on Year).
3. Open **QCC → Timeline**: ~12 collapsible parent "header" rows instead of a near-empty view; click a chevron to reveal indented sub-item bars.
4. Start/End pickers now list **Created at / Updated at**; picking one re-lays-out by that timestamp and makes bars read-only (no drag/resize); the choice persists across reload.

## Open threads

- Leftover `.claude/worktrees/hook-test-shebang` dir couldn't delete (locked `node_modules` on Windows) — git already de-registered it; harmless, clears on next sweep.
- Promotion `develop → main` deferred at the user's request (they'll run it later).

## Next session entry point

Promote `develop → main` to carry the Timeline upgrades + datetime streaming + report-cover fix to prod, or pick a roadmap build (Report Builder v2, E5, E6). `finish-task` now works normally again.
