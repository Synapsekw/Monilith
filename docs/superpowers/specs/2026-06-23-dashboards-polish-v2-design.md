# Dashboards Polish (v2) — Design Spec

- **Date:** 2026-06-23
- **Status:** Draft — awaiting review
- **Builds on:** Phase 8 (Dashboards) — shipped slices D1–D3b (Number/Chart/Battery/List + filter)
- **Author:** brainstorming session (Danijel Jovanovic)
- **Related:** `vault/00-north-star.md` §2 (Phase 8), `vault/sessions/2026-06-17*`–`2026-06-19*` (D-series), `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md` (data-fetching budget), `vault/decisions/2026-06-17-2048-gotcha-14-react-grid-layout-v2-api.md`

## 1. Context & problem

The Phase-8 dashboards subsystem is shipped and test-green but **never visually verified in-app**, and three gaps limit it:

1. **Widgets look unfinished** — thin chrome, no visual hierarchy, weak empty/loading states.
2. **Editing is lopsided** — drag/resize/rename/delete work for all widgets, and List has a full config-edit dialog, but **Number/Chart/Battery are add-only** (delete-and-recreate to change anything). Add and Edit are separate code paths.
3. **Charts are shallow** — only bar + pie, aggregation is single-dimension (count/sum/avg grouped by **one Status column**). No time-series, no multi-series, no grouping by date/dropdown/people.

This spec is a **polish pass on the existing subsystem**, not a rewrite.

## 2. Goals

- A cohesive, polished widget visual language across every widget type.
- **Every widget fully editable** through one unified Add/Edit surface with live preview.
- A richer chart catalog — **line/area trend, stacked/grouped bar, combo bar+line, donut/radial/gauge** — backed by a generalized aggregation layer.
- Grouping/series by **date buckets, status, dropdown, and people** columns.
- All of it within the project data-fetching budget (rule 5) and shipped with tests (rule 4).

### Non-goals (this spec)

- Cross-org dashboard sharing (stays org-scoped, per board-sharing session limitation).
- Advanced filter operators beyond today's set (`between`, `is one of`, relative dates, nested groups) — separate backlog item.
- Board templates / ⌘K polish (separate Phase-8 tail).

## 3. Key decisions (locked in brainstorming)

| #   | Decision                                                                                             | Rationale                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Full data model**: date-bucketed + multi-series aggregation                                        | Unlocks real trends and genuine combo charts; chosen over medium/light.                                                                                 |
| D2  | **Coarse `kind` enum kept** (`number/chart/battery/list`); chart variant lives in `config.chartType` | Avoids an enum migration; keeps configs backward-compatible.                                                                                            |
| D3  | **Gauge = Number display mode** (`display:'gauge'`), not a new kind                                  | Single-value semantics belong with Number.                                                                                                              |
| D4  | **One generalized `dashboard_series` RPC**                                                           | Single dispatch covers category-primary and date-primary charts + series split.                                                                         |
| D5  | **`dashboard_aggregate` wrapped (deprecated), then retired next release**                            | Zero breakage now.                                                                                                                                      |
| D6  | **Multi-assignee = count-per-assignee** when grouping by People                                      | Standard workload semantic; stacked-by-assignee bars sum per person. Surfaced as a small note on the widget.                                            |
| D7  | **Visual language = "B structure + C richness"**                                                     | Bordered cards + accent-dot header (B) carrying gradient KPIs, sparklines, combo/trend charts, donut/gauge, legends (C). Approved via visual companion. |
| D8  | **Edit pattern = right-side Sheet + live preview**, one shared `WidgetConfigForm` for Add + Edit     | Best UX; eliminates Add/Edit duplication; doesn't obscure the dashboard.                                                                                |

## 4. Pillar 0 — Data layer (foundation)

### `dashboard_series` RPC

SECURITY DEFINER with `is_org_member` check and pinned `search_path` (same pattern as existing `dashboard_aggregate` / `dashboard_list_rows`).

```
dashboard_series(
  p_board_id  uuid,
  p_primary   jsonb,   -- X axis: { columnId, kind, bucket? }  (bucket = day|week|month for date)
  p_series    jsonb,   -- optional series split: { columnId, kind } | null
  p_measure   jsonb,   -- { agg: count|sum|avg, valueColumnId? }
  p_limit     int      -- bound: top-K categories OR last-N periods
) returns table (
  bucket_key text, bucket_label text, bucket_meta jsonb,
  series_key text, series_label text, series_color text,
  value numeric
)
```

- **Primary axis** dispatch:
  - **category** (`status`/`dropdown`/`people`) → group by value.
  - **date** column + `bucket` → `date_trunc(bucket, <date>)`.
- **Series split** (optional second dimension) → multiple series → stacked/grouped bar, multi-line, combo (bar-vs-line assignment is front-end `comboMap`, not the RPC).
- **Bounding (rule 5):** categories capped top-K by value, remainder folded into an **"Other"** bucket; date axis capped to **last-N periods**. Output rows `≤ K × series-cardinality`, also capped.

### Tricky dimensions

- **People** — people `cell_values` are arrays → `unnest` (one row per assignee, D6 semantic) → join `org_members`/profiles for `series_label` + avatar.
- **Dropdown / Status** — join the column's option definitions so `series_label`/`series_color` come from the real option label + color (charts match board pills).
- DB returns `series_color`/`bucket_meta` so the front-end never re-derives colors.

### Config schema (Zod, `src/lib/validations/dashboards.ts`)

- `chartConfigSchema` → `{ chartType, primary:{columnId,bucket?}, series?:{columnId}, measure:{agg,valueColumnId?}, comboMap?:Record<seriesKey,'bar'|'line'> }`.
- `numberConfigSchema` → add `display:'plain'|'gauge'` (+ optional `target` for gauge %).
- **Backward compat:** pure mapper upgrades stored configs at read time — old `{groupColumnId, chartStyle}` → `{chartType, primary:{columnId}, measure:{agg:'count'}}`. No data migration; old widgets render unchanged.

### Wiring

- `getWidgetData` calls `dashboard_series`; `dashboard_aggregate` becomes a thin deprecated wrapper.
- `useWidgetData` keeps `["dashboard-widget", id, configHash(config)]` keying + 60s stale (configHash already covers the richer config).

### Migration & types

- One migration (`..._dashboard_series.sql`): the RPC + supporting indexes (confirm `items(board_id, created_at)` for date bucketing; `cell_values(column_id, item_id)`).
- `pnpm db:types` → commit `database.types.ts` same PR; run `get_advisors` (SECURITY DEFINER hot-spot — search_path pinned).

## 5. Pillar A — Chart catalog

One rewritten `ChartWidget` switching on `config.chartType`, mapping `dashboard_series` rows to recharts (3.8.1):

- **Bar** — `BarChart`; with series → **stacked** (`stackId`) or **grouped**.
- **Line / Area** — `LineChart`/`AreaChart` over date-bucketed primary; multi-series = multiple lines.
- **Combo** — `ComposedChart` (`Bar`+`Line`); `comboMap` picks bars vs line; optional dual Y-axis when scales differ.
- **Donut / Pie** — `PieChart` (`innerRadius` for donut); colors from `series_color`.
- **Radial / Gauge** — `RadialBarChart`; gauge is Number's `display:'gauge'` (arc vs target).
- Shared Monolith theming (dark tooltip, muted axes, DB colors, consistent legend) + proper **empty / loading-skeleton / error** states.

## 6. Pillar B — Edit drawer + unified config

- **`WidgetConfigForm`** — one component driven by `kind` + `chartType` (source board → primary dim + bucket → optional series → measure → chartType → filter via existing `FilterBuilder`). **Replaces** `AddWidgetDialog` per-kind forms _and_ `EditListWidgetDialog`.
- Hosted in a right-side shadcn **`Sheet`**: left = form, right = **live preview** of the real widget (via `useWidgetData`/`useWidgetRows` on the in-progress config), **debounced ~400ms**.
- Save → existing `createWidget` / `updateWidgetConfig` actions.
- Chart-type display toggle = **no refetch**; data-shape change = refetch **only the preview**, debounced.

## 7. Pillar C — Visual reskin

Apply the approved B+C language to `DashboardWidget` shell + every widget component using **pulse-ui tokens** (not mockup hex): accent-dot header + menu, gradient KPI + sparkline (Number), donut/gauge, legends, refined empty states + skeletons. Rewrites the same components as Pillar A → done together per component.

## 8. Performance & data-fetching budget (rule 5)

- **First paint:** unchanged — SSR `getDashboardPayload`, then per-widget React Query (60s stale, `configHash` key).
- **In-page interactions = 0 server round-trips:** chart-type toggles, drag/resize, viewing loaded data — client state / History API, never RSC nav.
- **Refetch only on data-shape change**, scoped to one widget, debounced (drawer preview + saved-config change).
- **All aggregation in Postgres** (`dashboard_series`), **bounded** (top-K + last-N + capped series) over **indexed** columns; never JS-side over fetched rows. Live preview reuses the React Query cache so Save doesn't refetch.

## 9. Testing (rule 4)

- **RPC/SQL:** date bucketing; category grouping; people unnest (multi-assignee D6); top-K "Other" folding; last-N capping; **org/RLS isolation**; search_path pinned.
- **Zod:** new config shapes + back-compat mapper round-trip.
- **Vitest components:** each `chartType` renders; combo bar/line mapping; gauge; edit-drawer debounce + live preview; unified form drives Add and Edit.
- **e2e:** add a combo chart via drawer → edit → preview updates → save; existing dashboard still renders (back compat).
- **Gate:** `pnpm typecheck && lint && test && build` green; no advisor warnings.

## 10. Execution DAG (rule 6)

| Task                     | Scope                                                                                                    | Footprint                                                                                                                   | Size | Depends on | Batch                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- | ----------------------- |
| **T1 — Data layer**      | `dashboard_series` RPC + migration, Zod config + back-compat mapper, `getWidgetData` rewire, types regen | `supabase/migrations/`, `src/lib/validations/dashboards.ts`, `src/lib/dashboards/{actions,queries}.ts`, `database.types.ts` | M    | —          | A (root, critical path) |
| **T2 — Charts + reskin** | New `ChartWidget` (all chart types) + Number gauge/sparkline + B+C reskin of all widget components       | `src/components/dashboards/widgets/*`, `DashboardWidget.tsx`                                                                | L    | T1         | B                       |
| **T3 — Edit drawer**     | `WidgetConfigForm` + Sheet + live preview; retire `AddWidgetDialog`/`EditListWidgetDialog`               | `src/components/dashboards/{ConfigForm,DashboardCanvas}.tsx`, reuse `FilterBuilder`                                         | L    | T1         | B                       |

- **Critical path:** T1 → T2 (wall-clock floor).
- **Parallel batch B:** T2 + T3 concurrently after T1 merges, in separate worktrees (`task/dash-charts-reskin`, `task/dash-edit-drawer`). Only overlap is `DashboardWidget.tsx` (T2 owns visuals; T3 wires the edit trigger) — small; T3 rebases on T2 if needed.
- **Build order:** T1 solo first (root, short) → dispatch T2 + T3 as a parallel wave (one worktree + scoping/build agent per task off latest `develop`), per `/whats-next`.

## 11. How to test (manual acceptance, post-merge)

1. Pull `develop`, open a dashboard (`/dashboards/[id]`).
2. Confirm existing widgets render unchanged (backward compat) in the new visual language.
3. Click **+ Add widget** → the right-side drawer opens; build a **combo (bar+line) over time** chart; watch the live preview update as you change source/grouping/measure; save.
4. Add a **stacked bar grouped by People**; confirm assignees split correctly (multi-assignee counts each).
5. Edit an existing Number widget → switch `display` to **gauge**, set a target; confirm preview + save.
6. Drag/resize widgets; confirm no data refetch (network panel) and layout persists.
7. Add a **donut** and a **line/area trend**; confirm colors match board pills.
