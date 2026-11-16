---
type: adr
date: 2026-11-15
status: accepted
tags: [decision, work-tracking, folders, health, data-model]
related:
  [
    "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]",
    "[[2026-08-02-decision-32-production-runs-the-dev-database]]",
  ]
---

# decision-46 — One rule for done, due and overdue: the Work tracking rule

**Date:** 2026-11-15
**Decided by:** owner
**Status:** accepted; built on `task/one-overdue-rule`. The migration
`20261115173751_one_overdue_rule` is **written but not applied**; its numbers on live data come
from `scripts/sql/dry-run-one-overdue-rule.sql`, which the orchestrator runs before applying.

## Context

"Done" and "overdue" had three definitions, so one board showed different numbers on different
pages:

- **Work tracking** (new, 2026-11-14): `boards.work_*` settings, the `public.item_facts` view and
  its TypeScript twin `src/lib/boards/work-guess.ts`. Done = the configured done options, else a
  label guess (done / complete / cancel, minus negated labels). Due = the configured due column,
  else a name guess. Used by Today, My Work, `query_items`, `count_items`, `get_focus_today`.
- **Old SQL rule** (`_board_health_flags`, `_folder_item_flags`): first status column, label
  `~* '(done|complete)'` ("Incomplete" was done, "Cancelled" was open), overdue when ANY date cell
  was in the past (a Start date counted), `current_date` in the database's zone. Used by the
  health widget, the weekly digest and every folder RPC.
- **Old TypeScript rule** (`src/lib/boards/overdue.ts`, plus a private copy in
  `src/lib/reports/shape.ts`): `/done|complete/i` on the first status column, any past date cell.
  Used by the board's date tint, done burst, group progress, timeline "late", Board Intelligence
  and reports.

The folder page also disagreed with itself: Overdue, the attention list and "late" per person
used the earliest date on an item; the heat map, Due this week, Gap and the burn's planned line
used the latest.

## Decision

1. **One rule everywhere: the Work tracking rule.** For any board, every surface agrees on which
   items are done, which ONE date is the due date, and which items are overdue (due date before
   today and not done).
   - SQL: the rule text lives only in `public.item_facts`. `_work_item_flags` reads the view;
     `_board_health_flags` and `_folder_item_flags` are based on it. No function restates the
     rule (`src/lib/boards/one-overdue-rule.sql.test.ts` fails if one does).
   - TypeScript: `resolveWorkRule` in `work-guess.ts` is the twin of the view's three choices
     (status column, done options, due column); `overdue.ts` holds no rule of its own.
   - A date column that is not the due column never tints and never makes an item late.
   - Folder `due_on` and `planned_on` are the same date now, so the folder page has one lateness
     notion.
2. **Stored mappings are left alone.** Goals, portfolios and the dashboard completion widget keep
   the done mapping the user chose per link. Only their DEFAULT suggestion (and the automation
   recipes' "completed" option) calls the shared guess.
3. **Subitems, per consumer:**
   - folder pages, health widget, weekly digest: **top-level items only** (`parent_id is null`),
     as before, so a parent and its subitems never count twice;
   - Today, My Work, `query_items`, `count_items`: subitems are items in their own right (they
     can be assigned and due), unchanged;
   - reports: **leaf items** (an item with subitems is a header), unchanged;
   - the board itself: every row it renders, subitems included.
   So a folder's Overdue can be lower than `count_items` for the same boards by exactly the
   overdue subitems. That is intended, and the dry-run script reports both.
4. **"Today":**
   - server-computed numbers (folder RPCs, health widget, digest): the calendar date in the
     **viewer's zone, then the organisation's, then UTC** (`_work_time_zone`), the same order as
     `effectiveTimeZone()` for Today and My Work. With no signed-in user (the digest cron) it is
     the organisation's zone. Bare `current_date` (the database's zone) is gone. The folder
     page's own `todayISO` uses the same order.
   - client display surfaces (date tint, timeline, Board Intelligence): **viewer-local**, through
     the one helper `localTodayISO()`. It is a display tint, and the viewer's clock is right for
     it.
   - reports: UTC (server render, no viewer); `computeKpis` takes a `todayISO` for a caller that
     knows better.
5. **Gap to plan counts dated items on both sides:** `done_dated − planned_by_today`
   (`folder_rollup` gains `done_dated`). The burn chart's completed line counts the same
   population. Before, every done item counted against a plan only dated items are part of.
6. **`folder_burn` must not be dropped.** `folder_burn_packed`, the RPC the page calls, selects
   from it. An earlier session note said to drop it after promotion; that note is wrong.

## Consequences

- **Every user sees different numbers.** On the largest live folder 2,093 of 2,115 items have
  two different dates, so Overdue there falls sharply (Start dates no longer count). "Cancelled"
  now counts as done; "Incomplete" no longer does.
- The health widget and digest stop counting archived items, groups and boards (the view leaves
  them out; the old function did not).
- "Incomplete" (missing fields) means: open, and no owner on a board with a people column, or no
  due date on a board with a due column. The date half used to look at the first date column.
- Folder flags are computed in one pass over the folder's boards instead of one call per board
  with six correlated subqueries per item (read-only prototype on the largest folder: about
  84 ms against about 820 ms).
- `folder_rollup`'s return type changed (one added column), so `src/types/database.types.ts`
  must be regenerated after the migration is applied.
- The Complete card's trend adds today's count of done-but-undated items to earlier weeks: the
  burn has no history for items without a due date. An approximation, stated in `tower.ts`.

## What would change this decision

- A second "planned finish" date that is deliberately different from the due date (a baseline):
  that would be a new, named setting on the board, not a return to "latest date wins".
- Per-user "today" on shared artefacts (a digest email read in another zone): the digest would
  need the recipient's zone, which it does not have today.
