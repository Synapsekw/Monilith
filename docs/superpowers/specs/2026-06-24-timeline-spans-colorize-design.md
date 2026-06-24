# Timeline Spans + Colorize — Design

**Date:** 2026-06-24
**Status:** Approved (brainstorming), pending implementation plan
**Surface:** Timeline view (`GanttBoard`) on boards

## Problem

The Timeline view renders every item as a **dot** (milestone diamond), never a span,
even when an item clearly has a start and an end. Root cause: the view reads a
**single** date column whose value is `{ date, end }`, and treats `end` as absent —
so items collapse to a single-date milestone.

In practice, users keep start and end in **two separate date columns** (e.g. "Start
date" and "End date / Due date"), each holding a single date. The timeline only reads
one of them, so nothing ever becomes a span.

Users also want to **colorize** bars/dots — primarily by **status** — instead of every
item sharing the one accent color.

## Goals

1. Draw a **span** between a start date column and an end date column.
2. Items with **neither** date → hidden in "Unscheduled". Items with **exactly one**
   date → a **dot** at that date. Items with **both** → a span bar.
3. **Colorize** bars/dots by a chosen **status / dropdown** column, using the option's
   stored color. Default (no column chosen) keeps today's single accent.
4. No regression to existing drag/resize, dependency arrows, or legacy single-column
   timelines.

## Non-goals (YAGNI for v1)

Color **legend**, color-by **people/group**, open-ended bars (one date → bar running to
today/edge), and any new column **types**. All deferrable later.

## Decisions (from brainstorming)

- **Column source:** explicit picker (Start + End dropdowns) **with a smart name-based
  default** on first use. The picker always wins and is persisted on first change.
- **Partial dates:** exactly one of start/end present → a **dot** at that date
  (milestone). Neither → Unscheduled.
- **Colorize by:** **status / dropdown** columns only. Default `None` = current accent.
  Item with no value in the color column → neutral gray.

## Design

### 1. View config (no DB migration)

Timeline view config is a `jsonb` column validated by `timelineConfigSchema`
(`src/lib/validations/view-actions.ts`). It is extended — **no schema migration**, since
config is free-form jsonb persisted by the existing `updateBoardView` Server Action:

| Key               | Meaning               | Type           | Notes                            |
| ----------------- | --------------------- | -------------- | -------------------------------- |
| `date_column_id`  | **Start** column      | `uuid \| null` | kept as-is → backward compatible |
| `end_column_id`   | **End** column        | `uuid \| null` | new                              |
| `color_column_id` | column to colorize by | `uuid \| null` | new; status/dropdown only        |
| `zoom`            | `"week" \| "month"`   | unchanged      |                                  |

`timelineConfigSchema` adds `end_column_id` and `color_column_id` as
`z.string().uuid().nullable().optional()`.

### 2. Span derivation (core fix)

`itemDateRange` (`src/lib/boards/dates.ts`) becomes two-column aware. New shape:

```
resolveSpan(itemId, cellValues, startColumnId, endColumnId | null): {
  start?: string;  // YYYY-MM-DD
  end?: string;    // YYYY-MM-DD
} | null
```

Rules:

- **start** = start column cell's `.date` (if present).
- **end** =
  - end column cell's `.date`, when `end_column_id` is set; else
  - start column cell's own `.end` (legacy single-column range boards); else
  - `start` (single date).
- **Both present** → span. **Exactly one present** → dot at that date.
  **Neither** → `null` (Unscheduled).
- **Inverted** (`end < start`): clamp to a dot at `start` — never a negative-width bar.

`buildGanttRows` (`src/lib/boards/gantt.ts`) keeps its existing output contract
(`scheduled / startCol / spanCols / isMilestone / startISO / endISO`). `isMilestone`
becomes "one date only OR start === end". The render layer is mostly untouched.

### 3. Colorization

New pure helper (e.g. `src/lib/boards/timeline-color.ts`):

```
colorForItem(itemId, colorColumn | null, cellValues): string | null
```

- `colorColumn` null → returns `null` → caller uses today's `bg-primary` accent.
- Item's value resolved against the column's options → that **option's color**
  (from the existing swatch palette; options already carry a color).
- Item present in column but no value, or value not matching an option → **neutral gray**.

Rendering: when a color is resolved, the bar/dot uses inline `backgroundColor`. The label
text color is chosen via the existing `contrast.ts` util so text stays legible on any
swatch. When `null`, the existing `bg-primary` / `text-primary-foreground` classes apply
unchanged.

### 4. UI — controls bar

The single "Date by" dropdown becomes three pickers in the existing controls bar:

- **Start** — date columns.
- **End** — date columns + a "None" option.
- **Color by** — status/dropdown columns + a "None" option.

**Smart defaults** (applied only when config has no explicit value): start ←
first date column whose name matches `/start|begin/i`; end ← first matching
`/due|end|finish|target/i`; Color by defaults to None. These are initial defaults only;
an explicit pick is persisted and always overrides.

### 5. Drag / resize (preserve existing behavior)

Bars are draggable/resizable today; the write path generalizes:

- **Move** whole bar → shift the **start column** date and the **end column** date by Δdays
  (two `setCell` writes).
- **Resize** right edge → write the **end column** date only.
- **Legacy single-column** (no `end_column_id`) → keep writing `{ date, end }` to the one
  column (current behavior).
- **Dot** (single date) → move writes that one date in its column.

### 6. Performance & data-fetching budget

Per working-agreement #5 and gotcha-09:

- **First paint:** unchanged — the board cache already loads items, cell values, columns,
  and option colors. No new query.
- **Each interaction** (change Start/End/Color-by): recomputing spans and colors is **pure
  client-side over already-loaded cache data → 0 new server round-trips.**
- The picker choice **is** server data (must survive reload / be shared), so it persists
  via the `updateBoardView` Server Action. But the **visual updates from local state
  instantly**, and we do **not** call `router.refresh()` for these picks (avoids
  re-running every page query). The new pickers use this optimistic-local pattern; the
  existing date picker is aligned to match (drops its `router.refresh()`).
- Reads stay **bounded** by the existing cache — no new queries, no unbounded selects.

### 7. Testing

- **Unit** — `dates` / `gantt` / new `timeline-color`:
  - range from both / one / neither / legacy single-column / inverted dates;
  - `isMilestone` correctness;
  - color: value → swatch, missing value → gray, no color column → accent (null);
  - name-heuristic defaults pick the right columns and yield to explicit config.
- **Component** — `GanttBoard.test`:
  - renders span vs dot vs Unscheduled per the rules;
  - recolors when Color-by changes;
  - changing a picker does **not** trigger a server refetch (optimistic local update).

## Files touched (anticipated)

- `src/lib/validations/view-actions.ts` — extend `timelineConfigSchema`.
- `src/lib/boards/dates.ts` — two-column span resolution.
- `src/lib/boards/gantt.ts` — consume new range; `buildGanttRows` signature.
- `src/lib/boards/timeline-color.ts` — new color helper.
- `src/components/boards/GanttBoard.tsx` — three pickers, colored bars/dots, generalized
  drag/resize writes, optimistic-local config persistence.
- Corresponding `*.test.ts(x)` files.

## Execution / parallelization note

Pure-lib units (span resolution in `dates.ts`, color helper, schema) are independent of
each other and can be built in parallel; `GanttBoard.tsx` wiring depends on all three.
The implementation plan will state the explicit DAG.
