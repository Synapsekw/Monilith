---
type: spec
status: approved
phase: 3b
date: 2026-06-16
tags: [spec, phase-3, calendar, timeline, gantt, dependencies]
related:
  - "[[2026-06-14-pulse-design]]"
  - "[[2026-06-15-phase-3a-views-kanban-design]]"
  - "[[2026-06-15-gotcha-05-board-cache-coherence]]"
---

# Phase 3b — Calendar + Timeline/Gantt + Dependencies

## 1. Goal & scope

Add two more board views — **Calendar** and **Timeline/Gantt** — and a first-class **item
dependencies** model. Builds on the Phase 3a view infrastructure (`board_views`, switcher, `?view=`
routing) and the Phase 2 board cache + realtime layer.

One spec / one PR, but built as **three independent units, in order**, each separately testable:

- **(A) Calendar** — month grid placing items by a Date column; drag-to-reschedule; click-to-add.
- **(B) Dependencies data layer** — `item_dependencies` table + RLS + cycle-safe RPC + actions +
  cache/realtime; no view yet.
- **(C) Timeline/Gantt** — date-range bars + zoom + the dependency arrows/violation layer + the
  dependency picker (consumes A's date logic and B's data).

**In scope**

- `view_kind` += `'calendar'`, `'timeline'`; per-kind view `config`.
- `item_dependencies` (finish-to-start), cycle-prevention RPC, create/delete actions, realtime.
- Calendar + Gantt view components, both on the existing `["board", boardId]` cache + realtime.
- Dependency arrows + **violation flag** (successor starts before predecessor ends). No auto-movement.

**Explicitly out of scope (deferred)**

- Auto-reschedule cascade; blocking enforcement on status; drag-to-draw dependencies; non-FS
  dependency types; two-Date-column timeline source; resource/workload rows; `day` zoom.
- Manual reorder within a view; live multi-user sync of the _view list_ (cards/deps are realtime).

## 2. Reused foundation (Phases 2 + 3a)

- `getBoardPayload(boardId)` → `{ board, groups, columns, items, cellValues, views }` (parallel RLS reads).
- `["board", boardId]` TanStack cache (`staleTime: Infinity`), pure patch helpers in `cache.ts`,
  one realtime channel reconciling into it; `useBoardMutations` (`setCell`/`clearCellValue`/`addItem`
  — `addItem`'s `onSuccess` now passes the created item, per 3a Fix-B).
- `board_views` + `create_board_view`/`delete_board_view` RPCs, `resolveSelectedView`, `ViewSwitcher`,
  `BoardHeader`, `?view=` routing, `updateBoardView` (kind-aware config validation).
- **Date cell value shape: `{ date: string; end?: string }`** (`dateValueSchema`) — start + optional
  end. This is the single source for both Calendar and Gantt.
- RLS conventions: denormalized `org_id`, `is_org_member(org_id)` read, `+ board_in_org(board_id,
org_id)` writes, `set_updated_at` trigger, SECURITY-DEFINER RPCs with `set search_path = ''`.

## 3. Data model

New migration `supabase/migrations/<ts>_dependencies_and_views.sql`:

```sql
-- Extend the view kinds (Postgres allows additive enum values).
alter type public.view_kind add value if not exists 'calendar';
alter type public.view_kind add value if not exists 'timeline';

create table public.item_dependencies (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  board_id       uuid not null references public.boards (id) on delete cascade,
  predecessor_id uuid not null references public.items (id) on delete cascade,
  successor_id   uuid not null references public.items (id) on delete cascade,
  type           text not null default 'FS' check (type in ('FS')),
  created_at     timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);
create index item_dependencies_board_id_idx on public.item_dependencies (board_id);
create index item_dependencies_org_id_idx   on public.item_dependencies (org_id);
create index item_dependencies_predecessor_idx on public.item_dependencies (predecessor_id);
create index item_dependencies_successor_idx   on public.item_dependencies (successor_id);

alter table public.item_dependencies enable row level security;
create policy "item_dependencies: read if member"   on public.item_dependencies
  for select using (public.is_org_member(org_id));
create policy "item_dependencies: insert if member" on public.item_dependencies
  for insert with check (public.is_org_member(org_id) and public.board_in_org(board_id, org_id));
create policy "item_dependencies: delete if member" on public.item_dependencies
  for delete using (public.is_org_member(org_id));
-- (no update policy — dependencies are create/delete only in v1)
```

> **Enum caveat:** `alter type ... add value` cannot run inside the same transaction that later
> _uses_ the new value. Keep the enum-extension migration self-contained (no later statement in the
> same file references `'calendar'`/`'timeline'` as a value). The `item_dependencies` DDL above does
> not reference the new enum values, so they can share one migration safely.

**`config` shape by kind**

- `calendar`: `{ date_column_id?: uuid }` — missing/stale → first Date column at render.
- `timeline`: `{ date_column_id?: uuid, zoom?: 'week' | 'month' }` — defaults: first Date column, `month`.

**`create_item_dependency(p_predecessor uuid, p_successor uuid)` RPC** (SECURITY DEFINER, `set
search_path = ''`): authenticate → resolve `board_id`/`org_id` from `predecessor` → membership check
→ assert both items share that board → reject self-link → **cycle check** via recursive CTE (reject
when `p_successor` already reaches `p_predecessor` through existing edges) → insert `(… 'FS')`,
return the row. Raises P0001 with friendly messages (`would create a dependency cycle`, `items must
be on the same board`). `delete_item_dependency` is a plain RLS-scoped delete (an action, not an RPC).

After the migration: `pnpm db:types`; run `get_advisors` (manual gate) — no new warnings.

## 4. Data layer

- `queries.ts`: add `ItemDependency = Tables<"item_dependencies">`; `getBoardPayload` gains a 7th
  parallel read → `dependencies` (ordered by `created_at`). `BoardPayload` + `BoardCache` gain
  `dependencies: ItemDependency[]`.
- `cache.ts`: pure `addDependency(cache, dep)` (idempotent on id) and `removeDependency(cache, id)`.
- `use-board-realtime.ts`: a 3rd `postgres_changes` subscription on `item_dependencies`
  (`board_id=eq.${boardId}`) → INSERT/DELETE reconcile via the new helpers (echo-deduped on id).
- `use-board-mutations.ts`: add `addDependency`/`removeDependency` mutations — `addDependency`
  patch-on-success with the RPC-returned row (mirrors `addItem`); `removeDependency` optimistic
  with rollback (mirrors `clearCell`).
- `view-actions.ts` sibling `dependency-actions.ts`: `createDependency({ predecessorId, successorId })`
  → `create_item_dependency` RPC (maps cycle/same-board/self errors to friendly text);
  `deleteDependency({ dependencyId })` → RLS-scoped delete. Zod-validated; `revalidatePath`.

## 5. Pure logic (the testable core)

- `src/lib/boards/dates.ts`:
  - `resolveDateColumn(columns, config)` → the configured Date column, else first Date column, else
    null (mirror `resolveKanbanGroupColumn`).
  - `itemDateRange(itemId, cellValues, dateColumnId)` → `{ start: string; end: string } | null`
    (`end ?? start`; `null` = unscheduled / no date cell).
- `src/lib/boards/calendar.ts`: `buildCalendarMonth(monthISO, items, cellValues, dateColumnId)` →
  `{ weeks: Day[][] }` where each `Day = { dateISO, inMonth, events: { itemId, name, startsHere,
spanDays }[] }`. Multi-day events span; unscheduled items excluded (surfaced separately). Pure.
- `src/lib/boards/gantt.ts`:
  - `buildGanttRows(items, cellValues, dateColumnId, rangeStartISO, dayCount, zoom)` → `{ rows:
{ itemId, name, startCol, spanCols, isMilestone, scheduled }[] , unitWidthPx }` (geometry in
    grid units; `isMilestone` when `end===start`; `scheduled=false` → goes to the Unscheduled rail).
  - `detectViolations(rows, dependencies)` → `Set<dependencyId>` where successor.start <
    predecessor.end (FS). Pure.
- Drag handlers as pure functions (unit-tested without real drags — the 3a lesson):
  - `onEventDropped(itemId, fromDayISO, toDayISO, currentRange, setCell)` — writes the new date,
    **preserving duration** (shift `end` by `toDay - fromDay`).
  - `onBarMoved(itemId, deltaDays, currentRange, setCell)` / `onBarResized(itemId, newEndISO,
currentRange, setCell)` — write `{ date, end }` accordingly.

## 6. View components

Both `"use client"`, fed by `useBoardCache(boardId)` + `useBoardMutations` + `useBoardRealtime`
(same hydration as `BoardTable`/`KanbanBoard`), rendering the shared `BoardHeader`.

- **`CalendarBoard`**: weekday header + a 6-week month grid. Events placed by `itemDateRange`
  (multi-day = spanning bar reusing the item name + Status pill via `CellRenderer`). **Drag** an
  event to another day → `onEventDropped` → `setCell` (duration-preserving). **Click a day** →
  inline add → `addItem` (first group) then `setCell` that day's date. Month nav (‹ / Today / ›,
  local component state). A **date-column picker** (writes `config.date_column_id` via
  `updateBoardView` + refresh) and an **"Unscheduled (n)"** disclosure listing date-less items.
  Empty state when the board has no Date column.
- **`GanttBoard`**: a left rail of item names aligned to a right, horizontally-scrollable time grid
  (header = day/week/month ticks per `zoom`). Bars from `buildGanttRows`; **milestone** = diamond.
  **Drag bar** → `onBarMoved`; **drag right edge** → `onBarResized` (both `setCell`). **Zoom**
  week/month toggle (persists `config.zoom`). **Dependency arrows**: an SVG overlay drawing
  predecessor→successor; **violations** (`detectViolations`) rendered in the destructive accent.
  **Bar "⋯" menu** (`dropdown-menu`): "Add dependency → blocked by [item]" (picker over the board's
  other items → `createDependency`) and, per existing arrow, "Remove dependency" → `deleteDependency`.
  An **"Unscheduled" rail** for date-less items. Date-column picker. Empty state when no Date column.
- `ViewSwitcher` "+ Add view" can create `calendar`/`timeline` (icons `CalendarDays`,
  `GanttChartSquare`); `page.tsx` selected-view branch extends to render `CalendarBoard`/`GanttBoard`.

## 7. Cache coherence & a11y

- Every mutation (date edits, dependency add/remove) **patches the `["board", boardId]` cache** via
  pure helpers; realtime reconciles other users' changes (echo-deduped); view `config` persists via
  `updateBoardView` + navigation refetch — the Phase 3a rules
  ([[2026-06-15-gotcha-05-board-cache-coherence]]).
- dnd-kit drives drag, but the LOGIC lives in the pure `onEventDropped`/`onBarMoved`/`onBarResized`
  handlers (unit-tested directly). Dependency creation is **picker-based** → keyboard-accessible;
  the Table view remains the fully accessible fallback for editing.

## 8. Testing

- **RLS integration**: `item_dependencies` org-scoped read/write; cross-org denied; `create_item_
dependency` rejects self-link, cross-board, and **cycles** (A→B then B→A); accepts a valid edge.
- **Unit** (the bulk): `resolveDateColumn`; `itemDateRange` (date-only, range, unscheduled);
  `buildCalendarMonth` (placement, multi-day span, month-boundary days, unscheduled excluded);
  `buildGanttRows` (geometry, milestone, week vs month zoom, unscheduled split); `detectViolations`
  (violating vs clean FS edges); `onEventDropped`/`onBarMoved`/`onBarResized` (correct `setCell`
  writes incl. duration preservation).
- **Component**: Calendar renders weeks + events, drop calls `setCell`, click-day adds; Gantt
  renders bars + milestone + arrows, violation highlight, dependency picker calls `createDependency`,
  remove calls `deleteDependency`, resize/move call `setCell`.
- **e2e**: add a Calendar view → item shows on its date → reschedule persists across reload; add a
  Timeline view → create a dependency via the picker → arrow renders → reload persists. (Use the
  robust set-date-via-editor approach over flaky pointer drags, per 3a.)
- **Gate**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` + e2e all green; advisors clean.

## 9. Build order (for the plan)

1. Migration (enum values + `item_dependencies` + RLS + `create_item_dependency` RPC), `db:types`,
   advisors. Tests: RLS integration.
2. Data layer: `ItemDependency` + `dependencies` in payload/cache; `addDependency`/`removeDependency`
   cache helpers + realtime subscription; `createDependency`/`deleteDependency` actions. Tests: unit + action.
3. Dates core: `dates.ts` (`resolveDateColumn`, `itemDateRange`). Tests: unit.
4. **(A) Calendar**: `calendar.ts` + `onEventDropped`; `CalendarBoard`; routing/switcher wiring. Tests: unit + component.
5. **(C) Gantt**: `gantt.ts` (`buildGanttRows`, `detectViolations`) + `onBarMoved`/`onBarResized`;
   `GanttBoard` (bars, zoom, unscheduled rail, arrows + violations, dependency picker). Tests: unit + component.
6. e2e (Calendar + Timeline happy paths); full gate; wrapup.

## 10. Workflow note

Per the current two-branch model, this is built **on `develop`** (no feature branch); promote to
`main` via a `develop → main` PR when green.
