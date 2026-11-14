# Timeline readability: grouped board Gantt and roll-up-first folder timeline

Date: 2026-11-14
Status: draft, awaiting owner review
Prototype: https://claude.ai/artifact/51CuXHkSrNr2EDyf28M1YE (owner chose "A · Grouped Gantt" for a
single board and "A · Roll-up first" for the folder)

## Problem

Measured on the live deployment on 2026-11-14, on the DAAS folder and its
"Programme Governance & PMO" board:

- Both timelines open scrolled to the earliest date in the data (February 2026), nine months left
  of today. The first screen is empty. There is no scroll-to-today and no Today button.
- The name rail is a fixed 200px (`LABEL_W`). After indent and controls a name gets about 17
  characters, and a truncated name has no tooltip.
- A bar's label is drawn only inside the bar, so a short bar shows "Strate…".
- The board timeline ignores the board's groups. `buildGanttRows` orders by item position only, so
  items from different groups interleave in one flat list.
- The folder timeline opens with every board expanded: 2,127 items, about 80,800px tall, which is
  108 screens. Group bands cannot be collapsed.
- The shared `FilterBar` renders one chip per stage. DAAS has 56, which takes about 200px above
  every Command Center tab.
- The today line is not drawn across section bands, so it reads as broken.

## Goals

1. A timeline opens showing today, with the work around today on the first screen.
2. Names are readable, and a short bar still says what it is.
3. The board timeline keeps the board's group structure.
4. The folder timeline opens as a summary (one row per board) and drills down on demand.
5. Late work is visible without opening items.

## Non-goals

- Packed lanes (prototype option B for boards) and roadmap lanes (option B for folders).
- Milestone markers on a collapsed board's summary row. The prototype showed two; there is no
  existing definition of a "key" milestone, and a board can hold hundreds of single-date items.
  Left out until that is defined.
- Per-item "late" flags in the folder timeline. `folder_timeline` returns date cells only, with no
  status, so an item's done state is unknown there. Adding it needs a migration on the live
  database; the summary rows give the late count instead (see Folder timeline).
- Loading folder items lazily per board. The single `getFolderTimeline` fetch (capped at 5,000
  items by the RPC) stays as it is.
- A left-edge resize handle on bars, and persisting the folder timeline's zoom.

## Design

### 1. Shared canvas (`src/components/boards/gantt/`)

These apply to both timelines because both render `GanttCanvas`.

**Open on today.** After the first layout that has a real track width, `GanttCanvas` sets
`scrollRef.scrollLeft` so today sits 34% of the way across the track. It runs once per mount and
again when `zoom` changes (zoom changes `dayW`, so the old offset is meaningless). It does not run
on data changes, so a drag or a collapse never moves the viewport.

The date range must contain today for this to work. Both range builders (`GanttBoard.tsx` and
`buildFolderTimeline`) widen the range to include today minus 14 days and today plus 30 days. The
existing 3,660-day cap in `timelineDayCount` still applies.

**Today button.** Both toolbars get a "Today" button beside the zoom control. It smooth-scrolls to
the same 34% position. `GanttCanvas` exposes this through a small imperative handle
(`scrollToToday()`), so the toolbars do not reach into the scroller.

**Today line and weekends.** `SectionBand` draws the same today hairline as item rows, so the line
is continuous. Tracks get weekend shading (Saturday and Sunday) at Week and Month zoom only; at
Quarter and Year a day is 4px or less and the stripes would be noise. Shading is one
`background-image` on the track, sized to seven days, offset by the weekday of `rangeStartISO`.

**Resizable name rail.** `LABEL_W` becomes a default (300) rather than a constant. `GanttCanvas`
takes `labelWidth` and `onLabelWidthChange`, and renders a drag handle on the rail's right edge in
the header (the same interaction as the table's `NameResizeHandle`, clamped to 160–520px,
double-click resets to 300). Every use of `LABEL_W` in `GanttCanvas.tsx`, `GanttRowItem.tsx` and
the dependency-arrow maths reads the prop instead.

- Board timeline: persisted in the view's config as `label_width`, through the existing
  `persistConfig` → `updateBoardView` path. One write on drag end, none during the drag.
- Folder timeline: kept in `localStorage` per folder. It is a per-viewer convenience and the
  folder has no view config to hold it. The read is wrapped so a blocked store falls back to 300.

Rail names get a `title` with the full name, on item rows and section bands.

**Labels beside bars.** A bar keeps its inside label when the label fits. When it does not, the
name is dropped from the bar and a short label is drawn to the right of the bar:

- the end date ("Oct 24"), or
- "21d late" in the destructive colour when the item is late.

The name is already in the rail on the same row, so repeating it beside the bar adds nothing; the
date is the missing information. "Fits" is decided from the bar's pixel width against a measured
label width (canvas `measureText`, the approach `BoardTableInner` already uses for name auto-fit),
not from character counts.

**Late bars.** The canvas takes an optional `lateFor(row): number | null` (days late). When it
returns a number, the bar gets a destructive border and the "Nd late" label. The board timeline
supplies it from the same overdue predicate Board Intelligence uses for its "overdue" chip, so the
two never disagree. The folder timeline does not supply it (see Non-goals).

**Row height.** `ROW_H` goes from 40 to 32 and `BAR_H` from 24 to 20. Heights stay uniform for
every row kind, because the arrow overlay and the rows-area height both compute from
`index * ROW_H`. Coarse pointers keep their 44px hit targets through the existing
`pointer-coarse:` padding on the bar and rail controls; the test "touch targets are at least 44px"
must still pass.

**Section summaries.** `GanttRow` gains an optional field used only by section rows:

```ts
summary?: {
  startCol: number;
  spanCols: number;
  donePct: number | null; // null = unknown, draw the span without a fill
  lateCount: number | null;
};
```

`SectionBand` draws it as an 8px bar across the span with a filled portion for `donePct`, and
shows "35% · 8 late" right-aligned in the rail. A section row still has no draggable bar.

**Collapsible group bands.** Today only a level-0 band gets a toggle. `SectionBand` renders the
toggle for any section row when `onToggleExpand` is given, and the callers decide which levels
collapse.

### 2. Board timeline: grouped Gantt (`GanttBoard.tsx`, `src/lib/boards/gantt.ts`)

`buildGanttRows` takes the board's groups and emits, for each group in position order:

1. a section row (`kind: "section"`, `level: 1`, id `group:<id>`) with a `summary`, then
2. that group's items in position order, each followed by its sub-items as today.

A group with nothing on the timeline is skipped, matching what the folder timeline already does.
Undated leaves still go to `UnscheduledSection`.

The summary for a group is computed from its scheduled items: earliest start, latest end, share of
items that are done, and count of late items (same predicate as `lateFor`).

Collapse state is `collapsedGroups` from `useBoardViewPrefs()`. That set already exists and the
table already uses it, so collapsing a group in the table collapses it in the timeline and the
reverse. Sub-item expansion keeps using `expandedItems`.

Dependency arrows need no change: indices come from the visible row list, so a collapsed group's
links disappear and the rest re-index.

The Board Intelligence filter keeps working: it narrows items before grouping, and a group left
with no items is skipped.

### 3. Folder timeline: roll-up first (`TimelineInner.tsx`, `src/lib/folders/timeline.ts`)

**Default state.** `collapsedBoards` (default empty, so everything open) is replaced by
`expandedBoards` (default empty, so everything closed). A new `expandedGroups` set does the same
for group bands. On open the chart shows one row per board. Expanding a board shows its group
bands; expanding a group shows its items. Neither set is persisted.

**Summaries.** `buildFolderTimeline` already resolves every item's span. It also emits a `summary`
for each board band and each group band: the earliest start and latest end of the items under it.
These spans are computed whether or not the band is expanded, in the same pass that today computes
`totals`.

`donePct` and `lateCount` come from the folder payload's `rollup` rows (one per board × group, with
`total`, `done` and `overdue`), which `CommandCenter` already holds. `CommandCenter` passes the
filtered rows to the timeline tab, and `buildFolderTimeline` joins them by board id and group id.
A band with no matching rollup row gets `null` for both and draws its span without a fill.

**Dependency links.** With every board collapsed there are no item rows, so no arrows and no stubs
are drawn. The "N late links" counter is computed from totals that do not depend on collapse, so it
stays correct.

**Truncation and "no dates".** Both notices keep their current behaviour.

### 4. Stage filter (`src/components/folders/FilterBar.tsx`)

`FilterBar` is shared by every Command Center tab. When a folder has more than eight stages it
renders one "Stages" button that opens a searchable list (the existing `Command` popover), showing
the selected stage's name and colour dot on the button. With eight or fewer it keeps today's chip
row. The URL contract (`?stage=`) does not change.

This changes the filter on the Overview, Stages, Boards and People tabs too, not only Timeline.

## Performance and data-fetching budget

- **First paint:** unchanged. The board timeline renders from the board cache. The folder timeline
  makes its one `getFolderTimeline` call when the tab first mounts.
- **Interactions with 0 server round-trips:** scroll to today, Today button, zoom, expand or
  collapse a board, group or parent item, rail resize while dragging, stage filter (already URL
  state through the History API).
- **Interactions that write:** rail width on a board timeline writes once on drag end through
  `updateBoardView`, with no revalidation and no refetch. Bar move and resize are unchanged.
- **Bounded reads:** the folder RPC keeps its 5,000-item cap. Rows stay virtualized. Roll-up-first
  drops the mounted row count on open from thousands to the number of boards.

## Independent units

- **U1 canvas:** today scroll and button handle, range padding helper, today line on bands,
  weekend shading, rail resize, outside labels, late styling, row height, section summary, group
  toggle.
- **U2 board grouping:** group-aware `buildGanttRows`, summaries, `collapsedGroups`, `lateFor`,
  `label_width` in view config.
- **U3 folder roll-up:** `expandedBoards` / `expandedGroups`, summaries joined to rollup rows,
  rail width in `localStorage`.
- **U4 stage menu:** `FilterBar`.

U1 and U4 share no files and can run together. U2 and U3 both consume U1's new props and touch
different files from each other, so they run together after U1.

## Testing

- `gantt.test.ts`: rows come out grouped in group order; a group with nothing scheduled is
  skipped; summary span, done share and late count; range widens to include today.
- `timeline.test.ts`: all boards collapsed by default leaves only board bands; expanding a board
  yields group bands, expanding a group yields items; summary spans are present while collapsed;
  rollup join, including a band with no rollup row.
- `GanttCanvas.test.tsx`: scrolls to today once on mount and again on zoom change, not on a data
  change; a group band toggles; summary bar and meta text render; outside label appears when the
  inside label does not fit; late bar styling; rail handle clamps and reports the width.
- `GanttBoard.test.tsx` and `Timeline.test.tsx`: Today button; rail width persists (one
  `updateBoardView` call on drag end, `localStorage` for the folder); existing drag, resize, link
  and touch-target tests still pass at the new row height.
- `FilterBar` test: chips at eight stages, menu at nine; selecting a stage sets `?stage=`.
- jsdom renders no layout, so the 34% scroll position, weekend stripe alignment and label-fit
  decision are verified in a browser against the built CSS before merge, and on the live DAAS
  folder after.

## Open question for the owner

The folder summary's late count comes from the rollup's `overdue` (due date passed, not done).
The board timeline's "late" uses the Board Intelligence overdue predicate. These should be the same
rule; the plan must confirm that against the code before any work starts, and if they differ this
spec uses the Board Intelligence rule in both places.
