# Subitem-aware summaries + group / master rows

**Date:** 2026-07-05
**Branch:** `task/subitem-summaries`
**Status:** Approved design → ready for implementation plan

## Problem

The board table's column-summary footer computes an aggregation (avg, sum,
count, distribution, …) per column. A user set **Average** on a **percent**
column and saw nothing.

Root cause (confirmed against the dev DB, not inferred):

- The column's data lives **entirely on subitems** — 82 percent cells, all on
  rows with `parent_id is not null`, **0 on top-level items**. The choice
  `avg` is correctly persisted in `columns.settings.summary_aggregation`, and
  every value is correctly shaped `{ percent: number }` (0–100).
- A parent row's percent cell is a **rollup** — it _displays_ the average of its
  subitems (`src/lib/boards/rollup.ts:109-124`) but that value is **derived at
  render time and never stored**.
- The summary footer aggregates **only top-level items' raw stored cell
  values**: the master footer over `topLevel` (`BoardTable.tsx:784`), each group
  row over its group's top-level rows (`BoardTable.tsx:1647`). No top-level row
  has a stored percent → `footerColumnValues` returns all `null` →
  `numericValues` returns `[]` → `aggregate` hits the `nums.length === 0`
  early-return (`src/lib/boards/aggregation.ts:140`) → `EMPTY` → renders nothing.

So the user _sees_ rolled-up percent bars on parent rows but the footer cannot
see any of that data. The pure aggregation math is correct and unit-tested
(`aggregation.test.ts:143` averages a percent column to 75 with
`style: "percent"`); the defect is purely in **which rows the summary counts**.

This same "which rows" question is the substance of the follow-up request:
per-group "Group Summary" rows plus one master total.

## Decisions (locked with the user)

1. **Summary math = true average of _all_ filled cells**, subitems included.
   Flatten across depth and weight every stored cell equally. (Chosen over
   "average of the rolled-up parent values", which weights each parent equally
   regardless of subitem count.)
2. **This applies to _every_ aggregation, board-wide** — Count / Sum /
   Distribution / etc. now include subitems too (e.g. 5 parents × 3 subitems →
   Count = 20, not 5). Explicitly approved.
3. **Group summaries:** each group shows its own **"Group Summary"** row, always
   visible (collapsed _and_ expanded), and counts that group's subitems.
4. **Master summary:** one distinct **"Total"** footer at the bottom, a grand
   total across **all** board items (every top-level item + all their subitems).

## Key insight

`aggregate(kind, aggId, values, …)` and `footerColumnValues(col, itemIds, …)`
are already **pure over a list of item IDs**. Today those lists are top-level
only. Every requirement above reduces to **expanding the ID set to include
subitems**, plus labeling. The pure aggregation math — and its passing tests —
stays **untouched**.

## Design

### Unit 1 — `withSubitems(itemIds, childrenByParent)` (pure helper)

**Location:** `src/lib/boards/item-tree.ts` (beside `bucketItems`, which already
produces `childrenByParent`).

**Signature (conceptual):**

```
withSubitems(
  itemIds: readonly string[],
  childrenByParent: ReadonlyMap<string, readonly { id: string }[]>,
): string[]
```

**Behavior:** returns `itemIds` plus all descendant IDs, in a stable order
(each parent immediately followed by its children, depth-first), each ID once.
Recursion handles the current two-level tree and any future deeper nesting.
Must be **cycle-safe** (a `seen` set guards against a malformed
`parent_id` cycle so it can never loop). Pure — no DOM/IO.

**Why a shared helper:** it becomes the single source of truth for "which rows
a summary counts," used identically by the master footer and every group row, so
the two can never drift.

### Unit 2 — Wiring in `BoardTable.tsx` (no server round-trips)

All aggregation stays pure + client-side over the already-loaded cache
(0 new fetches — satisfies the AGENTS.md hot-path budget). `SummaryRow` and
`footerColumnValues` are **unchanged**; they simply receive an expanded ID list.

- **Master footer** (`BoardTable.tsx:780`): pass
  `withSubitems(topLevel.map(i => i.id), childrenByParent)` → grand total across
  all board items. `label="Total"`.
- **Group rows** (`BoardTable.tsx:1641` collapsed, `:1734` expanded): pass
  `withSubitems(groupItems.map(i => i.id), childrenByParent)` → each group counts
  its own subitems. `label="Group Summary"`. Rendered in **both** collapsed and
  expanded states whenever a summary is assigned (dedupe the two paths so they
  stay consistent). `childrenByParent` is already threaded into `GroupSection`
  (`BoardTable.tsx:757`), so no new prop plumbing is needed.

`footerColumnValues`' existing per-kind branches already key off the ID list:
default (`cellMap.get(cellKey(id, col.id))`), mirror (`mirrorFooterValues(…,
itemIds)`), and time_tracking (per-id time entries) all pick up subitem rows for
free once the expanded list is passed.

### Labels

`SummaryRow` already accepts a `label` prop (default `"Summary"`). Group rows →
`"Group Summary"`; master → `"Total"`. No structural change to the row.

### Semantics confirmed

- Every **stored** cell is counted **exactly once**. Rollup parent values are
  render-only (for percent the parent's stored cell is `null`), so they are
  never double-counted against their subitems.
- A parent that has _both_ a stored value and subitems (possible for
  numbers/currency, never for rollup-only percent) contributes its own stored
  cell _plus_ each subitem cell — one count per real stored cell. This is the
  direct, predictable reading of "count every cell once."

## Testing

- **Unit — `withSubitems`** (`item-tree.test.ts`): flattens two-level tree in
  stable order; IDs unique; deeper nesting; cycle-safe; empty input.
- **Unit — aggregation over expanded set:** percent `avg` over subitem-only data
  returns the true mean (not `EMPTY`); Count includes subitems.
- **Component — `SummaryRow` / BoardTable:** a group row and the master row
  compute distinct, correct values when data lives on subitems; "Group Summary"
  and "Total" labels render; group rows appear collapsed and expanded.
- **E2E — `e2e/summary-footer.spec.ts`:** update expectations for subitem
  counting + the new labels.
- Existing `aggregation.test.ts` is unaffected (pure fn unchanged) and must stay
  green.

## Performance & data-fetching budget (AGENTS.md invariant #5)

- **First paint:** unchanged — summaries already render from loaded cache.
- **Each interaction:** picking an aggregation persists only the per-column
  choice (existing server action); computing values is pure client-side over the
  in-memory cache. **0 new server round-trips.**
- `withSubitems` is O(items) and memoized alongside the existing per-column memo;
  no unbounded reads introduced.

## Execution DAG (AGENTS.md invariant #6)

Small, cohesive change with a linear dependency chain:

- **Task 1 — `withSubitems` helper + unit tests.** No dependencies.
- **Task 2 — wire master + group summaries to the expanded set; add labels;
  make group rows consistently visible.** Depends on Task 1.
- **Task 3 — component/E2E tests + gate run.** Depends on Task 2.

Dependencies: 2 → 1, 3 → 2. Parallel batches: `[1]`, `[2]`, `[3]`. Critical path
= 1 → 2 → 3 (the whole chain). The tasks are genuinely sequential and small
enough that a single agent carries them end-to-end; there is no parallelizable
batch to fan out.

## Out of scope

- No schema/migration changes (choice already persists in `columns.settings`).
- No change to the pure `aggregate()` math or the rollup cell rendering.
- No new aggregation types.
