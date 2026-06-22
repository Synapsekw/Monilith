# Date cell — custom calendar (Safari fix) — Design

**Date:** 2026-06-22
**Status:** Awaiting review
**Branch:** `task/date-cell-calendar`

## Problem

Board **date columns** render and behave worse in Safari than in Chrome:

1. **Calendar icon not visible in Safari (in the cell).** The date editor is a bare native
   `<input type="date">` (`src/components/boards/cells/editors/index.tsx:285–311`). Chrome/Blink
   auto-draws a `::-webkit-calendar-picker-indicator` glyph on the right edge of the field — that is
   the "calendar icon" the user sees. **macOS Safari does not render that pseudo-element at all**, and
   no CSS can force it to appear. Hence the icon is missing only in Safari.
2. **The dropdown calendar looks unpolished in Safari.** The dropdown that opens is the **OS-native
   date picker**. Chrome renders its own; Safari renders the macOS one. Native pickers are browser
   chrome, not stylable DOM, so they will always look different across browsers.

Both symptoms share **one root cause**: reliance on the native `<input type="date">` control. The only
robust cross-browser fix is to stop relying on the native control and render our own calendar.

## Decision (locked with user)

- **Approach:** replace the native input in `DateEditor` with a **custom shadcn-style Calendar**
  (`react-day-picker` v9) inside the **existing** Popover primitive (`src/components/ui/popover.tsx`),
  triggered by a visible lucide `Calendar` icon + the formatted date. Renders identical, polished DOM
  in Safari and Chrome and gives a consistent visible icon affordance.
- **Scope:** **single-date** selection only (matches current behavior; NOT a date range).

## Resolved design questions

- **Q1 — `end` preservation semantics.** The value type is `{ date, end? }`. The current editor commits
  `onCommit({ date })`, **silently wiping `end`**. That `end` is consumed by the range system:
  `itemDateRange` (`src/lib/boards/dates.ts`) → spanned across days in `src/lib/boards/calendar.ts:107–111`
  and `src/lib/boards/gantt.ts` (where `start === end` is treated as a _milestone_). So editing a
  multi-day item's start currently collapses its Gantt/Calendar span.
  **Decision: preserve `end` by duration-shift.** If a real range exists (`end > date`), commit
  `{ date: d, end: addDaysISO(d, diffDaysISO(prev.date, prev.end)) }`; otherwise commit `{ date: d }`
  with no synthesized `end`. This never produces `end < date` and matches the existing drag-move logic
  (`applyCalendarEventMove`).
- **Q2 — TimeTrackingCell's two native date inputs** (`src/components/boards/cells/TimeTrackingCell.tsx`
  ~lines 310 and 406): **leave as a noted follow-up.** Different surface; converting now is scope creep.
  Cheap to do later once the Calendar primitive exists.
- **Q3 — trigger look.** The read-only `DateCell` stays **plain text** (faithful to current minimal
  look, no icon clutter in every row). The visible lucide `Calendar` icon + date appears only in the
  **editor**, which auto-opens/focuses the calendar on edit — giving Safari the missing affordance.
- **Q4 — react-day-picker v9 / React 19 / a11y.** Use `mode="single"`. No direct `date-fns` import in
  app code. Theme via `classNames` mapped to Pulse tokens (monochrome + indigo accent, dark-first) with
  lucide chevrons. rdp's built-in accessible keyboard grid replaces the native free-text entry, keeping
  the field keyboard-operable. ISO↔local-`Date` conversion via split-integer parsing to avoid the
  UTC off-by-one.

## Components / units

- **`src/components/ui/calendar.tsx`** — new shadcn-style Calendar primitive wrapping `react-day-picker`
  v9, themed with Pulse tokens. Single responsibility: render an accessible month grid; emit a selected
  `Date`. Depends on `react-day-picker`, lucide icons, `cn`.
- **`DateEditor`** (`src/components/boards/cells/editors/index.tsx`) — rewritten to render a Popover
  whose trigger shows the lucide `Calendar` icon + formatted current value, and whose content is the
  Calendar. Owns the ISO↔Date conversion and the commit logic (incl. `end` duration-shift preservation,
  empty-clears-deletes, Escape-cancels via the existing `useCommitKeys`/`onCancel`).
- **`DateCell`** (read-only) — unchanged (plain text).

## Data flow / performance & data-fetching budget

- **First paint:** unchanged — the board payload already carries date cell values; no new query.
- **Opening the calendar:** pure client state (Popover open + local selected date) — **0 server
  round-trips.**
- **Committing a date:** reuses the existing path `onCommit` → `setCell` → `upsertCell` Server Action
  with optimistic cache mutation + Realtime/`revalidatePath`. **No new round-trip and no refetch
  regression** — identical to today, only the `end`-preservation payload changes.
- **Bounded/indexed:** no list read changes; this is a single-cell editor.

## Schema

**Unchanged.** `dateValueSchema = { date: isoDate, end: isoDate.optional() }`
(`src/lib/validations/boards.ts`). No migration.

## Dependencies

Add `react-day-picker` v9 (pulls `date-fns` transitively; no direct app import). Confirmed compatible
with React 19.2.7, Tailwind v4, radix-ui 1.5, lucide-react 1.18. No `calendar.tsx` exists yet.

## Testing

- **Calendar primitive:** render, day click selects, selected-day styling, keyboard navigation, month
  navigation (prev/next chevrons).
- **DateEditor:** commit a picked date; **`end`-preserve regression** (multi-day range start moves,
  `end` shifts by the same duration); no synthesized `end` for single-day values; empty/clear deletes
  the cell; Escape cancels; calendar auto-opens on edit; ISO boundary (no UTC off-by-one).
- **Note:** the two existing date tests in `editors/cells.test.tsx` and `editors/editors.test.tsx`
  type into the native input via `getByLabelText(/date/i)` — they must be **rewritten** to drive the
  calendar grid.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Execution DAG

Strictly sequential (one unit, no parallel fan-out):

```
Task 0 (add react-day-picker)
   → Task 1 (Calendar primitive + tests)
      → Task 2 (rewrite DateEditor + tests, incl. end-preserve)
         → Task 3 (gate sweep + finish-task merge)
```

Every batch is size 1 — the editor needs the primitive, the primitive needs the dependency. The
critical path is the whole chain.

## How to test (manual, post-merge)

1. Pull `develop`, open any board with a **Date** column (or add one).
2. Click a date cell to edit — a field with a **visible calendar icon** + the date appears, and the
   calendar popover opens.
3. **In Safari and Chrome**, confirm the icon shows and the calendar looks identical/polished.
4. Pick a date → it commits; reopen → the picked date is selected.
5. On an item that has a multi-day range (visible as a span in Gantt/Calendar view), edit its start
   date and confirm the **span keeps its length** (end shifted, not collapsed to a milestone).
