# TimeTrackingCell date → Calendar primitive — Implementation Plan (TDD)

Status: **plan written, awaiting review**
Spec: `docs/superpowers/specs/2026-06-22-timetracking-date-calendar-design.md`
Branch: `task/timetracking-date-cell`

> TDD (RED → GREEN → refactor). Gate before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Tasks (single small unit — sequential)

### T1 — Extract shared ISO helpers

- **Produces:** `src/lib/boards/iso-date.ts` exporting `isoToLocalDate(iso: string): Date` and `localDateToISO(d: Date): string`, moved verbatim from `editors/index.tsx` lines 290–302 (preserve the local-conversion logic that dodges the UTC off-by-one).
- Update `src/components/boards/cells/editors/index.tsx` to import from the new module (no-behavior-change swap; its existing tests must stay green untouched).
- **Tests:** small unit on `iso-date.ts` — round-trip a date across a DST/timezone edge; assert no off-by-one (`localDateToISO(isoToLocalDate("2026-06-20")) === "2026-06-20"`).
- **Consumes:** nothing.

### T2 — `DatePickerButton` + swap both inputs _(depends T1)_

- **Produces:** local `DatePickerButton` sub-component in `TimeTrackingCell.tsx` (`Popover` + `PopoverTrigger` button + `PopoverContent` + `Calendar mode="single"`). Click-to-open. Replace the edit input (310–316) and add-manual input (406–412). Map `onSelect(Date)` → `localDateToISO` → existing `editDate`/`addDate` state. pulse-ui tokens per spec (`h-6 px-1.5 text-xs`, lucide `Calendar` `size-3.5`, `hover:bg-accent`, `focus-visible:ring-ring`, `aria-label`).
- **Tests (new describe blocks in `TimeTrackingCell.test.tsx`):**
  - (a) add-manual picker opens → calendar `grid` visible → picking a day commits the correct local ISO via `onAddManual`.
  - (b) edit picker seeded with the entry's date → picking a new day calls `onEdit` with correct local ISO + parsed duration.
  - (c) **migration guard:** no `input[type=date]` in the rendered popover.
  - (d) **off-by-one pin:** pick a specific day, assert exact `YYYY-MM-DD`.
- **Consumes:** T1 helpers, `Calendar` primitive.

## Execution DAG

- **Edge:** T2 ← T1.
- **Batches:** B1 = T1; B2 = T2. Critical path depth 2. (Too small to parallelize across worktrees — sequential within one session.)

## Notes

- Nested popover: ensure the inner date popover doesn't dismiss the outer time-tracking popover (Radix handles nested portals; verify focus return on close).
- No schema, no server action, no migration. Pure UI + a helper extraction.
- Out-of-scope follow-up satisfied from `2026-06-22-date-cell-custom-calendar.md` lines 105–106.
