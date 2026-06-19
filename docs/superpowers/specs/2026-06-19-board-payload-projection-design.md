# Board payload projection — make boards load faster

**Date:** 2026-06-19
**Status:** Approved (design); implementation deferred (see Coordination)
**Related:** `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`

## Problem

The board detail page loads the full board state on first paint via
`getBoardPayload` (`src/lib/boards/queries.ts`). The dominant cost is the
`cell_values` read:

```ts
supabase.from("cell_values").select("*").eq("board_id", boardId); // queries.ts:74
```

This is unbounded and uses `select("*")`, shipping columns no client code reads
(`id`, `org_id`, `board_id`, `created_at`, `updated_at`) on every cell row. For a
board of N items × M columns this is N×M rows × full-row width.

## Investigation findings (why windowing is the wrong tool here)

Every board view needs **all items'** cells, so the fetch cannot be windowed to
the visible table rows:

| View     | Needs all items' cells?                                    | Evidence                                      |
| -------- | ---------------------------------------------------------- | --------------------------------------------- |
| Table    | Yes (builds `cellMap` from full set; virtualizes DOM only) | `BoardTable.tsx:149`, `cache.ts:26`           |
| Kanban   | Yes (groups every item by its status cell)                 | `kanban.ts:25-68`, `KanbanBoard.tsx:130`      |
| Calendar | Yes (places every item by its date cell)                   | `calendar.ts:65-124`, `CalendarBoard.tsx:148` |
| Timeline | Yes (every item on the axis + dependencies)                | `gantt.ts:46-118`, `GanttBoard.tsx:190`       |

No client-side aggregates/rollups/footers or cell-based sorts exist that would
need all cells beyond the above. Realtime patches the full `cellValues` array
(`use-board-realtime.ts:47-69`); consumers read only `item_id`, `column_id`,
`value` (`cache.ts` `buildCellMap`/`upsertCellValue`/`removeCellValue`).

**Scale decision:** boards are expected to stay ≤ ~200 items (~2,000 cell rows).
At that size, item pagination/windowing adds partial-cache + realtime complexity
for little gain. The proportionate fix is reducing **bytes per row**.

## Design — payload projection

1. **Narrow the `cell_values` hot read** to the fields actually consumed:
   ```ts
   supabase
     .from("cell_values")
     .select("item_id, column_id, value")
     .eq("board_id", boardId);
   ```
2. **Retype the cache cell** to the projected shape so the type system enforces
   that only these fields are relied on:
   ```ts
   // src/lib/boards/cache.ts
   export type CacheCellValue = Pick<
     Tables<"cell_values">,
     "item_id" | "column_id" | "value"
   >;
   ```
   Realtime payloads (full rows) still assign structurally to this type; all
   consumers already use only these three fields, so behavior is unchanged.
3. **Audit other `select("*")` hot reads** in `getBoardPayload` (`groups`,
   `columns`, `items`, `item_dependencies`, `board_views`). Narrow **only** those
   whose consumers use a clear subset and where narrowing is provably safe (e.g.
   `item_dependencies`). Do **not** narrow reads whose full row is genuinely used
   (`items`, `columns` carry positions/settings/names broadly consumed). When in
   doubt, leave as-is — the cell_values win is the primary target.
4. **Keep** the already-shipped dashboard-page waterfall fix
   (`src/app/dashboards/[dashboardId]/page.tsx`: parallel boards + inner-join
   columns).
5. **Document the revisit trigger:** add a note to gotcha-09 that when boards
   routinely exceed ~500 items, reopen per-view column projection (fetch only the
   active view's required columns on first paint, lazy-load the rest) or item
   pagination.

## Explicitly deferred (YAGNI at current scale)

- **Per-view column projection** (Kanban=status, Calendar/Gantt=date only on
  first paint). Bigger win only when the default view isn't Table; adds
  partial-cell-set handling to cache/realtime/view-switch.
- **Item pagination / viewport windowing** with background completion.

## Performance & data-fetching budget (CONTRIBUTING rule 5)

- **First paint:** 6 parallel, RLS-scoped, `board_id`-indexed reads (unchanged
  count); `cell_values` payload reduced ~40% by dropping unused columns.
- **In-page interactions** (view toggle, filter, sort over loaded data): **0 new
  server round-trips** — client state + History API, unchanged.
- **Server-data changes:** Server Action + targeted revalidation, unchanged.
- **Bounded/indexed:** `board_id` indexed (migration `20260616193000`). Not
  strictly row-bounded; acceptable at ≤200 items with a documented >500-item
  revisit trigger.

## Testing

- The narrowed `CacheCellValue` type must compile across **all** cell consumers
  (Table/Kanban/Calendar/Gantt + cache helpers + realtime). This compile check is
  the primary safety net for "no behavior change".
- `src/lib/boards/cache.test.ts` stays green; add/adjust a test asserting
  `buildCellMap` and `upsertCellValue` work on the projected shape.
- Board e2e (`e2e/boards.spec.ts`) stays green (renders all views, edits cells).
- Manual/verify: load a board in each view after the change; confirm cells,
  Kanban grouping, Calendar placement, Gantt bars/dependencies all render.

## Coordination (implementation timing)

`src/lib/boards/queries.ts` and `src/lib/boards/cache.ts` are being edited by a
concurrent session in this shared checkout (per AGENTS.md: one checkout, one
branch `develop`). **Implementation is deferred** until those edits land, then
this change applies cleanly on top. Do not clobber the other session's work.

Independently, `develop` currently has unrelated red typecheck from the
`call_webhook` automation commits — out of scope for this change.
