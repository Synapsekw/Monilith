# Phase-completion reporting dashboard — design

- **Date:** 2026-07-03
- **Status:** Spec written, awaiting review
- **Branch:** `task/phase-completion-dashboard`
- **Source:** MVP Final Features item 7 (feedback F5.4): "Reporting Dashboard — Phase
  Completion: Dashboard showing % completion for Phase 1 with breakdown by
  workstream/sub-group. Same for Phase 2."
- **Mode:** Non-interactive brainstorm — decisions the user would normally arbitrate are
  recorded in "Open questions for review" at the end.

## Gap analysis (verified against this worktree's code)

The user asks for: per-phase **% completion** with a **breakdown by workstream/sub-group**.
In Pulse's data model a "phase" is most naturally a **board** (or a group on a shared board)
and a "workstream/sub-group" is a **board group** (`public.groups` — the colored row-bands).

What today's dashboard stack (Phase 8 + D1–D3 + 9.3b) can and cannot express:

| Capability needed                                   | Exists today?                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group results **by board group** (workstream)       | **No.** Both RPCs (`dashboard_aggregate` in `20260617130000_dashboards.sql`, `dashboard_series` in `20260623130255_dashboard_series.sql`) group only by _cell-value_ dimensions: `status`, `dropdown`, `people`, `date`. `items.group_id` is not a dimension anywhere in the dashboards code or UI.     |
| A **% complete** metric from a percent column       | **No.** Measures are `count` / `sum` / `avg` over a **numbers** column, reading `value ->> 'n'`. Percent cells store `{ "percent": 0..100 }` (`percentValueSchema`, `src/lib/validations/boards.ts:149`), so `sum`/`avg` can't read them — and the config UI only offers `numbersColumns` for measures. |
| A **% done** metric from a status column            | **No.** `dashboard_aggregate` returns a status _distribution_ (count per option). The Battery widget renders each option's share of items, so "Done 40%" is visible — but there is no scalar "% of items whose status is in a chosen done-set", and no notion of _which_ options mean "done".           |
| Per-group **completion rollup** (one bar per group) | **No.** Battery is one bar for the whole board; Chart can split by status/dropdown/people/date but not by board group; Number is a single scalar.                                                                                                                                                       |
| Scoping a non-list widget to a subset of items      | **No.** Only the List widget has a filter (`dashboard_list_rows`); chart/number/battery aggregate the whole source board.                                                                                                                                                                               |

**Closest existing proxy:** if each phase is its own board, one Battery widget per board
shows the status distribution incl. a "Done x%" legend entry. That is item-count share per
status — not a completion rollup (no percent-column weighting, no per-workstream breakdown,
no explicit done-set), so it does not satisfy the request.

**Verdict: real gap — not expressible with existing widgets or a preset.** Both the
dimension (board group) and the metric (% complete) are missing from the aggregation layer.
The minimal closure is **one new widget kind (`completion`) backed by one new bounded RPC**,
reusing the entire existing widget pipeline (config sheet, batched data fetch, 9.3b
aggregation cache, canvas/layout, RLS pattern). No new engine, no new page, no changes to
existing widgets.

## Goals

1. A **Completion widget**: for one source board, show **overall % completion** and a
   **per-group breakdown** (one row per board group: name, progress bar, %).
2. Two completion semantics, user-chosen:
   - **Percent mode** — average of a percent column (weighted rollup of `% complete`).
   - **Status mode** — share of items whose status is in a user-chosen "counts as done"
     option set (precedent: goals' `doneColumnId` + `doneOptionIds`,
     `src/lib/validations/goals.ts:58`).
3. "Phase 1 / Phase 2" is satisfied by adding one widget per phase board — or, when phases
   are modeled as groups on a single board, one widget whose rows _are_ the phases.
4. Full pipeline parity: RLS-safe RPC, `use cache` + `widgetAggregationTag` (9.3b), batched
   dashboard fetch (one round-trip), config validated by Zod at the boundary.

## Non-goals

- No filters on the completion widget (parity with battery/chart; List keeps its filter).
- No cross-board "program" rollup (portfolios already do board-level rollups).
- No AI-generation support: `PROPOSAL_JSON_SCHEMA` (src/lib/ai/proposal-schema.ts) keeps its
  current four branches, so the AI wizard simply never proposes a completion widget (adding
  a branch risks the 24-optional-param structured-output cap noted there). Follow-up if
  wanted.
- No changes to `dashboard_aggregate` / `dashboard_series` or existing widgets.
- No subitem-aware weighting beyond the top-level rule below.

## Design

### Data model & migration

One migration, two statements:

1. `alter type public.widget_kind add value 'completion';`
   (PG 12+ allows this in a transaction as long as the value isn't _used_ in the same
   transaction — the migration must not insert/reference `'completion'` after adding it.)
2. New RPC, same shape/conventions as `dashboard_aggregate` (security definer,
   `set search_path = ''`, `is_org_member` guard, `grant execute to authenticated`):

```sql
create or replace function public.dashboard_completion(
  p_board_id        uuid,
  p_mode            text,               -- 'percent' | 'status'
  p_value_column_id uuid,               -- percent column OR status column (per mode)
  p_done_option_ids jsonb default '[]'::jsonb  -- status mode: option ids counted as done
) returns table (group_key uuid, item_count integer, completion numeric)
```

Semantics (single `GROUP BY i.group_id` over one board's items):

- Scope: `i.board_id = p_board_id and i.parent_id is null` — **top-level items only**.
  Counting parents _and_ their subitems would double-weight; parent percent/status cells
  are the canonical "activity" state (and item 9's automations sync them). Uses
  `items_board_id_idx`; `items_parent_id_idx` exists for the predicate.
- **percent mode:** `completion = avg( least(greatest(coalesce((cv.value->>'percent')::numeric, 0), 0), 100) )`
  — an item with an **empty percent cell counts as 0%** (unstarted work is honestly
  incomplete, matching how a PM reads "% completion of the phase").
- **status mode:** `completion = 100.0 * count(*) filter (where cv.value->>'optionId' in (select value from jsonb_array_elements_text(p_done_option_ids))) / count(*)`.
- `item_count = count(*)` per group, so the client computes the **overall** as the
  item-weighted mean: `sum(completion × item_count) / sum(item_count)` (never an unweighted
  mean of group percentages).
- Groups with zero top-level items simply don't appear in the result (see UI: rendered as
  "—" rows, excluded from the overall).
- Validation inside the RPC: reject unknown `p_mode`; board-not-found / non-member raise
  exactly like `dashboard_aggregate`.

Bounded + indexed: the read touches one board's items via `items_board_id_idx`; the
cell-value join hits the existing `(item_id, column_id)` access path used by both existing
RPCs; output is ≤ #groups on the board (groups are user-managed row bands — tens, not
thousands; the group-meta read below is capped anyway).

After the migration: `pnpm db:types` regenerates `database.types.ts` (the `widget_kind`
enum gains `'completion'` and the RPC signature appears — this removes the need for any
`any` cast in the action layer). Per repo policy the SQL is applied to cloud dev **manually
by the user** (agent classifier blocks `db push`); the agent then verifies and regenerates
types.

### Validation (Zod, `src/lib/validations/dashboards.ts`)

```ts
export const completionConfigSchema = z
  .object({
    mode: z.enum(["percent", "status"]),
    percentColumnId: uuid.optional(),
    statusColumnId: uuid.optional(),
    doneOptionIds: z.array(uuid).max(50).default([]),
  })
  .refine((c) => c.mode !== "percent" || !!c.percentColumnId, {
    message: "Percent mode needs a percent column.",
    path: ["percentColumnId"],
  })
  .refine((c) => c.mode !== "status" || !!c.statusColumnId, {
    message: "Status mode needs a status column.",
    path: ["statusColumnId"],
  })
  .refine((c) => c.mode !== "status" || c.doneOptionIds.length > 0, {
    message: "Pick at least one status that counts as done.",
    path: ["doneOptionIds"],
  });
```

`widgetKindSchema` gains `"completion"`; `configSchemaForKind` routes to it. No action
input schemas change (`createWidget` / `updateWidgetConfig` already validate per-kind).

### Server read path (reuses the 9.3b widget-aggregation cache)

New cached fn in `src/lib/dashboards/queries-cached.ts`, sibling of
`getWidgetAggregationCached` and sharing its exact cache contract:

```ts
export type CompletionGroupRow = {
  groupKey: string;
  itemCount: number;
  completion: number;
};
export type GroupMeta = { id: string; label: string; color: string };
export type WidgetCompletion =
  | { ok: true; rows: CompletionGroupRow[]; groups: GroupMeta[] }
  | { ok: false; error: string };

export async function getWidgetCompletionCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
}): Promise<WidgetCompletion>;
```

- `"use cache"` + `cacheLife("widget")` (30 s TTL, `next.config.ts` profile) +
  `cacheTag(widgetAggregationTag(orgId, widgetId))` — the **same tag** the existing
  mutations already `updateTag` on create/config-edit/delete, so read-your-own-writes on
  config saves works with **zero new invalidation code**.
- Runs the RPC via the service client (orgId/boardId resolved server-side from the widget
  row by the caller, exactly like the aggregate path — tenant isolation by construction).
- Resolves group meta server-side (like `columnMeta`): `select id, name, color from groups
where board_id = … order by position limit 100` (`groups_board_id_idx`), so group
  renames/recolors surface within the TTL without a stale client snapshot.

Action plumbing (`src/lib/dashboards/actions.ts`): completion widgets join the existing
**batched** fetch. `usesAggregateData()` (in `use-widget-data.tsx`) adds `"completion"`;
`resolveWidgetAggregate` branches on `widget.kind === "completion"` to call the new cached
fn. `WidgetAggregatePayload` gains an optional `completion?: { rows; groups }` field
(buckets stay `[]`, columnMeta `null` for this kind) — the discriminated
`WidgetDataResult` slot shape and the provider/context are otherwise untouched, so one
widget's failure still can't blank the rest, and layout drags still never refetch.

### Shaping (pure, `src/lib/dashboards/widget-data.ts`)

`shapeCompletion(rows, groups)` → display model, unit-tested like `shapeBuckets`:

- one row per **group** in board position order: `{ key, label, color, percent, itemCount }`;
  groups absent from `rows` (no top-level items) get `percent: null` (rendered "—");
- unknown group keys (race: group deleted inside the TTL) fold into an "Unknown" row,
  mirroring `shapeBuckets`;
- `overall` = item-weighted mean across rows with data; `null` when the board has no items.

### UI

**`CompletionWidget.tsx`** (`src/components/dashboards/widgets/`, client, no recharts —
plain DOM like `BatteryWidget`, stays out of the lazy chart chunk):

- **Header:** overall percentage, `text-2xl font-semibold tabular-nums`, with a muted
  "Overall" caption (`text-muted-foreground text-xs`). Monochrome — chrome earns no color.
- **Rows** (one per group, compact, `overflow-y-auto` when the tile is short): group color
  dot (`size-2.5 rounded-sm`, the group's own `color` — user-data color, sanctioned exactly
  like status colors in Battery), group name (truncate), a thin progress bar
  (`h-2 rounded-full bg-muted` track; fill width = percent, color via the existing
  **`percentBandColor(percent)`** helper from `src/lib/boards/percent-color.ts` — the same
  red→green band ramp the board's percent column uses, keeping dataviz semantics consistent
  app-wide), and the percent right-aligned in `tabular-nums text-xs text-muted-foreground`.
  Color is redundant with the numeric label (AA / colorblind rule).
- Empty/config states mirror `BatteryWidget` verbatim: "Configure a source board and
  completion source" / pulse skeleton while loading / "Failed to load" / "No data yet".
- Kind switch added in `DashboardWidget.tsx` (static import — tiny component).

**Config form** (`WidgetConfigForm.tsx`): new `completion` branch —

1. "Completion source" select: _Percent column_ / _Status (done options)_.
2. Percent mode → percent-column select (`BoardOption` gains `percentColumns`, populated in
   `src/app/(app)/dashboards/[dashboardId]/page.tsx` by filtering `kind === "percent"`).
3. Status mode → status-column select + a checkbox list of that column's options ("Counts
   as done"), reading options from the existing `allColumns` payload. When the column is
   first picked, options whose label matches `/done|complete|finished/i` are pre-checked
   (editable). Options render with their color chip + label (never color alone).
4. Helper text when the board has no percent column ("Add a Percent column…") and no status
   column, mirroring the numbers-column hints.
5. Widget-type select and `defaultConfig()` gain the `completion` entry
   (`{ mode: "status", doneOptionIds: [] }` — status columns are near-universal; percent
   columns are rarer).

Everything uses the existing form idioms (native selects with `selectClass`, `Input`,
checkbox lists) — no new primitives.

## Performance & data-fetching budget (working agreement #5)

- **First paint:** unchanged RSC payload (`getDashboardPayload` + board options, as today).
  Completion widgets ride the **existing single batched `getWidgetsData` round-trip**
  together with number/battery widgets — **0 additional client→server round-trips** per
  dashboard regardless of how many completion widgets exist. Each widget body shows the
  standard skeleton until the batch resolves.
- **Interactions:**
  - Opening/editing the config sheet is **pure client draft state** (existing
    `WidgetDraft`) — 0 server reads while editing; board/column options are already on the
    page. Saving is a Server Action (`updateWidgetConfig`) — a server-data change, so
    Server Action + targeted invalidation is correct — which `updateTag`s the per-widget
    aggregation tag; the config-hash query key flips and **only that widget** refetches.
  - Layout drags never refetch (id+config-hash keys, unchanged).
  - No view toggles/tabs inside the widget → nothing to route through the History API.
- **Bounded + indexed hot path:** one `GROUP BY group_id` over a single board's top-level
  items (`items_board_id_idx`, `items_parent_id_idx`), cell join on the `(item_id,
column_id)` path both existing RPCs use; result ≤ #groups; group-meta read capped at 100
  over `groups_board_id_idx`. No unbounded `select *` anywhere.
- **Server aggregation cache:** reuses the Phase 9.3b infrastructure verbatim —
  `cacheLife("widget")` (30 s stale / 300 s expire) keyed by org+widget+config, tagged
  `widgetAggregationTag(orgId, widgetId)`; board-data freshness is TTL-bounded (same
  documented tradeoff as `getWidgetAggregationCached`), config edits are instant via
  `updateTag`. Client layer keeps `staleTime`-style dedup via TanStack Query batch key.

## Testing

- **Unit (Vitest):** `completionConfigSchema` branches (mode refinements, defaults);
  `shapeCompletion` (ordering by group position, empty-group "—" rows, unknown-group fold,
  weighted overall, zero-item board → null overall); `defaultConfig("completion")`.
- **Integration (serial project, existing pattern of `dashboard-series.integration.test.ts`):**
  `dashboard_completion` RPC — percent mode (empty cell counts as 0, clamping), status mode
  (done-set share), subitem exclusion, per-group rows + counts, non-member rejection,
  invalid mode rejection.
- **Component (RTL):** `CompletionWidget` states (unconfigured, loading, error, no data,
  rendered rows incl. "—" group and overall header); `WidgetConfigForm` completion branch
  (mode switch, done-options pre-check heuristic, validation hints).
- **Actions:** `getWidgetsData` returns a completion slot alongside aggregate slots; a
  completion widget's RPC failure doesn't blank sibling widgets.
- Full gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Independent units (for the plan's DAG)

1. Migration + types regen (RPC + enum) — no TS dependencies.
2. Zod config schema — pure, no dependency on 1.
3. Shaping helpers — pure, no dependency on 1 or 2.
4. Cached read + action plumbing — needs 1 (RPC types), 2 (schema), 3 (shapes).
5. Widget component + canvas switch — needs 3/4 interfaces.
6. Config form + BoardOption.percentColumns — needs 2 only.
7. RPC integration tests — needs 1.

## Open questions for review

1. **Phase = board vs. group.** The design assumes each phase is a board (widget per
   phase). If the requester models Phase 1/Phase 2 as _groups on one board_, one widget
   still shows a row per phase, but then there is no second-level workstream breakdown
   (sub-groups don't exist below groups). Confirm with the requester
   (irdhina.harith@accenture.com) which modeling they use; if it's "phases as groups with
   workstreams as boards", the breakdown dimension would need to be a dropdown column
   instead — status-mode + a future "breakdown by dropdown" option would cover it.
2. **Top-level-only scope.** Excluding subitems avoids double-weighting, but a team that
   tracks % only on subitems (parents left empty) would see parents drag completion to 0.
   Acceptable for MVP? (Item 9's Completed⇔100% automation will keep parents in sync going
   forward.)
3. **Empty percent cells count as 0%.** Alternative (skip empty cells) inflates completion
   early in a phase; 0% was chosen as the honest PM read. Flag if the requester expects
   "average of filled cells only".
4. **Default mode `status`.** Chosen because every board template ships a status column;
   percent columns are opt-in. Swap the default if phase boards in practice all carry a
   "% Complete" percent column.
5. **AI wizard parity** is out of scope (see Non-goals) — fast follow if the requester
   generates dashboards via AI.
