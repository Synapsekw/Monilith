---
type: plan
phase: 6d-3
status: awaiting-review
date: 2026-06-21
spec: "[[2026-06-21-phase-6d3-mirror-aggregation-design]]"
---

# Plan — Phase 6d-3 Mirror aggregation (column-summary footer)

Implements the locked spec. **TDD throughout** (RED → GREEN per unit). Migration-free.
Gate before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Performance budget (carried from spec §4)

0 first-paint round-trips; pick-aggregation = 1 Server Action + optimistic
`replaceColumn`; cell edit recomputes client-side. Aggregation O(loaded rows),
memoized per column.

## Tasks

### U1 — Validation + aggregation catalogue (ROOT)

- Add `AggregationId` union + `aggregationSchema` and a shared `baseColumnSettingsSchema`
  (`{ summary_aggregation?: AggregationId }`) merged into every per-kind settings schema
  in `src/lib/validations/boards.ts`.
- Add pure `allowedAggregations(kind: ColumnKind): AggregationId[]` encoding the D4 matrix
  (mirror delegates to its resolved target kind).
- **Consumes:** existing `ColumnKind`, per-kind settings schemas.
- **Produces:** `AggregationId`, `aggregationSchema`, `baseColumnSettingsSchema`,
  `allowedAggregations`.
- Tests: `validations/boards.test.ts` (schema accepts/rejects), `aggregation.test.ts`
  (matrix per kind, mirror delegation).

### U2 — Aggregation engine

- New pure `src/lib/boards/aggregation.ts`: `aggregate(kind, aggId, values): AggregateResult`
  implementing avg/min/max + the count family, delegating sum/distribution/checked-total/
  time-tracking to the existing `rollupCell` / `rollupTimeTracking` reducers (no
  duplication).
- **Consumes:** U1 (`AggregationId`), `rollup.ts`.
- **Produces:** `aggregate`, `AggregateResult`.
- Tests: `aggregation.test.ts` — each reducer, null/empty handling, count-unique.

### U3 — FooterCell + aggregation picker UX ‖ (parallel with U4)

- New `src/components/boards/FooterCell.tsx` generalizing `RollupCell` to render an
  `AggregateResult`; empty when no aggregation chosen.
- Footer-cell click → popover listing `allowedAggregations(kind)` → calls `updateColumn`
  (Server Action) writing `summary_aggregation` to `columns.settings`, optimistic
  `replaceColumn`.
- **Consumes:** U1, U2; existing `updateColumn` action + `replaceColumn` cache mutation.
- **Produces:** `FooterCell`, the picker.
- Tests: `FooterCell.test.tsx` (render per result kind; picker lists correct options;
  optimistic update).

### U4 — Mirror aggregation wiring ‖ (parallel with U3)

- Resolve a mirror column's footer: flatten `mirrorValuesForCell` across loaded items →
  feed `aggregate(targetKind, aggId, flattened)`. Replace the `mirrorRollup()` placeholder
  usage path; keep `mirror.ts` pure.
- **Consumes:** U1, U2, `mirror.ts` (`mirrorValuesForCell`/`mirrorTargetColumnFor`).
- **Produces:** mirror footer value helper.
- Tests: `mirror.test.ts` — aggregate-of-mirror, multi-link flatten, RLS-null handling.

### U5 — Footer surface in BoardTable (single writer)

- Render the sticky non-virtualized footer row inside `scrollContainerRef` after the
  `GroupSection`s, reusing `gridTemplate(columns, liveWidths, nameWidth)` + the Name
  freeze tokens (`sticky left-0`, `NAME_FREEZE_EDGE`), z-index 15.
- Wire each column's `FooterCell` to U2/U4 over the loaded top-level rows (memoized);
  exclude subitems (F1).
- **Consumes:** U3, U4; BoardTable layout internals.
- **Produces:** the live footer.
- Tests: BoardTable render test — footer present, aligned column count, value reflects
  cache; recomputes on cell edit.
- NOTE: single writer of `BoardTable.tsx` to avoid conflicts — do not parallelize with
  any other BoardTable edit.

### U6 — e2e + full gate

- Playwright: add a Numbers + a mirror column, pick Sum / target-matrix agg, assert footer
  values; edit a cell, assert footer updates.
- Run full gate; confirm migration-free (no new files in `supabase/migrations/`,
  `db:types` unchanged).

## Execution DAG

```
U1 ──> U2 ──> ┌─ U3 ─┐
              │      ├──> U5 ──> U6
              └─ U4 ─┘
```

- **Edges:** U2←U1; U3←{U1,U2}; U4←{U1,U2}; U5←{U3,U4}; U6←U5.
- **Parallel batch:** {U3 ‖ U4} (disjoint files: FooterCell/picker vs mirror.ts helper).
- **Critical path:** U1 → U2 → (U3|U4) → U5 → U6 (5 stages; U5 is the single-writer
  bottleneck on `BoardTable.tsx`).

## Out of scope / deferred

Per-group subtotals; non-Table views; server-side aggregation beyond the loaded-row
bound. F1–F3 defaults per spec §5 — flip on review if desired.
