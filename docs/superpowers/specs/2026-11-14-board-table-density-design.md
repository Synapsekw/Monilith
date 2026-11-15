# Board table: readable names, one column header, dense rows, fitted and centered columns

Date: 2026-11-14
Status: draft, awaiting owner review
Prototype: https://claude.ai/artifact/M4UGM3CFfRVzz2NDUiY4zZ (owner chose "C · Hover peek",
"C · Slim + one header", "Dense 28", "Fit to content", and added: center the column content)

## Problem

Measured on the live deployment on 2026-11-14, on DAAS → "Programme Governance & PMO":

- The Name column is 433px wide and the name text gets 236px. The rest is a 72px gutter (checkbox,
  drag handle and chevron slots, all invisible until hover), 32px of padding, and 92px held open
  for three buttons that only appear on hover. 32 of 33 visible names were cut off. Names average
  65 characters.
- Each group repeats the full column header, and the group's title shares the Name cell with four
  controls. The title is a mono, uppercase, wide-tracked kicker with an "01 /" index, so it
  truncates ("PROGRAMME GOVERNANCE…") and reads like a column label. The header scrolls away, so
  deep inside a 52-item group the columns have no labels.
- The board has 22 columns and is 4,615px wide on a 1,366px viewport. Columns without a saved
  width default to 180px whatever they hold: a date, "MVP" and "P0" each get 180px.
- Rows are 42px. About 20 fit on a screen.

## Goals

1. A name is readable in place when it fits, and in full on hover when it does not.
2. Column labels are always visible, once, and group titles read as titles.
3. About 40% more rows per screen.
4. Columns take the width their content needs.
5. Value columns are centered.

## Non-goals

- Wrapping names to two lines, and a user-selectable density. Row height becomes 28px for
  everyone on a mouse or trackpad. A per-user setting can be added later on the existing profile
  preference path (`profiles` column → `<html data-*>` attribute); nothing here blocks it.
- Hiding columns and saved column sets ("Focus set" in the prototype).
- Any change to Kanban, Calendar or the item panel.

## Design

### 1. Name cell (`table/NameCell.tsx`, `table/ItemRow.tsx`, `lib/boards/name-column-width.ts`)

**Gutter.** Today the leading area is three 24px slots plus 16px of name padding. It becomes:

- drag handle, 16px, visible on row hover;
- select checkbox, 20px, visible on row hover or when selected;
- sub-item chevron, 20px, rendered only when at least one item on the board has sub-items. When
  none does, the slot is not reserved on any row, so names stay aligned with each other.

The name's own padding drops from 16px each side to 4px left and 8px right.

**Hover buttons.** Open-panel, add-sub-item and the row menu stop reserving 92px. They become an
overlay pinned to the right edge of the Name cell, shown on row hover and on keyboard focus, over
a short fade to the row's background so the name does not collide with them.

With the same 433px column, the text gets about 380px instead of 236px.

**Hover peek.** When a name is still truncated (checked on pointer enter:
`scrollWidth > clientWidth`), resting on the row for 200ms unrolls the full name on one line,
over the neighbouring cells, with the three buttons at its end. It also appears on keyboard focus
of the name. It is capped at the visible width of the scroller; a name longer than that keeps an
ellipsis, and every name carries the full text as `title`.

The peek is a single line on purpose. Each virtual row is its own stacking context (it is
positioned with a transform), so anything that overflowed downward would be painted over by the
next row.

It does not appear while the name is being edited, while a row is being dragged, or on coarse
pointers.

**Touch.** On coarse pointers the controls stay as they are today: always visible, 44px, in the
normal layout flow, with no overlay and no peek. The existing "touch targets (coarse pointer)"
tests keep passing unchanged.

**Auto-fit.** `fitNameColumnWidth` adds fixed "chrome" reserves to the measured text
(`TOP_LEVEL_CHROME_EDITOR = 197`, `TOP_LEVEL_CHROME_VIEWER = 173`, `SUBITEM_CHROME = 129`). These
are recalculated for the new gutter and no longer include the hover buttons, so an auto-fitted
column is as wide as its longest name needs, up to the existing 640px cap. A saved
`boards.name_column_width` is still respected.

### 2. One column header, slim group rows (`table/BoardTableInner.tsx`, `table/GroupHeaderRow.tsx`, `table/GroupSection.tsx`)

**Board column header.** A new `BoardColumnHeader` row is rendered once, as the first child of the
scroll container's content, `sticky top-0`, 30px tall, on the same grid template as the rows. It
takes over everything column-related that `GroupHeaderRow` renders today: the frozen "Item" cell
with `NameResizeHandle`, one `SortableColumnHeader` per column inside a single `DndContext`, the
two Created headers, and `AddColumnMenu`.

Because the header no longer belongs to a group, a new or empty group still shows the board's
columns. That was the reason every group rendered its own header.

**Group row.** `GroupHeaderRow` becomes a 30px divider that spans the full width. Its content sits
in an inner block that is `sticky left-0` and as wide as the visible scroller, so the title stays
in view during horizontal scroll. Left to right:

- select-all checkbox and drag handle (hover, as today);
- collapse chevron;
- the group's colour dot;
- the title in Inter 13.5px semibold, sentence case as the user typed it. No kicker, no index
  number, same tone for every group;
- the item count as a small chip;
- a progress meter and "36% done", when the board has a status column. "Done" uses the board's
  existing done rule (the one Board Intelligence's overdue check relies on). No status column, no
  meter;
- the group menu.

The row is `sticky` under the column header (`top: 30px`) inside its own group section, so the
current group's title stays pinned while its rows scroll and is pushed out by the next group.

Renaming, colour, delete, reorder and collapse behave as they do now.

**Stacking.** Column header above group row above the frozen Name cells (`z-10`) and the row
hairline (`z-20`); all below the sticky board total (`z-[15]` today, to be re-ordered so the
header and total never overlap incorrectly) and below menus. The plan sets exact values and the
change is checked in a browser, since jsdom cannot show stacking.

**Virtualizer.** Each group's `scrollMargin` is already measured with a `ResizeObserver`, so the
new header's height is picked up without a new constant.

### 3. Dense rows (`table/shared.ts` and its consumers)

- `ROW_HEIGHT` 42 → 28, `SUBITEM_ROW_HEIGHT` 38 → 26.
- On coarse pointers rows stay at 44px, because the 44px touch targets cannot fit in less. The
  height therefore comes from one source that both CSS and the virtualizer's `estimateSize` read
  (a small `useRowHeight()` hook over `(pointer: coarse)`), instead of a bare constant. Actual
  heights are still measured by `measureElement`.
- Item name 13.5px → 13px, cell text 13px → 12.5px, horizontal cell padding 16px → 8px. The name
  measuring font (`NAME_MEASURE_FONT_SIZE`) changes with it; the test that keeps the two in step
  stays.
- Inline editors that are 28px tall (`h-7`) become 24px so they fit inside the row.
- Avatars and any control taller than 24px inside a cell are reduced to fit. `ColorChip` is 20px
  tall and stays as it is.
- Consumers to update: `ItemRow`, `SortableSubitemRow`, `GroupRollupRow`, `GroupSection` (empty
  group min-height), and the board `loading.tsx` skeleton. Two stale "36px row" comments are
  corrected.

Rows on a 879px board viewport go from about 20 to about 28, after the header and group row.

### 4. Columns fit their content (`table/shared.ts`, `ColumnHeader.tsx`, `lib/boards/`)

Value columns work the way the Name column already does: **no saved width means auto-fit**.
`gridTemplate` resolves each track as `liveWidths[id] ?? column.width ?? autoFit[id]`, where
today the last fallback is the constant 180.

So every column the user has never resized is fitted the moment this ships, and every column they
have resized keeps its width.

**Measuring.** A pure function `fitColumnWidth(column, values, measure)` in `src/lib/boards/`,
beside `name-column-width.ts`:

| Column type                                    | Width                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| text, link, email, phone                       | widest value, measured with canvas `measureText` at the cell font |
| number, currency                               | widest formatted value                                            |
| status, dropdown                               | widest option label that is in use, plus chip padding             |
| people                                         | avatar plus the longest name shown                                |
| date                                           | fixed, from the date format                                       |
| checkbox, rating, percent                      | fixed per type                                                    |
| files, relation, mirror, time tracking, rollup | 180, as today (not measured)                                      |

Every result is at least as wide as the column's header label and menu button, and is clamped to
72–360px. Created-by and Created-at become fixed, narrower widths.

**When it runs.** After hydration, and again when the set of columns or the number of items
changes. It does not re-run on each cell edit, so a column never changes width while someone is
typing in it. Before hydration the template uses 180, as the Name column uses its minimum today.

**Controls.**

- Double-clicking a column's resize handle clears its saved width (back to auto-fit), matching the
  Name column.
- The board's "⋯" menu gets "Fit all columns", which clears every saved column width and the saved
  Name width in one Server Action.

**Server.** `resizeColumn` accepts `null` (Zod schema and `resizeColumnCore`). A new
`resetColumnWidths({ boardId })` action clears widths for the board's columns. Both are RLS-scoped
writes with optimistic cache updates and no revalidation, like `resizeNameColumn`. If
`columns.width` has a constraint that rejects null, a migration (minted with
`scripts/new-migration.sh`) relaxes it; the plan checks the live schema first.

### 5. Centered columns (`cells/index.tsx`, `table/EditableCell.tsx`, `ColumnHeader.tsx`, `FooterCell.tsx`, `SummaryRow.tsx`, `RollupValueCell.tsx`)

Every value column centers its content horizontally: pills, people, dates, numbers, text,
checkboxes, ratings, files, relations and the Created columns. The Name column stays
left-aligned.

- Cell wrappers gain `justify-center`; truncating text cells gain `text-center`.
- Column header labels are centered. The menu button is taken out of the flow and pinned to the
  right edge, so the label is centered on the column, not on the space left of the button.
- Summary, footer and roll-up cells are centered to match the column above them, and their
  padding (`px-3` today) is brought in line with the cells.
- Inline text editors are centered too, so the text does not jump sideways when a cell enters
  edit mode.

## Performance and data-fetching budget

- **First paint:** no new queries. Fitting uses data already in the board cache.
- **Interactions with 0 server round-trips:** hover peek, collapse, scrolling with sticky rows.
- **Interactions that write:** clearing one column width (one action), "Fit all columns" (one
  action). Neither revalidates or refetches.
- **Cost of fitting:** one `measureText` per value for measured column types. On the largest DAAS
  board that is on the order of tens of thousands of calls, run once after hydration and not on
  cell edits. The plan measures it on that board; if it exceeds a frame budget worth caring about,
  it moves to an idle callback.
- **Rendering:** fewer DOM nodes than today, because per-group column headers (22 header cells per
  group) are replaced by one.

## Independent units

- **U1 density:** row-height source, type sizes, paddings, consumers.
- **U2 name cell:** gutter, overlay buttons, hover peek, chrome reserves.
- **U3 header and group row:** `BoardColumnHeader`, slim `GroupHeaderRow`, sticky stacking.
- **U4 column fit, logic:** `fitColumnWidth`, `resizeColumn(null)`, `resetColumnWidths`.
- **U5 column fit, UI, and centering:** `gridTemplate` fallback, double-click reset, "Fit all
  columns", centered cells, headers and footers.

U1 and U4 share no files and can run together. U2 and U3 both follow U1 (they edit rows whose
height U1 changes) and touch different files from each other. U5 follows U3 and U4, because it
edits the column headers U3 moves and consumes U4's function.

## Testing

- `shared.test.ts`: new row heights; name measuring font stays in step with the rendered font.
- `name-column-width` tests: new chrome reserves; hover buttons no longer counted.
- `NameCell.test.tsx`: overlay buttons are not in the layout flow on fine pointers and are on
  coarse pointers; peek appears only for a truncated name, not while editing; `title` carries the
  full name; existing seam, selection and hairline tests still pass.
- `BoardTable.test.tsx`: exactly one column header for a board with several groups; an empty
  group still sits under it; group row shows the title as typed, with no index; column reorder
  and Name resize work from the single header; freeze-edge and hairline assertions move to the new
  header; virtualization still mounts a window of rows; coarse-pointer tests unchanged.
- New `fit-column-width` tests: each column type, header-label floor, clamps, empty column.
- `ColumnHeader.test.tsx`: double-click clears the width; label is centered with the menu pinned.
- Cell, footer and summary tests: centered alignment.
- Action tests: `resizeColumn` with null; `resetColumnWidths` is scoped to the board and to
  editors.
- Print styles and the loading skeleton are checked against the new structure.
- In a browser, against the built CSS, before merge: sticky header and group row stacking during
  vertical and horizontal scroll, the peek over neighbouring cells, the overlay fade on hover and
  selected rows, 28px rows with every cell type, light and dark, and an iPad-sized coarse-pointer
  emulation. Then on the live DAAS board after promotion.

## Open question for the owner

Centering applies to long free-text columns too (Milestone, Notes, Definition of done). Centered
text that is cut off with an ellipsis can look uneven. The spec centers everything as asked; say
so if long-text columns should stay left-aligned.
