# Command Center "Tower": an Overview that shows trend, forecast and where the load is

Date: 2026-11-14
Status: draft, awaiting owner review
Prototype: https://claude.ai/artifact/MdLjAYXX6cahHAgK75gdJA (owner chose "B · Tower")
Extends: `2026-09-15-folder-command-center-design.md`, `2026-09-24-folder-command-center-layouts-design.md`

## Problem

Observed on the live deployment on 2026-11-14, on the DAAS folder (11 boards, 1,953 items) and the
CRM folder (1 board, 31 items):

- Six KPI cards carry equal weight. On DAAS two of them read "1" and "0". No card says whether a
  number is getting better or worse.
- "Needs attention" shows 20 rows out of 601 overdue items. All 20 are from one board and one
  group and all read "overdue · 46d".
- The burn chart's completed line is a flat step. An item's done date is the status cell's
  `updated_at` (`_folder_item_flags`, `20260915142403…sql:189`), so a bulk edit or an import puts
  hundreds of completions on one day. There is no forecast.
- "Status by board" has no legend and no health reading, and is in board order.
- "Next milestones" shows counts such as "1070 open", which is the open count of every item due up
  to that date, not of the milestone.
- On CRM, where no item has a due date, the burn chart, gap, overdue, due this week and milestones
  are all empty. Most of the page is blank panels.

## Goals

1. Each headline number shows its direction.
2. The chart answers "when do we finish at this pace".
3. One view shows which boards carry late work and which weeks are heavy.
4. Attention is summarised by where it sits, not listed item by item.
5. A folder with no due dates still gets a useful page.

## Non-goals

- The Timeline tab and the stage filter menu. Both belong to `task/timeline-readability`.
- Spec 2 of the layouts work (widget sections, cross-board column metrics such as pipeline value)
  and spec 3 (AI-proposed layouts).
- A folder-level AI brief.
- Capacity in hours on the people section. It stays a count of open items.
- A "days since last change" heat map for folders without dates.

## Design

Everything stays inside the layout system from the 2026-09-24 spec: sections on the Overview
canvas, presets, Customize. Tabs, URL state and the filter bar are unchanged.

### 1. KPI cards with trend

`KpiCard` gains an optional trend: eight weekly points drawn as a sparkline with an emphasised end
point, and a change pill ("+37 this week", "48 wider", "flat").

| Card          | Series                                                            |
| ------------- | ----------------------------------------------------------------- |
| Complete      | cumulative done ÷ total, last 8 weeks                             |
| Gap to plan   | cumulative done − cumulative planned, last 8 weeks                |
| Overdue       | items due on or before each week's end and not done by then       |
| Due this week | items due per week, this week and the next 7 (drawn as mini bars) |

Complete and Gap come from the weekly `folder_burn` rows the page already loads. Overdue and Due
need a per-week `overdue_open` and `planned` count, which `folder_burn` gains as extra columns.
Blocked and Stale have no history and keep no trend.

A card whose value is zero is not drawn as a card. Zero cards collapse into one row of mono chips
under the KPI row ("Blocked 0 · Stale 0"). If the user's saved layout names fewer cards, only those
are considered.

The pill's colour follows meaning, not sign: more overdue is red, more complete is green. The text
always states the direction, so colour is never the only signal.

### 2. Burn chart with forecast

`BurnPanel` / `BurnChartInner` add, in Cumulative mode:

- a forecast line from today's completed total, sloped at the mean weekly completions of the last
  four full weeks, drawn dotted to the end of the plan range, labelled "forecast at N/wk";
- a gap marker at today: a vertical segment between planned and completed, labelled with the gap;
- a one-line reading above the chart: "At 40 a week the folder finishes around 28 Jun, 19 weeks
  after its last planned date." When the pace is zero it reads "No items completed in the last four
  weeks."

The forecast is computed on the client from rows already loaded. Weekly mode is unchanged.

### 3. A real completion date

> **Superseded on 2026-11-14 after measuring DEV.** All 663 done items in DAAS have an activity
> row, and every one carries the same instant as the status cell's `updated_at`: the boards were
> imported already done on 2026-11-14, so the chart's step is real data and the rule below would
> change nothing. `_folder_item_flags` and `folder_rollup` are left untouched. Instead `folder_burn`
> returns `imported_done` (completions dated on the item's own creation day); the forecast pace
> leaves those out and the reading line says so. See "Deviations from spec" in the plan. The text
> below is kept for the record.

The forecast is only as good as the completed series. `_folder_item_flags` changes how it derives
an item's done date:

1. the `created_at` of the earliest `item_activities` row for that item whose column is the board's
   status column and whose `new_value` is a done option, with no later change away from done;
2. otherwise the status cell's `updated_at`, as today.

`item_activities` is indexed on `(item_id, created_at)`. The plan must first measure, on DEV, how
many done items in DAAS have such an activity row. If the share is low (imports that wrote done
status directly leave no activity), the step in the chart remains for history and the spec's
reading line must say "based on completions since <first reliable week>"; the pace over the last
four weeks is still correct, because recent completions go through the app.

### 4. New section: load heat map (`panel: "load"`)

A grid: one row per board, seven columns for the three past weeks, the current week and the three
ahead. A cell holds the number of items due that week and not done. Past weeks are tinted with the
destructive colour, the current and future weeks with the brand colour, intensity by count against
the folder's maximum. Each cell prints its number, has a `title` ("Platform & Integrations, week of
9 Nov: 41 still open"), and links to the board. A legend sits under the grid.

Data: a new RPC `folder_load(p_folder_id, p_weeks_back int default 3, p_weeks_ahead int default 3)`
returning `(board_id, week_start, open_due)`, built on `_folder_item_flags`, limited to boards the
caller can read through `_folder_readable_boards`. At most 100 boards × 7 weeks = 700 rows.

The section is skipped by the read path, and not rendered, when the folder has no dated items.

### 5. New section: people load (`panel: "people"`)

Horizontal bars, one per person plus "Unassigned": open items, with the late share in the
destructive colour and "148 · 61" at the right. Top eight by open count, then "See all" to the
People tab. Data is the existing `folder_workload` action, loaded lazily through React Query when
the section scrolls near the viewport, exactly as the People tab does.

### 6. Boards section

`BoardStatusPanel` gains a health pill per board (the existing `rollup.ts` health rule), a legend
for the stacked bar, and a sort control: Health (default, worst first), Size, A–Z. Sorting is client
state.

### 7. Attention, grouped

`AttentionPanel` groups by board, then reason: "Platform & Integrations · 140 overdue · oldest
46d". A group expands in place to its items. Counts come from the `rollup` rows already on the
page, so they are totals, not the top-100 sample; the expanded list comes from the existing
`folder_attention` rows and says "showing 20 of 140, open the board for all" when cut.

### 8. Milestones

The count beside a stage date becomes the open items in that stage, from the rollup, instead of
every open item due up to that date.

### 9. Folders without due dates

When the rollup has no dated items:

- the burn section is replaced by "Items by stage": one horizontal bar per stage with the stale
  share marked, from rollup rows;
- the load section is hidden;
- Gap, Overdue and Due this week are treated as zero cards and collapse into chips, with a chip
  "No due dates set".

This is decided from data at render time, not from the preset, so a CRM folder that later gains
dates changes on its own.

### 10. Presets and saved layouts

The `project` preset becomes: KPIs, burn (8) + load (4), boards (8) + people (4), attention (8) +
intelligence and milestones (4). `crm` and `support` gain the people section.

This reverses one rule of the 2026-09-24 spec ("an untouched folder renders exactly as today"). An
untouched folder gets the new layout. A folder with a saved layout keeps its sections and order;
the sections it already has are upgraded in place, and `load` and `people` appear in the Sections
sheet to add. The config schema's `panel` enum gains `load` and `people`; no config version bump.

## Performance and data-fetching budget

- **First paint:** one new read, `folder_load`, in wave B next to `folder_burn`, skipped when the
  layout has no load section or the folder has no dated items. `folder_burn` returns two more
  integer columns per row. Recharts stays out of first paint (the existing guard tests must pass);
  sparklines and the heat map are plain SVG and CSS, not Recharts.
- **Lazy:** people load, on approach to the viewport.
- **Interactions with 0 round-trips:** board sort, attention expand, Cumulative/Weekly, stage and
  board filters, Customize drafts.
- **Bounded:** `folder_load` ≤ 700 rows; `folder_burn` unchanged in row count; the activity lookup
  in `_folder_item_flags` uses `item_activities (item_id, created_at)`. The plan must capture
  `explain analyze` of `folder_rollup` and `folder_burn` on DAAS before and after on DEV and stop if
  either is more than 20% slower.

The stage and board filters apply to every section. The burn chart keeps its existing scope note
(it ignores the board filter); the load map honours the board filter by hiding rows.

## Coordination with `task/timeline-readability`

That branch changes `FilterBar.tsx` (stage menu above eight stages) and adds one prop pass-through
in `CommandCenter.tsx`. It merges first. This work rebases onto it before touching either file and
does not edit `tabs/Timeline*.tsx`, `src/lib/folders/timeline.ts` or `src/components/boards/gantt/*`.

This work also follows `task/folder-invites`, which changes `HeaderActions.tsx`. Neither changes
the other's files beyond that header.

## Rollout

The migration changes `_folder_item_flags` and `folder_burn` and adds `folder_load`, on the
database that serves live traffic. It is minted with `scripts/new-migration.sh`, applied through
the `supabase-dev` MCP with the same version and name, checked with `pnpm db:ledger-check`, with
types regenerated in the same PR. Before applying, the new function bodies are run in a rolled-back
transaction on DEV and their totals compared with the current ones for DAAS and CRM: total, done
and overdue must be identical; only done dates may move.

## Independent units

- **U1 SQL:** done-date rule, `folder_burn` columns, `folder_load`, grants, types.
- **U2 pure logic:** trend series and change text, forecast, load grid shaping, attention grouping,
  no-dates detection, milestone count. No dependency on U1 beyond the row types.
- **U3 KPI row:** `KpiCard` trend, zero-card chips. Depends on U2.
- **U4 burn:** forecast, gap marker, reading line, "Items by stage" fallback. Depends on U2.
- **U5 load section:** panel, payload wiring. Depends on U1, U2.
- **U6 people section:** depends on nothing new.
- **U7 boards, attention, milestones:** depends on U2.
- **U8 presets and schema:** enum, presets, Sections sheet entries. Depends on U5, U6 existing.

U1, U2 and U6 run together. U3, U4, U5 and U7 run together after U2 (U5 also after U1). U8 is
last. U3, U4 and U7 touch different files.

## Testing

- **Unit:** trend series from burn rows including a folder younger than eight weeks; change text
  and tone for each card; forecast with zero pace, with pace that never reaches the total, and with
  completion before the plan end; load grid with a filtered board and with an empty week;
  attention grouping totals equal the rollup; no-dates detection; milestone count per stage.
- **SQL integration:** done date prefers the activity row, falls back to the cell, ignores an item
  moved back out of done; `folder_load` returns only readable boards and respects the week window;
  `folder_burn` totals unchanged.
- **Component:** a zero card is absent and its chip present; sparkline has a text alternative;
  board sort changes order with no `router` call; attention group expands; the CRM fixture shows
  "Items by stage" and no load section; a saved layout without `load` does not render it.
- **Existing guards:** no-Recharts-in-first-paint, no-Gantt-in-first-paint, the no-refetch test in
  `command-center-state.test.tsx`.
- **Browser check before merge:** heat map and sparkline geometry measured in Chromium against the
  built CSS, in dark and light, at 1384px and at phone width, then on the live DAAS and CRM
  folders.

All four gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Open points for the plan to verify against code

1. The shape of `item_activities.new_value` for a status change, and how a "done" option is
   identified from it.
2. Share of done items with a usable activity row on DAAS (decides the wording in section 3).
3. Whether `folder_workload` already returns the late count per person or only open.
