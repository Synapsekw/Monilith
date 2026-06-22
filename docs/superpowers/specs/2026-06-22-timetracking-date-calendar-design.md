# TimeTrackingCell — native date inputs → Calendar primitive (Design)

Status: **spec written, awaiting review**
Date: 2026-06-22
Branch: `task/timetracking-date-cell`

## Goal

Replace the two native `<input type="date">` inputs in `src/components/boards/cells/TimeTrackingCell.tsx` (edit-entry date **lines 310–316**, add-manual date **lines 406–412**) with the Pulse `Calendar` primitive (`src/components/ui/calendar.tsx`), fixing the Safari no-glyph problem — the deferred follow-up named in `docs/superpowers/plans/2026-06-22-date-cell-custom-calendar.md` (lines 105–106).

## Verified against the actual files

- Native date inputs at lines 310–316 (edit) and 406–412 (add-manual).
- Helpers `isoToLocalDate` / `localDateToISO` are **unexported at lines 290–302 of `src/components/boards/cells/editors/index.tsx`**.
- `Calendar` primitive at `src/components/ui/calendar.tsx` (`mode="single"`, `selected`, `onSelect(Date)`, Pulse-tokened).
- **No `end` field** for time entries (single-day) → no range logic.

## Decisions (locked)

1. **Nested-popover:** `TimeTrackingCell` already lives inside a Radix `Popover`. Add a small local `DatePickerButton` sub-component inside `TimeTrackingCell.tsx` — `Popover` + `PopoverTrigger` (button showing the chosen date + calendar icon) + `PopoverContent` with `Calendar`. **Click-to-open** (NOT auto-open like `DateEditor` — the date is one field among several in the row). Deliberate, justified divergence from `DateEditor`'s auto-open.
2. **ISO↔Date conversion — DECISION (A):** Extract `isoToLocalDate` / `localDateToISO` from `editors/index.tsx` into a new shared module `src/lib/boards/iso-date.ts`. Both `TimeTrackingCell.tsx` and `editors/index.tsx` import from it. The `editors/index.tsx` change is a **no-behavior-change import swap**; its public API + tests stay unchanged. (Rejected (B) local copy — duplicates the subtle UTC off-by-one logic.)
3. **State unchanged:** `editDate` / `addDate` stay `YYYY-MM-DD` strings; `onEdit` / `onAddManual` signatures untouched. `Calendar`'s `onSelect(Date)` maps through `localDateToISO`. No range-end logic.
4. **Trigger display (pulse-ui tokens):** button shows the selected date (e.g. "Jun 20") + lucide `Calendar` icon (`size-3.5`); `h-6 px-1.5 text-xs`, `hover:bg-accent`, `focus-visible:ring-ring`, monochrome chrome, brand color reserved for the selected day. `aria-label` for the trigger.

## Performance & data-fetching budget

Pure client-side in-popover interaction. **0 new server round-trips** on open/select; mutations flow through the existing `onEdit` / `onAddManual` callbacks (unchanged). Pagination N/A (fixed small UI).

## Scope

Three files: `src/components/boards/cells/TimeTrackingCell.tsx`, new `src/lib/boards/iso-date.ts`, test `TimeTrackingCell.test.tsx` (+ the no-behavior import swap in `editors/index.tsx`). Single independent unit; disjoint from all other work.
