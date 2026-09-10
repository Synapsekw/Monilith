---
type: session
date: 2026-09-10-1033
branch: develop
trigger: wrapup
status: complete
tags: [session, performance]
related:
  - "[[2026-06-28-1743-phase-9-close-parallel-batch]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Final performance pass: static shell, table re-render, optimistic add

## What changed

- **Audit first, evidence-based.** Production build + Turbopack analyzer (per-route first-load JS), DEV `pg_stat_statements` and table stats, and three parallel read-only audits (server data fetching, client render/bundle, DB schema/RLS/indexes). Verdict: Phase 9 work holds; DB queries all under 30ms mean; bundle baseline ~430KB gzip shared with nothing cheap to cut; six real gaps found.
- **Every `(app)` route had a 0-byte static shell** since 2026-07-17: `await cookies()` for the device-timezone seed in `authenticated-shell.tsx` sat above every Suspense boundary, so cold loads painted nothing until the server rendered the frame. The layout docblock claimed the opposite. Fixed by passing the cookie as an unawaited promise resolved with React `use()` in the single `DateTime` consumer (`f0266605`, `6a7d9a72`). Build now: `my-work.html` 18.9KB, `boards/[boardId].html` 20.6KB, 24 routes Partial Prerender. `settings/*` and `admin/*` still 0 bytes for an unrelated cause (their own layouts await the auth guard and `redirect()`).
- **Board table re-rendered every visible cell on every state change.** dnd-kit's `SortableContext` puts `items` in its context memo deps, so an inline `items.map(i => i.id)` and inline sensor option literals defeated `React.memo` on every row; `editing` lived inside `controls`, so entering edit mode re-rendered ~300 cells three times; `isItemComplete` scanned all cell values per date cell per render; `GroupSection` recreated a `ResizeObserver` per render. Fixed with a per-cell editing store, memoized `GroupSection`, `useStableIds`, module-constant sensor options, row-scoped memo comparators with compile-time exhaustiveness guards, O(1) status lookup (`2378dab9`, `50ce84e8`, `c14b8423`, `319375dd`). Measured on the fixture: edit-mode entry 18 cells to 1, one-cell patch 18 cells/6 rows to 3 cells/1 row, horizontal scroll 18 to 0.
- **Add item / add subitem are now optimistic** (`8ed07df2`, `5acac7f5`): temp `optimistic-*` id painted at Enter, `replaceItemId` reconciles with the server row in either order against the realtime echo, temp rows are read-only and excluded from selection/drag/delete/kanban drop, Kanban quick-add threads its status cell onto the temp row, failures restore the typed text inline.
- **Offline layer** (`27d935d3`): the service worker's 3s `Promise.race` served `/offline` on any slow-but-online navigation (cold function + board render); now falls back only when `fetch` rejects. The IndexedDB persister wrote the whole multi-board record on every query-cache event; now only on `boardSnapshot` writes.
- **Board payload** (`f9893681`): `cell_values` select narrowed to `item_id, column_id, value, updated_at` (~34% of the largest RSC payload), both cell reads ordered by the PK so the 20,000-row cap truncates deterministically; `CacheCellValue` narrowed to match and the five `payload as unknown as BoardCache` casts deleted.
- Process: five parallel worktrees, per-task review, serialized `finish-task` merges, one whole-branch review, one fix wave (11 findings, all addressed). Two implementers stalled mid-stream at 200k+ tokens; a fresh implementer with the WIP diff finished each. Announced the batch on `/updates` (one commit dated 2026-09-10).

## Why

The app is nearly feature-complete and the owner asked for a final, non-perfectionist performance pass. The static-shell regression had been invisible for two months because the build passes with `instant = false` and the docblock asserted the shell prerendered; only the 0-byte `.html` artifacts told the truth.

## How to test (for the user)

1. Pull `develop`, `pnpm install`, `pnpm build && pnpm start` (or use the next preview after `/promote`).
2. **Cold load:** hard-reload `/my-work` with DevTools Network on "Slow 3G". The sidebar frame and skeletons paint before any data arrives (previously a blank page until the server responded).
3. **Table editing:** open a board with 50+ items, React DevTools Profiler on, click into a cell and commit an edit. Only that row's cells re-render; scrolling and opening a dialog re-render no cells.
4. **Add item:** type a name in the "+ Add item" row, press Enter. The row appears instantly, the input clears and keeps focus; type the next one without waiting. Same for "Add subitem" (the parent expands immediately). Kanban quick-add lands in the right column at once.
5. **Offline fallback:** with Network throttled to "Slow 3G" but online, hard-reload a board. The board renders (previously the `/offline` page after 3s). Toggle the browser offline and reload: `/offline` still appears.
6. **Timestamps:** open an item's Updates tab after a hard reload. Times render in your device zone on first paint with no hydration warning in the console.

## Open threads

- `settings/*` and `admin/*` still ship 0-byte shells: their layouts await `requireUser`/`resolveActiveOrg`/`isOrgAdminCached` and `redirect()` above any boundary. Separate task (relocate the guard below a boundary).
- Column resize still re-renders every cell (`TODO(perf-follow-up)` at `BoardTableInner.tsx` where `template` is threaded): needs a CSS custom property for the grid template across group header, item/subitem, summary and add-item rows.
- Deferred from the audit, all real but lower value: dashboard page's unbounded workspace-columns read for the add-widget dialog; lazy-loading the four board-header dialogs + date picker (~50KB gzip); page-shaped skeletons for six thin `loading.tsx` files; sidebar 3-stage cold waterfall and duplicate cache keys with the command palette; report builder's per-board profile queries; notifications bell client fetch on every page.
- DB scaling items, ms-level today: `readable_board_ids()` scans every tenant's boards per statement (rewrite to a set-based union, verify old-vs-new equivalence per user in a rolled-back txn before shipping); no GIN index for `get_my_work_items` people-cell containment; `item_activities` row trigger per cell on bulk import; no retention on `item_activities`/`notifications`.
- Link rot: `vault/decisions/2026-08-27-decision-41-seven-drag-surfaces-announce-a-keyboard-lift-they-do-not-have.md` links `[[2026-08-27-1400-sidebar-folders-hardening]]`, which does not exist in `vault/sessions/` (the hardening slice was closed in [[2026-09-04-1253-close-three-stalled-worktrees]]); repoint it.
- Nits left by the fix-wave re-review: `optimistic-id.ts` docblock does not yet list "cannot be reordered or deleted"; the M7 regex in `sw-referenced-assets.test.ts` is a weaker ordering assertion by design.

## Next session entry point

`develop` holds four unpromoted tracks (board view prefs, theme presets, this perf pass, plus the earlier queue). Do the manual pass from "How to test" plus the Light-mode check, then `/promote`.
