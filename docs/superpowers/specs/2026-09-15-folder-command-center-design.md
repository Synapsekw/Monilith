# Folder Command Center — design

**Date:** 2026-09-15
**Status:** approved in brainstorm (2026-09-12 → 2026-09-15), ready for `writing-plans`
**Prototype:** https://claude.ai/code/artifact/186ce58b-5510-473c-9506-eed73ee1a576 (live, clickable;
source at `.superpowers/brainstorm/49989-1789228766/content/command-center.html`, untracked)
**Supersedes:** the workspace-level widget dashboards as the primary "dashboard" surface (Phase 8)

## 1. Summary

Every folder becomes a project, and every project gets a command center: an auto-built,
sectioned page that answers "where is this project" without anyone configuring a widget. The
command center is built from the folder's boards and their groups. Groups with the same name
across boards become the project's **stages**, and every number on the page can be filtered to
one stage with zero server round-trips.

Today's dashboards are a flat, workspace-scoped widget canvas with no story: the index page
redirects to the first dashboard, every card carries the same weight, and nothing on it knows
what a project is. They do not die — each one folds into the folder it belongs to as a "Your
widgets" strip at the bottom of the Overview tab.

The visual reference is the "DAAS Control Tower" artifact the owner liked (sectioned sub-nav,
stage tabs, dense KPI cards, planned-vs-completed burn, status-by-board bars, snapshot + export),
rebuilt on Monolith Keystone with **tabs under the header** (chosen over a second sidebar).

## 2. Decisions taken in brainstorm

| Question                              | Decision                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| What does a command center attach to? | **Shared folders.** Folders are promoted from private per-user sidebar groupings to shared workspace objects. |
| Relationship to widget dashboards     | **Auto-built sections + custom widgets below.** Existing dashboards fold into their folder's Overview.        |
| What must the auto section answer?    | Health + progress per board, timeline/stages, people + workload, needs-attention + intelligence.              |
| Nav placement                         | **Tabs under the folder header.** App sidebar stays as is.                                                    |
| What is a stage?                      | **Same-named groups across the folder's boards.** No new schema.                                              |
| Tabs in v1                            | **Overview · Stages · Boards · People.** Gates, Decisions and a Widgets tab are out of scope.                 |
| Header extras                         | Snapshot chip, Share link, Export PDF, Ask about this folder.                                                 |
| Fate of `/dashboards`                 | Becomes the folder gallery. `/dashboards/[id]` redirects into its folder.                                     |

## 3. Data model

### 3.1 `folders` and `folder_boards` (new, shared)

```sql
create table public.folders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  position     integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index folders_workspace_position_idx on public.folders (workspace_id, position);

create table public.folder_boards (
  folder_id  uuid not null references public.folders(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (board_id)                 -- a board sits in at most one folder
);
create index folder_boards_folder_position_idx on public.folder_boards (folder_id, position);
```

RLS: `select` for `is_org_member(org_id)`; `insert/update/delete` for workspace members (reuse the
existing workspace-membership predicate the boards tables use). `folder_boards` writes also require
`can_read_board(board_id)`. Both tables default-deny like every other org-scoped table.

### 3.2 Migration of private folders

The existing `board_folders` / `board_folder_boards` (per-user, `user_id`-keyed) are copied forward
once, then dropped in the same migration:

1. For each `(workspace, trim(lower(name)))` seen across all users' private folders, create one
   shared folder. Workspace comes from the boards inside the folder (`boards.workspace_id`); a
   private folder whose boards span workspaces is split per workspace.
2. A board that appears in several users' folders lands in the folder that holds it most often;
   ties break by the earliest `created_at`.
3. Drop the private tables, their RLS, and the sidebar code paths that read them.

**Accepted trap:** a folder that one user made for themselves becomes visible to the whole
workspace. The owner accepted this; the alternative (start everyone empty) was rejected.

### 3.3 `dashboards.folder_id` (new, nullable)

```sql
alter table public.dashboards add column folder_id uuid references public.folders(id) on delete set null;
create index dashboards_folder_idx on public.dashboards (folder_id);
```

Backfill: a dashboard whose widgets' `source_board_id`s all sit in one folder gets that folder.
Any other dashboard stays `null` and appears as "Unfiled" in the gallery with an attach picker.
A folder may own several dashboards; the Overview strip renders all of them in `position` order.

### 3.4 No stage table

A **stage** is a distinct `trim(lower(groups.name))` across the folder's boards, displayed with
the first-seen original casing and colour, ordered by the minimum `groups.position` across boards.
Groups whose name matches no other board's group still form a stage of their own; the UI shows
"Only on <board>" under the card. The `stage` filter value is the normalised name, so it is
URL-safe and stable across renames of a single board's group only if every board renames.

## 4. Routes and navigation

| Route                                   | Behaviour                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/folders/[folderId]`                   | Command center. RSC page: folder, boards, first-paint payload (§6).                                                                                                    |
| `?tab=overview\|stages\|boards\|people` | Tab selection, client state mirrored via `history.replaceState`. Never a `<Link>`/`router` navigation. Default `overview`.                                             |
| `?stage=<normalised name>`              | Stage filter, same mechanism. Absent = all stages.                                                                                                                     |
| `/dashboards`                           | Folder gallery: one card per folder in the active workspace (name, board count, done %, overdue count, attention count) plus an "Unfiled dashboards" section.          |
| `/dashboards/[dashboardId]`             | 307 redirect to `/folders/[folder_id]?tab=overview#widgets` when the dashboard has a folder; otherwise renders the legacy canvas unchanged (still needed for Unfiled). |

Sidebar (`sidebar-nav.tsx`): the folder row becomes a link to its command center; boards nest
under it as today. Chevron still toggles collapse. `DashboardsNav` is removed; the "+ dashboard"
affordance moves into the Overview "Your widgets" strip ("Add widget" / "Generate with AI").
The ⌘K palette indexes folders ("Q4 Launch — command center").

## 5. The page

### 5.1 Header (all tabs)

- Folder name, `Snapshot · <generated-at> · live` chip (the RSC render time).
- Right: **Share** (copies the URL; RLS gates access), **Export PDF** (print stylesheet +
  `window.print()`, Overview only, charts render as static SVG so they print), **Ask about this
  folder** (opens `/ask?folder=<id>`; the Ask surface injects the folder's board list into its
  context — a small extension to the existing Ask scope handling).
- Tab strip: Overview · Stages `n` · Boards `n` · People `n` (red count = overloaded people).
- Filter bar under the tabs: stage segmented control (All · stage chips with colour dot), board
  dropdown (All boards or one), and a mono hint `361 items · 4 boards · Wave 2`.

### 5.2 Overview tab

1. **Six KPI cards** — Complete (% of items, done count badge, "planned by today" sub-fact),
   Gap to plan (done − planned, behind/ahead badge), Overdue (open overdue, oldest age),
   Due this week (count, not-yet-started sub-fact), Blocked (open items whose status option is
   labelled blocked or stuck, case-insensitive; 0 when no board has such an option), Stale (untouched > 14 days). Each card: value, badge,
   one sub-fact, thin progress bar. Semantic colour only on the value/bar.
2. **Planned vs completed** — cumulative weekly line chart: planned finishes (due dates) as a
   dashed line, completed as the accent line with an area fill, dashed red "Today" marker, and
   the planned-minus-done wedge filled red between the lines up to today. Toggle Cumulative /
   Weekly (client-only, same data).
3. **Status by board** — one stacked bar per board (done / in progress / overdue / not started)
   with item count.
4. **Needs attention** — top 20 items: overdue, blocked, no owner, stale; each row shows board,
   reason, age, and the item's stage; click opens the item panel.
5. **Intelligence** — the latest existing Board Intelligence brief per board, stacked (board name
   - brief). No new model call in v1; the panel is hidden when no board has a run.
6. **Next milestones** — the next three stage end dates (the latest due date inside each
   stage), with the stage name and the number of open items still before it.
7. **Your widgets** — the folder's folded-in dashboards rendered through the existing
   `DashboardCanvasLazy`, one section per dashboard, anchored `#widgets`. Same edit mode, same
   widget config sheet, same AI wizard entry.

### 5.3 Stages tab

1. **Stage cards** — one per stage: name, date span (min/max due date), item count, done %, in
   progress / overdue / not started, stacked bar, and a state kicker: COMPLETE (every item
   done), IN FLIGHT (today inside the date span or any item in progress), UPCOMING (nothing
   started). Clicking a card sets the stage filter.
2. **Burn by stage** — the same chart as Overview, scoped to the selected stage.
3. **Stage × board matrix** — % done per (board, stage) as a soft badge, coloured by band
   (≥ 90 green, ≥ 50 blue, ≥ 25 yellow, else gray); "—" when the board has no such group.
4. **Carry-over** — one line: open items whose stage is COMPLETE elsewhere.

### 5.4 Boards tab

Table: board, health pill (same rule as the digest: `_board_health_flags`), status mix bar, items,
done %, overdue, stale, owners (avatars from people columns), next milestone. Sort: by health,
by owner, A–Z (client-side). Row click opens the board. Below: "Stages on only one board" list
(group names no other board shares) with a "merge into stage" affordance that renames the group
(existing rename action).

### 5.5 People tab

1. **Workload** — open items per person for the selected stage, bar scaled to the max, red
   above the 15-item line (configurable later; constant in v1), late count inline.
2. **Who owns what** — person → boards they hold items on, open count, overdue count.
3. **Unassigned** — open items with no person; "assign" opens the item panel.

## 6. Performance and data-fetching budget (working agreement #5)

**First paint (`/folders/[id]`, one RSC render, three RPCs in `Promise.all`):**

| RPC                               | Returns                                                                                         | Bound                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `folder_rollup(folder_id)`        | one row per (board, stage): done, in_progress, overdue, not_started, stale, unassigned, blocked | boards × stages (≤ 100 × 50)                              |
| `folder_burn(folder_id)`          | one row per (stage, iso_week): planned, completed                                               | stages × weeks in the folder's due-date span (≤ 50 × 104) |
| `folder_attention(folder_id, 20)` | top 20 items by severity, then age                                                              | 20                                                        |

All three are `security definer` with the `can_read_board` guard per board (the pattern the
existing `dashboard_*` RPCs use), read only indexed columns (`items.board_id`, `items.group_id`,
`cell_values(item_id, column_id)`), and live in `src/lib/folders/widget-resolve.ts`-style
resolvers behind the typed RPC helper. Health flags reuse `_board_health_flags`.

**Interactions:** stage switch, board filter, tab switch between Overview/Stages/Boards, chart
cumulative/weekly, table sort — **0 new round-trips**; all derive from the first-paint payload in
client state. URL sync via `history.replaceState` only.

**People tab:** `folder_workload(folder_id)` (one row per person × stage) fetched once on first
open through a Server Action into TanStack Query, `staleTime` 60 s. Everything else on that tab
derives from it.

**Your widgets strip:** the existing batched `getWidgetsData` call per dashboard, unchanged; it
is below the fold and rendered lazily like today.

**Gallery `/dashboards`:** one RPC `folder_gallery(workspace_id)` returning per-folder counts
(boards, items, done, overdue, attention), bounded by folders in the workspace.

**Caching:** folder list and membership use `"use cache"` + `cacheTag(foldersTag(orgId))` on
the service client like `listDashboardsCached`; rollup/burn/attention are per-request (the RPCs
gate on `auth.uid()`, which is null under the service role — gotcha recorded in
`queries-cached.ts`).

## 7. Components

| Unit                                                                                              | Purpose                                                                                                                                                                                                     | Consumes                    | Produces                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `src/lib/folders/*`                                                                               | queries, RPC resolvers, stage normalisation (`stages.ts`), rollup shaping (`rollup.ts`), Zod (`src/lib/validations/folders.ts`), actions (create/rename/reorder folder, add/remove board, attach dashboard) | RPCs, `ActionResult`/`fail` | typed `FolderPayload`, `StageSummary[]`, `BoardRollup[]`, `BurnSeries` |
| `src/app/(app)/folders/[folderId]/page.tsx` + `loading.tsx` + `not-found.tsx`                     | RSC shell, first-paint fetch, tab default                                                                                                                                                                   | `src/lib/folders`           | props to `CommandCenter`                                               |
| `src/components/folders/CommandCenter.tsx` (client)                                               | header, tab strip, filter bar, URL state, tab switch                                                                                                                                                        | payload                     | renders tab components                                                 |
| `src/components/folders/tabs/{Overview,Stages,Boards,People}.tsx`                                 | tab bodies                                                                                                                                                                                                  | client state                | —                                                                      |
| `src/components/folders/charts/{KpiCard,BurnChart,StackedStatusBar,StageMatrix,WorkloadBars}.tsx` | pure presentational, no fetching, recharts kept out of first paint like `LazyChartWidget`                                                                                                                   | typed props                 | —                                                                      |
| `src/components/folders/FolderGallery.tsx`                                                        | `/dashboards` gallery                                                                                                                                                                                       | `folder_gallery`            | —                                                                      |
| `src/components/shell/sidebar-nav.tsx` (edit)                                                     | folder rows link to command centers                                                                                                                                                                         | shared folders              | —                                                                      |
| `src/app/(app)/dashboards/[dashboardId]/page.tsx` (edit)                                          | redirect when `folder_id` set                                                                                                                                                                               | —                           | —                                                                      |
| `src/app/globals.css` (edit)                                                                      | `@media print` rules for the Overview                                                                                                                                                                       | —                           | —                                                                      |

Existing primitives reused: `Kicker`, `MetaChip`, `StatusPill`, `ColorChip`, `DashboardCanvasLazy`,
`ItemPanel`, `chart.tsx`, `EmptyState`, `Skeleton`. New primitives: none beyond the chart set above.

## 8. Error and empty states

- Folder with no boards: Overview shows an empty state "Add boards to this folder" with the
  board picker; tabs are disabled.
- Boards with no groups: one implicit stage "All items"; the stage control is hidden.
- No due dates anywhere: burn chart replaced by "Add due dates to see planned vs completed";
  Gap to plan card shows "—".
- RPC failure: the page still renders header + tabs; the failed panel shows an inline retry.
- Redirect target folder deleted: `/dashboards/[id]` falls back to the legacy canvas.

## 9. Parallelization (working agreement #6)

Independent units, for the plan's execution DAG:

1. **Schema + RPCs + types** — migrations (folders, folder_boards, private-folder copy-forward
   and drop, `dashboards.folder_id`, five RPCs), `pnpm db:types`, RLS integration tests.
2. **Page shell + tabs + URL state** — `CommandCenter`, tab bodies with a typed fixture payload,
   0-refetch tests.
3. **Pure chart components** — KPI card, burn chart, stacked bar, stage matrix, workload bars,
   with fixture data and reduced-motion handling.
4. **Sidebar + gallery + redirect** — shared-folder sidebar, `/dashboards` gallery, dashboard
   redirect, ⌘K entries.
5. **Dashboard fold-in** — "Your widgets" strip, attach picker, "Add widget" / AI wizard entry
   relocation, `DashboardsNav` removal.
6. **Header extras** — print stylesheet + Export PDF, Share copy, Ask folder scope.

Dependencies: 3 depends on nothing; 2 depends on 1's types (can start on the fixture and rebase);
4, 5, 6 depend on 1. Critical path: 1 → 2 → integration. Units 2, 3, 4, 5, 6 run as parallel
worktrees after 1 merges; 3 can run alongside 1.

## 10. Testing

- **RLS integration** (`*.rls.integration.test.ts`, DEV, rolled-back): cross-org read denied;
  non-workspace-member write denied; `folder_boards` insert requires `can_read_board`.
- **RPC shape** (`*.integration.test.ts`): rollup rows sum to the board's top-level item count;
  burn buckets are contiguous weeks; attention never exceeds the limit; every RPC returns empty
  sets, not errors, for a folder with no boards.
- **Unit:** stage normalisation (trim/case/order/first-seen casing), rollup → KPI derivation,
  state kicker rules, band thresholds, gap-to-plan sign.
- **Component:** tab switch and stage switch trigger zero Server Action calls (spy on the action
  module, mirror of `no-recharts-in-first-paint.test.ts`); recharts absent from the first-paint
  bundle; print stylesheet hides nav and shows charts.
- **Migration:** copy-forward test on a fixture with two users sharing a folder name and a board
  in two folders.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before every merge.

## 11. Out of scope (v1)

Gates (dated checkpoints with criteria), Decisions log, a standalone Widgets tab, folder-level
brief generation (a new model call), configurable overload threshold, cross-workspace folders,
folder permissions beyond workspace membership.
