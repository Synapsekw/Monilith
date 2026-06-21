---
type: spec
phase: 6d-3
status: awaiting-review
date: 2026-06-21
related:
  - "[[2026-06-21-phase-6d2-mirror-columns-design]]"
  - "[[2026-06-21-phase-6d1-relations-design]]"
---

# Phase 6d-3 — Mirror aggregation (column-summary footer)

## 1. Summary

Add a **column-summary footer row** to the board Table view (Monday/ClickUp "rollup
calc" pattern). Every aggregatable column can opt in to show a single summary value
at the bottom of the table — `Σ 20` on a Numbers column, a status distribution bar,
a checked/total on a Checkbox column, a date range, etc. The **mirror** column kind
(6d-2) is one consumer: it aggregates over the values it mirrors by inheriting its
target column's aggregation matrix.

This is the committed 6d-3 fast-follow deferred from 6d-2 (north-star:
*"aggregation — sum/avg/min/max/count in the column-summary footer"*). Scoped to the
**full per-column footer** (every column can aggregate), not mirror-only — the footer
is the generic feature; mirror aggregation is a consumer of it.

## 2. Goals / non-goals

**Goals**
- A sticky summary footer row in the Table view, aligned to the existing column grid
  (incl. the frozen Name column + resize).
- Per-column, user-selectable aggregation persisted in `columns.settings` (opt-in,
  empty until picked).
- Mirror columns aggregate over mirrored values via their target column's matrix.
- **0 extra first-paint round-trips** — all math is client-side over already-hydrated
  cache data; recompute on edit.

**Non-goals (deferred)**
- Per-**group** subtotals (v1 is a single board-level total over loaded top-level
  rows; group-level footer is a clean later extension).
- Footer in Kanban/Calendar/Gantt (Table only for 6d-3; Kanban already has a
  separate `summaryColumns` concept).
- Server-side aggregation for boards exceeding the loaded-row bound (note the
  existing `queries.ts:191` row cap as a known limitation, same as today's rollups).

## 3. Decisions (locked)

### D1 — Render target: a footer row (not collapsed-parent cells)
Per the vault commitment. No `<tfoot>` exists today; `BoardTable` is a virtualized,
absolute-positioned div layout, so the footer is net-new UI.

### D2 — Scope: full per-column footer (Option A, user-chosen)
Every aggregatable column kind can show a summary. The mirror column is one consumer.

### D3 — Migration-free (settings JSONB)
One new optional field `columns.settings.summary_aggregation?: AggregationId`, added to
a shared `baseColumnSettingsSchema` merged into every per-kind schema in
`validations/boards.ts`. **No DDL, no new table/RPC/RLS, no new `ColumnKind`** (so no
exhaustive-switch fallout). Picking an aggregation is a column-settings Server Action
(`updateColumn` + optimistic `replaceColumn`); computing the displayed value is pure
client-side.

### D4 — kind → aggregation matrix
The **count family** (count / count-empty / count-filled / count-unique) is a generic
presence-based reducer available on every kind. Per-kind additions:

| Kind | Aggregations (default first) |
| --- | --- |
| numbers | **sum** · avg · min · max · count · count-empty · count-filled |
| rating | avg · min · max · count · count-filled |
| status | **distribution** · count · count-filled · count-empty · count-unique |
| dropdown | distribution · count · count-filled · count-empty |
| checkbox | **checked/total** · % checked · count |
| date | **range (earliest→latest)** · earliest · latest · count-filled |
| people | **unique count** · count-filled |
| time_tracking | **total tracked** · total/estimate |
| text / link / email / phone | count · count-empty · count-filled · count-unique |
| files | count-filled |
| relation | count-filled |
| mirror | **inherits the TARGET column's matrix** (resolve target kind, reuse its reducers over flattened mirrored values) |

### D5 — Footer surface approach (verified against live BoardTable)
A single **non-virtualized row** rendered inside the existing scroll container
(`scrollContainerRef`) as a sibling after the `GroupSection`s, pinned
`sticky bottom-0 left-0`. It reuses the **exact same `gridTemplate(columns, liveWidths,
nameWidth)`** track string as the header/data rows (guaranteeing column + resize
alignment); the frozen Name track reuses `sticky left-0 z-10` + `NAME_FREEZE_EDGE`;
z-index `15` (above data rows `10`, below header `20`).

### D6 — Reuse the existing rollup engine
Math reuses `rollupCell` / `rollupTimeTracking` from `src/lib/boards/rollup.ts`. A new
pure module `src/lib/boards/aggregation.ts` adds the selectable reducers (avg / min /
max / count-family) and `allowedAggregations(kind)`. A new `FooterCell.tsx` generalizes
`RollupCell` for footer rendering.

### D7 — Population set
Board-level total over **loaded top-level rows**. Subitems excluded (see F1). Group
collapse does not change the total in v1.

## 4. Data-fetching / performance budget (AGENTS.md #5)

- **First paint:** 0 new round-trips. Numbers/status/etc. live in `cell_values` already
  in the cache; mirror values resolve via the 6d-2 hydration (`mirrorValuesForCell` over
  `relationLinks` + `mirrorTargetCells`).
- **Interaction (pick an aggregation):** 1 Server Action to persist
  `summary_aggregation` to `columns.settings` (changes server data → Server Action +
  optimistic `replaceColumn`); the footer value itself is recomputed client-side.
- **Edit a cell:** footer recomputes client-side from the updated cache — no fetch.
- Hot-path: aggregation is O(loaded rows) per summarized column, memoized.

## 5. Open items flagged for review (defaults chosen, easy to flip)

- **F1** — Subitems excluded from the board total (top-level rows only). *Default: exclude.*
- **F2** — Numbers requires an explicit pick (no auto-default to Sum). *Default: opt-in.*
- **F3** — Status footer offers both distribution + count (distribution shown first).

## 6. Risks

- **Footer alignment under horizontal scroll + frozen Name + live resize** is the main
  visual risk — mitigated by reusing the identical `gridTemplate` + freeze tokens.
- **Mirror-of-mirror / mirror target unreadable (RLS)** — nulls flatten out exactly as
  6d-2 renders them empty; count-family treats null as empty.
