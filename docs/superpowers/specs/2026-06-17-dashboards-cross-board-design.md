---
type: spec
status: draft
date: 2026-06-17
phase: 8 (slice)
tags: [spec, dashboards, phase-8]
related:
  - "[[00-north-star]]"
  - "[[platform-roadmap]]"
---

# Dashboards (cross-board) — design

> Phase 8 slice. Monday-style **cross-board workspace dashboards**: a grid of configurable
> widgets, each aggregating one source board's data via bounded server-side queries, laid out on
> a drag-resize canvas. One subsystem spec; built in three dependency-ordered slices (D1→D3).

## 1. Goal & scope

Add a **Dashboards** surface, a sibling to Boards, where a user assembles a workspace-scoped
dashboard from widgets. Each widget summarizes **one source board** (a dashboard is "cross-board"
by holding widgets drawn from different boards). Four widget types across the slices: **Number/KPI**,
**Chart (bar/pie)**, **Battery (status breakdown)**, **List**.

Locked in brainstorming (`2026-06-17`):

- **Cross-board / workspace-scoped**, not a per-board view. Dashboards live outside the board view
  switcher, in their own route + nav section.
- **Server-side aggregation** is the data spine (option B below), never client-side aggregation
  over fetched board payloads.
- **Full drag-resize canvas** (`react-grid-layout`), with persisted per-widget layout.
- **One source board per widget** for v1 (multi-board-per-widget is explicitly deferred).
- Built in **three slices** (D1 foundation+canvas+Number, D2 Chart+Battery, D3 List). This spec
  details the subsystem + **D1**; D2/D3 get their own thin plans when reached.

### Out of scope (YAGNI for this subsystem)

- Multi-board-per-widget aggregation (column-matching across boards).
- Cross-org / cross-workspace dashboards.
- Dashboard sharing/permissions beyond org-membership RLS (no per-dashboard ACLs).
- Filters on aggregate widgets (date ranges, person filters) — Number/Chart/Battery aggregate the
  whole source board in v1. The List widget (D3) gets a simple filter since it's row-based.
- Scheduled email/export of dashboards, public links, embedding.
- Real-time push for aggregates (see §4 — aggregates refresh on mount / explicit refresh, not via
  a Realtime subscription per widget).

## 2. Data-fetching budget (working-agreement rule 5)

| Moment                       | What loads                                                                                                             | Round-trips                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **First paint**              | Dashboard row + its `dashboard_widgets` rows (RSC), then each widget fires its own bounded aggregate query in parallel | 1 RSC load + N parallel widget queries (N = widget count, each returns ≤ K group rows, **not** item rows) |
| **Drag / resize / reorder**  | Nothing — pure client state; layout persisted by a **debounced** `saveLayout` Server Action                            | **0 data refetch**                                                                                        |
| **Edit one widget's config** | Re-run **only that widget's** aggregate query                                                                          | 1 (scoped to the edited widget)                                                                           |
| **Add widget**               | Insert row + that widget's first aggregate query                                                                       | 1 insert + 1 query                                                                                        |
| **Delete widget**            | Delete row                                                                                                             | 1, no query                                                                                               |

- **Bounded:** aggregate queries `GROUP BY` and return **K buckets** (number of status options /
  distinct values), never the underlying items. The List widget (D3) fetches rows with `LIMIT`.
- **Indexed:** aggregates filter on `cell_values.board_id` (idx `cell_values_board_id_idx`) and
  `column_id` (idx `cell_values_column_id_idx`); item counts use `items.board_id`
  (idx `items_board_id_idx`). No unbounded `select *`.
- Widget results cache in TanStack Query keyed by `["dashboard-widget", widgetId, configHash]`.
  Layout drag is client-only (the canvas owns layout state); it never invalidates widget data.

## 3. Architecture & data model

### 3.1 Tables (new migration, mirrors boards-core conventions)

Conventions reused verbatim from `board_views` / boards-core: denormalized `org_id`,
`is_org_member(org_id)` RLS, `set_updated_at` trigger, `position double precision`, SECURITY DEFINER
create-RPCs that derive `org_id` server-side.

```sql
-- dashboards: workspace-scoped, org-RLS. Sibling to boards.
create table public.dashboards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 100),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index dashboards_workspace_id_idx on public.dashboards (workspace_id);
create index dashboards_org_id_idx on public.dashboards (org_id);

create type public.widget_kind as enum ('number', 'chart', 'battery', 'list');

-- dashboard_widgets: one per widget. `source_board_id` = the single board it summarizes.
-- `config` holds type-specific settings; `layout` holds the grid rect {x,y,w,h}.
create table public.dashboard_widgets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  dashboard_id    uuid not null references public.dashboards (id) on delete cascade,
  source_board_id uuid references public.boards (id) on delete set null,
  kind            public.widget_kind not null,
  title           text not null check (char_length(title) between 0 and 100),
  config          jsonb not null default '{}'::jsonb,
  layout          jsonb not null default '{}'::jsonb,
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index dashboard_widgets_dashboard_id_idx on public.dashboard_widgets (dashboard_id);
create index dashboard_widgets_org_id_idx on public.dashboard_widgets (org_id);
```

- `source_board_id` is `on delete set null` (not cascade) so deleting a board degrades a widget to
  an "orphaned — pick a new source" empty state rather than vanishing silently.
- RLS: read/insert/update/delete `using (is_org_member(org_id))`; insert/update also
  `with check (is_org_member(org_id))`. For `dashboard_widgets`, the create-RPC derives `org_id`
  from the parent dashboard (membership-checked), mirroring `create_board_view`.

### 3.2 `config` jsonb shapes (Zod-validated at the boundary)

```ts
// number: count items, or sum/avg of a numbers column
{ agg: 'count' | 'sum' | 'avg', valueColumnId?: string }   // valueColumnId required for sum/avg
// chart: group by a status/dropdown/people column, count → bar|pie
{ groupColumnId: string, chartStyle: 'bar' | 'pie' }
// battery: group by a status column, count → stacked %
{ groupColumnId: string }
// list (D3): bounded row list
{ filter?: {...}, limit: number, columnIds: string[] }
```

### 3.3 Aggregation RPC (the spine — powers Number, Chart, Battery)

One generic, bounded `SECURITY DEFINER` RPC. All three aggregate widgets reduce to "group items of
a board by a column value, then count or sum":

```sql
-- Returns ≤ K rows. group_key is null for the ungrouped (whole-board) case.
-- agg: 'count' counts items; 'sum'/'avg' operate on (value->>'n')::numeric of p_value_column_id.
create function public.dashboard_aggregate(
  p_board_id        uuid,
  p_group_column_id uuid    default null,   -- status/dropdown/people column to GROUP BY
  p_value_column_id uuid    default null,   -- numbers column for sum/avg
  p_agg             text    default 'count'
) returns table (group_key text, metric numeric)
language plpgsql security definer set search_path = '' as $$ ... $$;
```

- Membership-checked: derive `org_id` from `p_board_id`, raise `42501` if not a member.
- **count**, no group → scalar total (`Number` count). **count**, grouped → buckets per option
  (`Chart`, `Battery`). **sum/avg** over a numbers column → scalar (`Number`).
- **Empty cells matter:** the query `LEFT JOIN`s items → cell_values so items lacking a value land
  in a `null`/"None" bucket (correct status distribution).
- `group_key` for status/dropdown = the `optionId`; for people = `userId`. Label/color/name
  resolution happens in the widget data Server Action (§3.4), not in SQL.

### 3.4 Widget data Server Action

`getWidgetData(widgetId)` (server) returns the small payload a widget renders from:

```ts
{
  kind, config,
  buckets: { key: string | null, metric: number }[],   // from dashboard_aggregate
  columnMeta?: { kind, options?: {id,label,color}[] },  // resolved server-side for label/color
}
```

It calls `dashboard_aggregate` for `buckets` and reads the source column row for `columnMeta`
(both bounded). The client widget renders labels/colors from `columnMeta` — so renaming a status
option is reflected without storing a stale snapshot in `config`. Cached under
`["dashboard-widget", widgetId, configHash]`.

### 3.5 Routing & nav

- Routes: `/dashboards/[dashboardId]` (RSC loads the dashboard + widget rows). A workspace's
  dashboards list surfaces in the sidebar `BoardsNav` area as a sibling **Dashboards** section
  (workspace-scoped, mirroring how boards are listed).
- Create-dashboard via a `createDashboard(workspaceId, name)` Server Action → `create_dashboard`
  RPC (mirrors `create_board`).

### 3.6 Canvas (D1)

- `react-grid-layout` (responsive `WidthProvider` + `Responsive`) for drag + resize + collision.
- Edit mode toggle: in **view mode** widgets are static; in **edit mode** drag handles + resize +
  the "Add widget" button + per-widget config/delete menu appear.
- Layout (`{i,x,y,w,h}` per widget) is client state; on drag/resize-stop a **debounced**
  `saveLayout(dashboardId, layout[])` Server Action persists each widget's `layout` jsonb.
  Reload restores from persisted `layout`. **No data refetch on layout change.**

## 4. Realtime / freshness

Aggregates are **not** Realtime-subscribed per widget (would mean a subscription per source board
and re-aggregating on every cell change — expensive, and dashboards tolerate slight staleness).
Instead: widget data is fetched on mount and on explicit **refresh** (a manual refresh affordance;
optional low-frequency interval refetch can come later). Widget config/layout/add/delete mutations
DO update immediately (optimistic + Server Action), since those are the user's own edits.

## 5. Slice decomposition

- **D1 — Foundation + canvas + Number/KPI** _(this spec, detailed)_
  - Migration: `dashboards` + `dashboard_widgets` + `widget_kind` enum + RLS + `create_dashboard`,
    `create_dashboard_widget`, `dashboard_aggregate` RPCs. Regenerate types.
  - Server Actions: `createDashboard`, `createWidget`, `updateWidgetConfig`, `deleteWidget`,
    `saveLayout`, `getWidgetData`. Zod schemas for each config shape.
  - `/dashboards/[dashboardId]` route + RSC loader; sidebar Dashboards section + create flow.
  - `react-grid-layout` canvas with edit mode + debounced layout persistence.
  - Add-widget flow + widget config form (source board → agg → optional numbers column).
  - **Number/KPI** widget rendering. Proves the whole spine end-to-end.
- **D2 — Chart + Battery.** Add `recharts`; bar/pie + battery rendering; chart config (group column
  - style). Reuses `dashboard_aggregate` (grouped). Thin plan.
- **D3 — List widget.** Bounded paginated row fetch (`LIMIT`, indexed filter) + filter config + list
  rendering. Separate data path from the aggregate RPC. Thin plan.

## 6. New dependencies

- `react-grid-layout` (D1) — drag-resize grid canvas.
- `recharts` (D2) — bar/pie charts.

## 7. Testing (mandatory — written + executed each slice)

- **Unit/pure:** aggregation result-shaping; `configHash`; layout persistence debounce/mapping;
  Zod config schemas (valid + invalid per kind); number formatting (count/sum/avg).
- **RPC / integration (live, cross-org):** `dashboard_aggregate` returns correct counts incl. the
  empty-cell "None" bucket and sum/avg over numbers; **RLS denies** reading another org's dashboard,
  widgets, and aggregates; `source_board_id` `set null` on board delete.
- **Component:** add-widget flow; widget config edit re-queries only that widget; Number widget
  renders count/sum/avg; orphaned-source empty state.
- **e2e (Playwright):** create dashboard → add a Number widget bound to a board → see the count →
  drag/resize → reload → layout persisted. Verify **0 data refetch** on drag (no aggregate request
  fires on layout-stop).
- **Gate (per slice):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green + advisors
  clean before "done".

## 8. Risks / open questions

- **`react-grid-layout` + React 19 / Next 16 compat** — verify it mounts cleanly (it's a classic
  lib; may need a client-only dynamic import to avoid SSR width issues). Confirm in D1 spike.
- **People-column grouping** (`group_key = userId`) needs member name/avatar resolution in the
  widget data action — fine for Chart, but confirm we want People grouping in v1 or defer to D2.
- **Sidebar information architecture** — adding a Dashboards section alongside Boards per workspace;
  confirm the nav doesn't get crowded (may fold under a workspace disclosure).
