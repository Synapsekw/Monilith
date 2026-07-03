---
type: spec
status: awaiting-review
date: 2026-07-03
feature: summary row — configurable per-column aggregation (MVP Final item 2, feedback F2)
related:
  - "[[2026-06-21-phase-6d3-mirror-aggregation-design]]"
  - "[[2026-07-03-currency-column-design]]"
  - "[[2026-07-03-mvp-final-features]]"
---

# Summary row — configurable per-column aggregation

## 1. Summary

Feedback F2 (verbatim): _"We need summary rows that are functional and modular. I should be
able to assign how the column is summarized and what is shown in it."_

**Gap-analysis verdict: most of this request already shipped.** Phase 6d-3 built a
board-level summary footer with a **user-assignable aggregation per column**, and the
currency feature (merged 2026-07-02/03) extended it with currency-formatted sums including
the dirham sign. What is genuinely missing is the **per-group** dimension: groups have no
summary row when expanded, and the collapsed-group rollup strip ignores the user's assigned
aggregation (it shows a hardcoded per-kind rollup labeled "Average"). This spec designs that
minimal delta — per-group summary rows driven by the same per-column choice — plus making
the collapsed-group strip honor that choice.

## 2. Gap analysis (what exists vs. what's missing)

### Already exists (verified in this worktree's snapshot of `develop`)

| Capability                                      | Where                                                                                               | Notes                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board-level sticky summary footer in Table view | `src/components/boards/BoardTable.tsx` → `SummaryFooter`                                            | Sticky `bottom-0`, aligned to the column grid + frozen Name track; aggregates **all loaded top-level items** across the board                                                                            |
| **User-assignable aggregation per column**      | `FooterCell` picker (`src/components/boards/FooterCell.tsx`)                                        | Editors pick from a per-kind allowed set via dropdown on the footer cell; "None" clears. Viewers see values read-only                                                                                    |
| Full aggregation vocabulary                     | `src/lib/validations/boards.ts` → `aggregationSchema`; `src/lib/boards/aggregation.ts`              | sum, avg, min, max, count, count_filled, count_empty, count_unique, distribution (status/dropdown bar), checked_total, percent_checked, date_range, earliest, latest, total_tracked, total_over_estimate |
| Per-kind sensible option sets + defaults        | `allowedAggregations(kind, targetKind?)`                                                            | Default-first ordering per kind (numbers/currency → sum-first, percent/rating → avg-first, checkbox → checked/total, date → range, …); mirror delegates to its target column's kind                      |
| Persistence, migration-free                     | `columns.settings.summary_aggregation` (jsonb) via `baseColumnSettingsSchema`                       | Written by the existing `updateColumnSettings` Server Action with optimistic `replaceColumn` cache patch (`src/lib/boards/use-board-mutations.ts`)                                                       |
| Currency aggregation + formatting               | `aggregate(...)` carries `style: "currency"` + ISO code; `FooterValue` renders via `CurrencyAmount` | Includes the AED dirham-sign flag (`dirham_sign`, absent = ON)                                                                                                                                           |
| 0-round-trip computation + live recompute       | `SummaryFooter` computes client-side over the hydrated board cache                                  | Optimistic cell edits and realtime patches flow through the `["board", id]` cache → footer re-renders automatically                                                                                      |
| Collapsed-group rollup strip                    | `BoardTable.tsx` → `GroupRollupRow` + `RollupValueCell` (`src/lib/boards/rollup.ts`)                | Shows a **hardcoded** per-kind rollup (labeled "Average") when a group is collapsed — not the user's chosen aggregation                                                                                  |

### Missing (the delta this spec designs)

1. **Per-group summary rows.** 6d-3 explicitly deferred this ("Per-group subtotals … a clean
   later extension"). Today the only summary is one board-wide footer; the "summary rows"
   (plural) in F2 — Monday-style subtotals at the bottom of each group — do not exist.
2. **Collapsed groups ignore the assigned aggregation.** `GroupRollupRow` shows a fixed
   rollup regardless of what the user assigned, so "what is shown in it" is not honored on
   the one group-level summary surface that does exist.
3. Nothing else. "Assign how the column is summarized" and "what is shown" (including
   showing nothing — "None") are already satisfied per column at board level; the same
   choice will now drive the group rows.

## 3. Goals / non-goals

**Goals**

- A summary row at the bottom of **each expanded group** in the Table view, aggregating that
  group's top-level items with the column's assigned `summary_aggregation`.
- Collapsed groups honor the assigned aggregation (falling back to today's rollup strip when
  no column has one).
- Same picker interaction on group summary cells as on the board footer (the choice is
  **per column, board-global** — changing it anywhere changes it everywhere).
- 0 new first-paint round-trips; all math client-side over the already-hydrated cache;
  recompute on optimistic/realtime edits for free.
- No migration, no new Server Action, no schema/validation change.

**Non-goals (deferred)**

- Per-group _overrides_ of the aggregation (a different aggregation per group for the same
  column). One choice per column, applied uniformly — Monday semantics. (Open question Q1.)
- Summary rows in Kanban/Calendar/Gantt (Kanban has its own `summaryColumns` concept).
- Server-side aggregation beyond the loaded board payload — same bound as 6d-3 and as the
  collapsed rollup today (the board payload is the bounded unit; see §6).
- Including subitem cells in aggregates (footer and group rows aggregate **top-level** rows
  only, consistent with the existing board footer and `GroupRollupRow`). (Open question Q3.)
- Excel export of summary rows (item 3's territory if wanted later).

## 4. Decisions

### D1 — One setting drives every summary surface (no new persistence)

`columns.settings.summary_aggregation` remains the single source of truth. The board footer,
each group's summary row, and the collapsed-group strip all read it. Changing it from any
surface persists via the existing `updateColumnSettings` mutation (optimistic + realtime).
**Settings-only: no migration is needed** — the field, its Zod schema, the Server Action,
and the optimistic path all exist.

### D2 — Extract a shared `SummaryRow` component

`SummaryFooter` (currently a private component in `BoardTable.tsx`, ~70 lines) is
generalized into a reusable row component (new file `src/components/boards/SummaryRow.tsx`)
parameterized by: `label` (frozen Name-track content), `itemIds` (scope), the existing
grid/meta props (`template`, `nameWidth`, `cache`, `cellMap`, `nowMs`), `canEdit`,
`onChange`, plus presentation variants (`sticky` board footer vs. in-flow group row; group
color bar). `footerColumnMeta` / `footerColumnValues` helpers move with it. The board footer
becomes `<SummaryRow variant="board" …>`; groups render `<SummaryRow variant="group" …>`.
`FooterCell` is reused unchanged.

### D3 — Group summary row visibility: earn the row

A per-group summary row renders **only when at least one column has an assigned
aggregation**. Rationale: an always-on empty row per group is pure noise (boards can have
many groups), and the "set one up" affordance already exists on the always-present board
footer. Once any column has an aggregation, group rows appear; their other cells then show
the editor-only "Summary" affordance so more columns can be assigned in place.

### D4 — Position: last row of the expanded group, in flow (not sticky)

The group summary row renders after the group's virtualized row area and before
`AddItemRow`, as a plain in-flow row (one non-virtualized row per group — bounded by group
count, same cost class as `GroupHeaderRow`). The board footer stays sticky at the viewport
bottom, unchanged.

### D5 — Collapsed groups: assigned aggregation wins, rollup strip is the fallback

When a group is collapsed and ≥1 column has `summary_aggregation`, render the group's
`SummaryRow` (read-only values + picker for editors, exactly as when expanded) instead of
`GroupRollupRow`. When no column has an assigned aggregation, keep today's `GroupRollupRow`
behavior byte-for-byte (no regression for boards that never touch summaries). This directly
fixes gap 2: the user's choice controls "what is shown" on the collapsed strip.

### D6 — Aggregation scope per row

- Group summary row: that group's **top-level** items (the `items` prop `GroupSection`
  already receives — `itemsByGroup` excludes subitems).
- Board footer: all top-level items (unchanged).
- Mirror, time-tracking, currency, dirham-sign handling: identical to the board footer —
  the same `footerColumnMeta` / `footerColumnValues` / `aggregate` path, just with a
  group-scoped `itemIds` list. Currency sums render through `CurrencyAmount` with the
  column's ISO code and `dirham_sign` flag exactly as today.

### D7 — Modularity boundary

`aggregate`, `allowedAggregations`, `AggregateResult`, `FooterCell`, `FooterValue` are
untouched. The whole feature is: one new presentational component (`SummaryRow`), two call
sites in `BoardTable.tsx` (board footer swap + group row), one conditional in the collapsed
branch. This keeps `BoardTable.tsx` (already ~2000 lines) from growing and gives the group
row its own testable unit.

## 5. UI notes (pulse-ui)

- **Chrome stays monochrome.** Group summary row: `bg-surface-muted` (matching the board
  footer) with a hairline `border-t`; values `text-foreground text-sm font-medium
tabular-nums` via the existing `FooterValue`; labels `text-muted-foreground` uppercase
  11px — all already encoded in `FooterCell`.
- **Name track:** frozen (`sticky left-0` + `NAME_FREEZE_EDGE`), showing the group's color
  as the same `inset 3px 0 0 0 ${group.color}` box-shadow used by `GroupHeaderRow` /
  `GroupRollupRow`, with a muted "Summary" label (count of items optional — see Q2). Status
  colors appear only inside distribution bars (sanctioned status palette), never on chrome.
- **Picker:** the existing `FooterCell` dropdown (shadcn `DropdownMenu`), keyboard-reachable
  trigger with `focus-visible` ring; read-only span for viewers. No new primitives, no
  Framer Motion (Radix built-ins only).
- **Density:** same `py-1.5` compact row height as the board footer; truncation via
  `min-w-0`/`truncate` as in `FooterCell`.
- **Grid alignment:** reuse the exact `template` track string + the two `aria-hidden` filler
  tracks so the row stays aligned under horizontal scroll, column resize, and the frozen
  Name column — same discipline as D5 in the 6d-3 spec.

## 6. Performance & data-fetching budget (working agreement #5)

- **First paint: 0 new server round-trips.** The board payload already contains every input
  (columns + settings, items, cell values, time entries, relation/mirror data). Group
  summary rows are derived client-side from the hydrated `["board", id]` cache.
- **Interactions:**
  - Picking/clearing an aggregation **changes server data** (a column setting) → the
    existing `updateColumnSettings` Server Action, optimistic cache patch, targeted
    revalidation — **1 round-trip per explicit choice**, unchanged from today.
  - Expanding/collapsing a group, scrolling, editing cells → **0 new round-trips**; rows
    recompute from the cache (optimistic upsert and realtime patches already rewrite the
    cache, so summaries stay live without any new wiring).
- **Bounded computation:** aggregation is O(loaded top-level items × columns with an
  assigned aggregation), partitioned by group — the same set the board footer already
  reduces every render. Rows are non-virtualized but bounded by **group count** (one row per
  group, only when summaries are in use). No unbounded fetch is ever triggered; boards
  larger than the loaded payload aggregate over loaded rows only (explicitly the same
  limitation as 6d-3 and `GroupRollupRow` — documented, not new).
- **Memo hygiene:** compute each group's `values` arrays inside `SummaryRow` (`useMemo` on
  `cellValues`/`items` identity) so React Compiler / memoization keeps per-keystroke cost at
  one group row, not the whole table.

## 7. Realtime / multi-user behavior

- Aggregation choice: optimistic locally; other clients receive the `columns` UPDATE over
  the existing board realtime channel → their footer, group rows, and collapsed strips
  re-render with the new choice. On error the existing mutation rollback restores the
  previous settings and toasts.
- Cell edits (own or remote): flow through the cache as today; every summary surface
  recomputes on render. No new channels, no new subscriptions.

## 8. Error handling

No new failure modes: computation is pure over in-memory data (`aggregate` already returns
`{ kind: "empty" }` for degenerate inputs); persistence reuses the hardened
`updateColumnSettings` path (Zod-validated settings, RLS-scoped, rollback + toast on error).
Malformed/legacy `settings` json simply yields `summary_aggregation === undefined` → no row.

## 9. Testing

Vitest, colocated (extends existing suites):

1. **`SummaryRow.test.tsx` (new):** renders one cell per column aligned to the template;
   group-scoped values (two groups, different sums); currency column renders formatted
   total incl. dirham-sign flag; mirror column aggregates via target kind; picker calls
   `onChange` and is absent for viewers; row hidden when no column has an aggregation.
2. **`BoardTable.test.tsx` (extend):** group summary row appears after assigning an
   aggregation and shows the group subtotal (not the board total); board footer unchanged;
   collapsed group with an assigned aggregation shows the summary row, without one shows
   the legacy rollup strip; optimistic cell edit updates the group subtotal.
3. **`FooterCell.test.tsx` / `aggregation.test.ts`:** unchanged (no engine changes) — run
   as regression.

## 10. Independent units (for the plan's DAG)

- **U1 — extract `SummaryRow`** from `SummaryFooter` (pure refactor + variant props, with
  tests). No behavior change to the board footer.
- **U2 — per-group summary rows** in `GroupSection` (expanded position + visibility rule).
  Depends on U1.
- **U3 — collapsed-group integration** (SummaryRow-over-GroupRollupRow conditional).
  Depends on U1; independent of U2.

## Open questions for review

- **Q1 — Per-group overrides:** is one aggregation per column (uniform across all groups +
  board footer) acceptable, or does "modular" mean a different aggregation per group for
  the same column? This spec assumes uniform (Monday semantics); per-group overrides would
  need a keyed settings map and a scoping UI — a clean later extension if wanted.
- **Q2 — Name-track content of the group row:** plain "Summary" label, or "Summary · N
  items"? (Cosmetic; default: plain "Summary" to match the board footer.)
- **Q3 — Subitems:** aggregates cover top-level rows only (matching every existing summary
  surface). Should any aggregation ever include subitem cells (e.g. time tracking)? Assumed
  no for this iteration.
- **Q4 — Board footer visibility for viewers:** today viewers always see the (possibly
  empty) board footer row. Should the board footer also adopt D3's "earn the row" rule for
  viewers with zero assigned aggregations? Assumed unchanged to avoid touching shipped
  behavior.
