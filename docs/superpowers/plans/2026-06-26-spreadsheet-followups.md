# Plan: board-spreadsheet import/export — 3 review follow-ups

Scope fixed by brief; no brainstorming. All under `src/lib/boards/spreadsheet/` +
`src/lib/boards/spreadsheet-actions.ts`. Three independent sub-items, each TDD (failing test
first), each its own commit. Lib + tests only — no UI, no DB migration.

## (a) Cells-error rollback test (test-only)

The `cellsError` rollback in `commitImport` (delete board on cell_values insert failure) is
untested; the symmetric `itemsError` branch is. Mirror the existing
`"deletes board and returns fail when phase-2 items insert errors"` test: drive a file with a
subitem that has a status cell so `cellRows.length > 0`, make `cell_values.insert` fail, assert
`boards.delete().eq("id","b1")` ran and the result is `{ok:false}` surfacing the cell error.

- Produces: a new test in `spreadsheet-actions.test.ts`. No source change.

## (b) Tighten date / single-value status over-detection (`detect.ts`)

`inferKind` over-classifies:

- **Date:** `Date.parse` accepts far too much (`"3"`, `"May"`, `"Item A"` on some engines,
  bare years). Tighten `isDateLike` to a strict set of shapes only: `YYYY-MM-DD`,
  `YYYY/MM/DD`, `MM/DD/YYYY`, `DD/MM/YYYY` (and ISO datetime starting `YYYY-MM-DDT…`) — i.e.
  require an explicit full Y-M-D date, then confirm it actually parses. No bare `Date.parse`
  fallback.
- **Status:** a single distinct value (`distinct <= 1`) is not a status (it's a constant /
  likely text). Require `distinct >= 2`. Keep the existing `<= 12` and `<= ceil(n/2)` caps.

- Produces: tightened `inferKind`/`isDateLike` in `detect.ts`; new/extended cases in
  `detect.test.ts`. Existing passing cases stay green (the two-distinct status fixtures and the
  `YYYY-MM-DD` date fixture already satisfy the stricter rules).

## (c) People-column name export (`cell-codec.ts` + `export-workbook.ts` + `spreadsheet-actions.ts`)

`cellToText("people", …)` returns blank. Thread a name resolver through the pipeline:

- `cellToText` gains an optional trailing `resolvePeopleName?: (userId: string) => string | null`
  arg. In the `people` case, map `userIds` → resolved names, drop unresolvable ones, join with
  `, `. Blank when none resolvable or no resolver. Never throws.
- `buildExportWorkbook` gains an optional `peopleNames?: Map<string, string>` param, passed into
  every `cellToText` call as a resolver `(id) => peopleNames.get(id) ?? null`.
- `exportBoard` collects all `userIds` from people-kind cells, reads `profiles(id, full_name)`
  for them (RLS-scoped), builds the map, passes it to `buildExportWorkbook`. Falls back
  gracefully — unresolved id → omitted; no people cells → no extra query.

- Produces: people names in exported xlsx/csv. Update `cell-codec.test.ts` (the
  "renders people as blank" case becomes resolver-driven).

## Execution DAG

Three independent sub-items (a, b, c) — no shared files beyond the test file for (a). Could run
in parallel, but they're small; executed sequentially in one session, separate commits.
Critical path = whichever is largest (c). No cross-dependencies.

## Gates

`pnpm typecheck && pnpm lint && pnpm test --project unit && pnpm build` (skip integration).
