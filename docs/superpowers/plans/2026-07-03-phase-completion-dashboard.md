# Phase-Completion Dashboard Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `completion` dashboard widget kind showing overall % completion for a board
with a per-group (workstream) breakdown, in percent-column or status-done-set mode.

**Architecture:** One migration (a `widget_kind` enum value + a bounded `dashboard_completion`
RPC grouped by `items.group_id`), a cached server read reusing the Phase 9.3b
widget-aggregation cache (`cacheLife("widget")` + `widgetAggregationTag`), plumbed through the
existing batched `getWidgetsData` Server Action, plus a plain-DOM widget component and a
config-form branch. No changes to existing widgets or RPCs.

**Tech Stack:** Next.js 16 (App Router, Server Actions, `use cache`), Supabase (Postgres RPC,
RLS, security definer), Zod, TanStack Query, Vitest + RTL, Tailwind v4 tokens (pulse-ui).

**Spec:** `docs/superpowers/specs/2026-07-03-phase-completion-dashboard-design.md` — read it
first; it contains the gap analysis, semantics decisions, and the perf budget this plan
implements.

## Global Constraints

- Commit identity: `Danijel Jovanovic <info@synapse-solutions.ai>`; commit subjects lowercase
  after `type(scope):`; every commit gets a descriptive body + trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Stage explicitly by path (`git add <paths>`) — never `git add -A` / `-a`.
- **Migrations are applied to cloud dev manually by the user** (agent tooling is blocked from
  `db push` / DDL). Task 1 has an explicit STOP-and-hand-off step; `pnpm db:types` runs only
  after the user confirms the SQL is applied.
- TypeScript strict, no `any` (the RPC types exist after Task 1's regen — nothing needs a cast).
- Semantic tokens only in UI (`bg-muted`, `text-muted-foreground`, …) — no raw Tailwind colors.
- Never write arbitrary-value Tailwind classes (the square-bracket `var(...)` form) as literals
  in **markdown docs** — Tailwind scans committed `.md` and compiles them (known build-breaker;
  see memory "tailwind scans markdown docs"). In `.tsx` they're fine.
- All four gates must pass at the end: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## File structure (what exists / what changes)

| File                                                              | Change                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `supabase/migrations/20260703090000_dashboard_completion.sql`     | **Create** — enum value + `dashboard_completion` RPC                      |
| `src/types/database.types.ts`                                     | Regenerated (`pnpm db:types`) — never hand-edit                           |
| `src/lib/validations/dashboards.ts` (+ `.test.ts`)                | Add `"completion"` kind + `completionConfigSchema`                        |
| `src/lib/dashboards/widget-data.ts` (+ `.test.ts`)                | Add `CompletionGroupRow`/`GroupMeta`/`shapeCompletion`                    |
| `src/lib/dashboards/queries-cached.ts`                            | Add `getWidgetCompletionCached`                                           |
| `src/lib/dashboards/actions.ts` (+ `.test.ts`)                    | `resolveWidgetAggregate` completion branch; payload gains `completion?`   |
| `src/lib/dashboards/use-widget-data.tsx` (+ `.test.tsx`)          | Batch includes completion kind; `WidgetData.completion`                   |
| `src/lib/dashboards/dashboard-completion.integration.test.ts`     | **Create** — RPC semantics + auth contract                                |
| `src/components/dashboards/widgets/CompletionWidget.tsx` (+ test) | **Create** — widget body                                                  |
| `src/components/dashboards/DashboardWidget.tsx`                   | Render switch gains completion                                            |
| `src/components/dashboards/WidgetConfigSheet.tsx`                 | Preview switch gains completion                                           |
| `src/components/dashboards/WidgetConfigForm.tsx` (+ test)         | `completion` config branch; `BoardOption.percentColumns`; `defaultConfig` |
| `src/app/(app)/dashboards/[dashboardId]/page.tsx`                 | Populate `percentColumns`                                                 |

---

### Task 1: Migration — `widget_kind` enum value + `dashboard_completion` RPC + types regen

**Files:**

- Create: `supabase/migrations/20260703090000_dashboard_completion.sql`
- Modify (generated): `src/types/database.types.ts`

**Interfaces:**

- Consumes: existing tables `boards`, `groups`, `items` (`parent_id`, `group_id`,
  `items_board_id_idx`, `items_parent_id_idx`), `cell_values` (`item_id`, `column_id`),
  helper `public.is_org_member(uuid)`.
- Produces: SQL fn
  `public.dashboard_completion(p_board_id uuid, p_mode text, p_value_column_id uuid, p_done_option_ids jsonb default '[]') returns table (group_key uuid, item_count integer, completion numeric)`;
  enum `public.widget_kind` gains `'completion'`. After regen, TS callers get
  `supabase.rpc("dashboard_completion", { p_board_id, p_mode, p_value_column_id, p_done_option_ids })`
  → rows `{ group_key: string; item_count: number; completion: number }[]`, and
  `Tables<"dashboard_widgets">["kind"]` includes `"completion"`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260703090000_dashboard_completion.sql`:

```sql
-- Completion widget (MVP Final item 7): % completion per board group (workstream).
-- percent mode: avg of a percent column (empty cell = 0, clamped 0..100).
-- status mode: share of items whose status optionId is in the "done" set.
-- Top-level items only (parent_id is null) — parents are the canonical activity
-- state; counting subitems too would double-weight (see design spec).
-- NOTE: the added enum value must NOT be used later in this same migration
-- (PG allows ADD VALUE in a transaction only if unused within it) — it isn't.

alter type public.widget_kind add value if not exists 'completion';

create or replace function public.dashboard_completion(
  p_board_id        uuid,
  p_mode            text,               -- 'percent' | 'status'
  p_value_column_id uuid,               -- percent column OR status column, per mode
  p_done_option_ids jsonb default '[]'::jsonb
) returns table (group_key uuid, item_count integer, completion numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_done   text[];
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if p_mode not in ('percent', 'status') then
    raise exception 'invalid mode %', p_mode using errcode = '22023';
  end if;

  if p_mode = 'percent' then
    return query
    select i.group_id,
           count(*)::int,
           round(avg(least(greatest(
             coalesce((cv.value ->> 'percent')::numeric, 0), 0), 100)), 1)
    from public.items i
    left join public.cell_values cv
      on cv.item_id = i.id and cv.column_id = p_value_column_id
    where i.board_id = p_board_id and i.parent_id is null
    group by i.group_id;
  else
    v_done := array(select jsonb_array_elements_text(p_done_option_ids));
    return query
    select i.group_id,
           count(*)::int,
           round(100.0 * count(*) filter (
             where (cv.value ->> 'optionId') = any (v_done)) / count(*), 1)
    from public.items i
    left join public.cell_values cv
      on cv.item_id = i.id and cv.column_id = p_value_column_id
    where i.board_id = p_board_id and i.parent_id is null
    group by i.group_id;
  end if;
end; $$;

grant execute on function public.dashboard_completion(uuid, text, uuid, jsonb)
  to authenticated;

-- Access paths: items_board_id_idx (board filter), items_parent_id_idx
-- (top-level predicate), cell_values (item_id, column_id) — same as
-- dashboard_aggregate / dashboard_series. Output rows = #groups on the board.
```

- [ ] **Step 2: STOP — hand the SQL to the user for manual apply**

Agent tooling cannot push migrations or run DDL against cloud dev (classifier-blocked).
Post the full file content and ask the user to run it against the **dev** project (SQL
editor), then confirm. Do not proceed until confirmed. Also remind: the same file ships in
the repo so `supabase/migrations/` stays the source of truth; if the user applies it under a
different version string, note the `migration repair` gotcha
(`vault`/memory: supabase migration ledger drift).

- [ ] **Step 3: Verify the RPC exists and regenerate types**

Verify (read-only, via MCP `execute_sql` or ask the user):
`select proname from pg_proc where proname = 'dashboard_completion';` → 1 row.

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` diff shows `widget_kind: "number" | "chart" | "battery" | "list" | "completion"` and a `dashboard_completion` entry under `Functions`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (enum widening is additive; nothing narrows on it exhaustively except
`DashboardWidget`'s render chain, which has a fallback branch).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703090000_dashboard_completion.sql src/types/database.types.ts
git commit -m "feat(db): dashboard_completion rpc + completion widget kind"
```

(Body: what the RPC computes, top-level-only rule, manual-apply note. Trailer per Global
Constraints.)

---

### Task 2: Zod config schema for the completion widget

**Files:**

- Modify: `src/lib/validations/dashboards.ts` (widgetKindSchema line 7; add schema after
  `batteryConfigSchema` line 64–65; extend `configSchemaForKind` line 109)
- Test: `src/lib/validations/dashboards.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks (pure Zod).
- Produces: `widgetKindSchema` = `z.enum(["number","chart","battery","list","completion"])`;
  `completionConfigSchema` and `export type CompletionConfig = z.infer<typeof completionConfigSchema>`
  with shape `{ mode: "percent" | "status"; percentColumnId?: string; statusColumnId?: string; doneOptionIds: string[] }`;
  `configSchemaForKind("completion")` → that schema. Tasks 4/6/7 rely on these exact
  config key names.

- [ ] **Step 1: Write the failing tests** (append to `dashboards.test.ts`, following the
      file's existing per-schema describe pattern)

```ts
describe("completionConfigSchema", () => {
  it("accepts percent mode with a percent column", () => {
    const r = completionConfigSchema.safeParse({
      mode: "percent",
      percentColumnId: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.doneOptionIds).toEqual([]); // default applied
  });

  it("rejects percent mode without a percent column", () => {
    const r = completionConfigSchema.safeParse({ mode: "percent" });
    expect(r.success).toBe(false);
  });

  it("accepts status mode with a status column and a done set", () => {
    const r = completionConfigSchema.safeParse({
      mode: "status",
      statusColumnId: "11111111-1111-1111-1111-111111111111",
      doneOptionIds: ["22222222-2222-2222-2222-222222222222"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects status mode without a status column", () => {
    const r = completionConfigSchema.safeParse({
      mode: "status",
      doneOptionIds: ["22222222-2222-2222-2222-222222222222"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects status mode with an empty done set", () => {
    const r = completionConfigSchema.safeParse({
      mode: "status",
      statusColumnId: "11111111-1111-1111-1111-111111111111",
      doneOptionIds: [],
    });
    expect(r.success).toBe(false);
  });

  it("routes via configSchemaForKind", () => {
    const r = configSchemaForKind("completion").safeParse({
      mode: "percent",
      percentColumnId: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
  });
});
```

Add `completionConfigSchema` to the file's import list from `@/lib/validations/dashboards`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: FAIL — `completionConfigSchema` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/validations/dashboards.ts`:

```ts
export const widgetKindSchema = z.enum([
  "number",
  "chart",
  "battery",
  "list",
  "completion",
]);
```

After `batteryConfigSchema`:

```ts
// Completion widget: % complete per board group. percent mode averages a
// percent column; status mode measures the share of items whose status is in
// the "counts as done" option set (precedent: goals doneColumnId/doneOptionIds).
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
export type CompletionConfig = z.infer<typeof completionConfigSchema>;
```

In `configSchemaForKind`, add before `default`:

```ts
    case "completion":
      return completionConfigSchema;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts
git commit -m "feat(dashboards): completion widget config schema"
```

---

### Task 3: Pure shaping — `shapeCompletion`

**Files:**

- Modify: `src/lib/dashboards/widget-data.ts` (append after `bucketsTotal`)
- Test: `src/lib/dashboards/widget-data.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks (pure).
- Produces (Tasks 4/7 import these exact names from `@/lib/dashboards/widget-data`):

```ts
export type CompletionGroupRow = {
  groupKey: string;
  itemCount: number;
  completion: number;
};
export type GroupMeta = { id: string; label: string; color: string };
export type ShapedCompletionRow = {
  key: string;
  label: string;
  color: string;
  percent: number | null; // null → group has no top-level items ("—")
  itemCount: number;
};
export type ShapedCompletion = {
  rows: ShapedCompletionRow[];
  overall: number | null; // item-weighted mean; null when 0 items total
  totalItems: number;
};
export function shapeCompletion(
  rows: CompletionGroupRow[],
  groups: GroupMeta[],
): ShapedCompletion;
```

- [ ] **Step 1: Write the failing tests** (append to `widget-data.test.ts`)

```ts
describe("shapeCompletion", () => {
  const groups = [
    { id: "g1", label: "Workstream A", color: "#0073ea" },
    { id: "g2", label: "Workstream B", color: "#00c875" },
    { id: "g3", label: "Empty group", color: "#999999" },
  ];

  it("emits one row per group in position order, weighted overall", () => {
    const shaped = shapeCompletion(
      [
        { groupKey: "g2", itemCount: 1, completion: 100 },
        { groupKey: "g1", itemCount: 3, completion: 50 },
      ],
      groups,
    );
    expect(shaped.rows.map((r) => r.key)).toEqual(["g1", "g2", "g3"]);
    expect(shaped.rows[0]).toMatchObject({ percent: 50, itemCount: 3 });
    expect(shaped.rows[2]).toMatchObject({ percent: null, itemCount: 0 });
    // weighted: (50*3 + 100*1) / 4 = 62.5 — never the unweighted mean (75)
    expect(shaped.overall).toBe(62.5);
    expect(shaped.totalItems).toBe(4);
  });

  it("folds unknown group keys into a trailing Unknown row", () => {
    const shaped = shapeCompletion(
      [
        { groupKey: "g1", itemCount: 2, completion: 100 },
        { groupKey: "deleted-group", itemCount: 2, completion: 0 },
      ],
      groups.slice(0, 1),
    );
    const last = shaped.rows[shaped.rows.length - 1];
    expect(last.label).toBe("Unknown");
    expect(last.percent).toBe(0);
    expect(shaped.overall).toBe(50);
  });

  it("returns null overall for an empty board", () => {
    const shaped = shapeCompletion([], groups);
    expect(shaped.overall).toBeNull();
    expect(shaped.totalItems).toBe(0);
    expect(shaped.rows.every((r) => r.percent === null)).toBe(true);
  });
});
```

Add `shapeCompletion` to the test file's import from `@/lib/dashboards/widget-data`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/dashboards/widget-data.test.ts`
Expected: FAIL — `shapeCompletion` is not exported.

- [ ] **Step 3: Implement** (append to `widget-data.ts`; reuses the module's `NONE_COLOR`)

```ts
/** Per-group completion as returned by the dashboard_completion RPC (camelCased). */
export type CompletionGroupRow = {
  groupKey: string;
  itemCount: number;
  completion: number;
};

/** Board-group metadata resolved server-side (id/name/color, position order). */
export type GroupMeta = { id: string; label: string; color: string };

export type ShapedCompletionRow = {
  key: string;
  label: string;
  color: string;
  /** null → the group has no top-level items (rendered as "—", excluded from overall). */
  percent: number | null;
  itemCount: number;
};

export type ShapedCompletion = {
  rows: ShapedCompletionRow[];
  /** Item-weighted mean across groups with data; null when the board has no items. */
  overall: number | null;
  totalItems: number;
};

/**
 * Join per-group completion rows to the board's groups for rendering:
 * - one row per group in board position order (0-item groups → percent null);
 * - unknown group keys (group deleted inside the cache TTL) fold into a
 *   trailing "Unknown" row, mirroring shapeBuckets;
 * - overall is the item-weighted mean (never an unweighted mean of groups).
 */
export function shapeCompletion(
  rows: CompletionGroupRow[],
  groups: GroupMeta[],
): ShapedCompletion {
  const byKey = new Map(rows.map((r) => [r.groupKey, r]));
  const known = new Set(groups.map((g) => g.id));

  const shaped: ShapedCompletionRow[] = groups.map((g) => {
    const r = byKey.get(g.id);
    return {
      key: g.id,
      label: g.label,
      color: g.color,
      percent: r ? r.completion : null,
      itemCount: r?.itemCount ?? 0,
    };
  });

  let unknownItems = 0;
  let unknownWeighted = 0;
  for (const r of rows) {
    if (known.has(r.groupKey)) continue;
    unknownItems += r.itemCount;
    unknownWeighted += r.completion * r.itemCount;
  }
  if (unknownItems > 0)
    shaped.push({
      key: "__unknown__",
      label: "Unknown",
      color: NONE_COLOR,
      percent: unknownWeighted / unknownItems,
      itemCount: unknownItems,
    });

  let totalItems = 0;
  let weighted = 0;
  for (const r of shaped) {
    if (r.percent === null) continue;
    totalItems += r.itemCount;
    weighted += r.percent * r.itemCount;
  }

  return {
    rows: shaped,
    overall: totalItems > 0 ? weighted / totalItems : null,
    totalItems,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/dashboards/widget-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/widget-data.ts src/lib/dashboards/widget-data.test.ts
git commit -m "feat(dashboards): shapeCompletion display model"
```

---

### Task 4: Cached read + batched-action plumbing

**Files:**

- Modify: `src/lib/dashboards/queries-cached.ts` (append)
- Modify: `src/lib/dashboards/actions.ts` (`WidgetAggregatePayload` ~line 270,
  `resolveWidgetAggregate` ~line 301)
- Modify: `src/lib/dashboards/use-widget-data.tsx` (`usesAggregateData` ~line 35,
  `WidgetData` ~line 15, `useWidgetData` return mapping ~line 130)
- Test: `src/lib/dashboards/actions.test.ts`, `src/lib/dashboards/use-widget-data.test.tsx`

**Interfaces:**

- Consumes: Task 1 RPC types (`supabase.rpc("dashboard_completion", …)`); Task 2 kind
  `"completion"` in `widgetKindSchema`; Task 3 types `CompletionGroupRow`, `GroupMeta` from
  `@/lib/dashboards/widget-data`.
- Produces:
  - `getWidgetCompletionCached(input: { widgetId: string; orgId: string; boardId: string; config: Record<string, unknown> }): Promise<WidgetCompletion>`
    where `type WidgetCompletion = { ok: true; rows: CompletionGroupRow[]; groups: GroupMeta[] } | { ok: false; error: string }` (exported from `queries-cached.ts`);
  - `WidgetAggregatePayload` gains `completion?: { rows: CompletionGroupRow[]; groups: GroupMeta[] }`;
  - client `WidgetData` (from `use-widget-data.tsx`) gains
    `completion: { rows: CompletionGroupRow[]; groups: GroupMeta[] } | null`
    — Task 7's `CompletionWidget` reads `data.completion`.

- [ ] **Step 1: Write the failing tests**

In `actions.test.ts`, extend the existing `getWidgetsData` mock-based suite (follow the
file's established supabase-mock pattern for widget rows) with a completion widget row:

```ts
it("resolves a completion widget slot via the completion cached read", async () => {
  // widget row: { id: "w-c", kind: "completion", org_id: "org1",
  //   source_board_id: "b1", config: { mode: "status",
  //   statusColumnId: STATUS_COL, doneOptionIds: [DONE_OPT] } }
  // mock getWidgetCompletionCached → { ok: true,
  //   rows: [{ groupKey: "g1", itemCount: 2, completion: 50 }],
  //   groups: [{ id: "g1", label: "WS A", color: "#0073ea" }] }
  const res = await getWidgetsData({ widgetIds: ["w-c"] });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const slot = res.data.results["w-c"];
  expect(slot.ok).toBe(true);
  if (!slot.ok) return;
  expect(slot.kind).toBe("completion");
  expect(slot.completion?.rows[0]).toMatchObject({
    groupKey: "g1",
    completion: 50,
  });
  expect(slot.buckets).toEqual([]);
});

it("a completion widget's failure does not blank sibling slots", async () => {
  // mock getWidgetCompletionCached → { ok: false, error: "boom" } for "w-c",
  // aggregate mock healthy for "w-n" (number widget)
  const res = await getWidgetsData({ widgetIds: ["w-c", "w-n"] });
  if (!res.ok) return;
  expect(res.data.results["w-c"].ok).toBe(false);
  expect(res.data.results["w-n"].ok).toBe(true);
});
```

(Mock `@/lib/dashboards/queries-cached` with `vi.mock`, exactly as the file already mocks it
for `getWidgetAggregationCached` — add `getWidgetCompletionCached` to that mock module.)

In `use-widget-data.test.tsx`, extend the provider suite:

```ts
it("includes completion widgets in the batch and exposes data.completion", async () => {
  // widgets: [{ id: "w-c", kind: "completion", config: {...} }]
  // mock getWidgetsData → slot { ok: true, kind: "completion", config: {},
  //   buckets: [], columnMeta: null,
  //   completion: { rows: [...], groups: [...] } }
  // render hook consumer for "w-c"; expect data.completion?.rows to be defined
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/dashboards/actions.test.ts src/lib/dashboards/use-widget-data.test.tsx`
Expected: FAIL — `getWidgetCompletionCached` not exported / `completion` missing from types.

- [ ] **Step 3: Implement the cached read** (append to `queries-cached.ts`)

```ts
import type {
  AggregateBucket,
  ColumnMeta,
  CompletionGroupRow,
  GroupMeta,
} from "@/lib/dashboards/widget-data"; // extend the existing import line 7

export type WidgetCompletion =
  | { ok: true; rows: CompletionGroupRow[]; groups: GroupMeta[] }
  | { ok: false; error: string };

/**
 * Cached completion read for the Completion widget — the 9.3b contract verbatim:
 * caller resolves orgId/boardId from the widget row (tenant boundary), the entry
 * is keyed by org+widget+config and tagged widgetAggregationTag so the existing
 * create/update/delete updateTag calls invalidate it with zero new code.
 * Board-data freshness is TTL-bounded (cacheLife "widget", ~30s), same tradeoff
 * as getWidgetAggregationCached. Group meta (name/color, position order) is
 * resolved here so renames/recolors surface within the TTL.
 */
export async function getWidgetCompletionCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
}): Promise<WidgetCompletion> {
  "use cache";
  cacheLife("widget");
  cacheTag(widgetAggregationTag(input.orgId, input.widgetId));

  const mode = (input.config.mode as string) ?? "status";
  const valueColumnId =
    mode === "percent"
      ? ((input.config.percentColumnId as string | undefined) ?? null)
      : ((input.config.statusColumnId as string | undefined) ?? null);
  // Unconfigured widget → empty result (widget renders its configure state).
  if (!valueColumnId) return { ok: true, rows: [], groups: [] };

  const supabase = createServiceClient();
  const [rpc, groupsRes] = await Promise.all([
    supabase.rpc("dashboard_completion", {
      p_board_id: input.boardId,
      p_mode: mode,
      p_value_column_id: valueColumnId,
      p_done_option_ids: ((input.config.doneOptionIds as string[]) ??
        []) as Json,
    }),
    supabase
      .from("groups")
      .select("id, name, color")
      .eq("board_id", input.boardId)
      .order("position", { ascending: true })
      .limit(100), // bounded: groups are user-managed row bands (groups_board_id_idx)
  ]);
  if (rpc.error) return { ok: false, error: rpc.error.message };

  return {
    ok: true,
    rows: (rpc.data ?? []).map((r) => ({
      groupKey: r.group_key,
      itemCount: Number(r.item_count),
      completion: Number(r.completion),
    })),
    groups: (groupsRes.data ?? []).map((g) => ({
      id: g.id,
      label: g.name,
      color: g.color,
    })),
  };
}
```

Add `import type { Json } from "@/types/database.types";` to the file's imports.

- [ ] **Step 4: Plumb through the actions layer** (`actions.ts`)

Extend the payload type:

```ts
export type WidgetAggregatePayload = {
  kind: Widget["kind"];
  config: Record<string, unknown>;
  buckets: AggregateBucket[];
  columnMeta: ColumnMeta | null;
  /** Present only for completion widgets. */
  completion?: { rows: CompletionGroupRow[]; groups: GroupMeta[] };
};
```

(import `CompletionGroupRow`, `GroupMeta` from `@/lib/dashboards/widget-data`, and
`getWidgetCompletionCached` from `@/lib/dashboards/queries-cached`.)

In `resolveWidgetAggregate`, after the `!widget.source_board_id` early return:

```ts
const config = (widget.config ?? {}) as Record<string, unknown>;

if (widget.kind === "completion") {
  const result = await getWidgetCompletionCached({
    widgetId,
    orgId: widget.org_id,
    boardId: widget.source_board_id,
    config,
  });
  if (!result.ok) return fail(result.error);
  return {
    ok: true,
    data: {
      kind: widget.kind,
      config,
      buckets: [],
      columnMeta: null,
      completion: { rows: result.rows, groups: result.groups },
    },
  };
}
```

(The existing aggregate path below is unchanged; it already declares `config` — dedupe so
`config` is computed once at the top.)

- [ ] **Step 5: Plumb through the client hook** (`use-widget-data.tsx`)

```ts
export type WidgetData = {
  buckets: AggregateBucket[];
  columnMeta: ColumnMeta | null;
  /** Completion widgets only; null for aggregate kinds. */
  completion: { rows: CompletionGroupRow[]; groups: GroupMeta[] } | null;
};
```

```ts
function usesAggregateData(kind: CacheWidget["kind"]): boolean {
  return kind === "number" || kind === "battery" || kind === "completion";
}
```

In `useWidgetData`'s return:

```ts
    data: entry?.ok
      ? {
          buckets: entry.buckets,
          columnMeta: entry.columnMeta,
          completion: entry.completion ?? null,
        }
      : undefined,
```

(import the two types from `@/lib/dashboards/widget-data`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/dashboards/actions.test.ts src/lib/dashboards/use-widget-data.test.tsx src/lib/dashboards/queries-cached.test.ts`
Expected: PASS (queries-cached existing tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboards/queries-cached.ts src/lib/dashboards/actions.ts \
  src/lib/dashboards/use-widget-data.tsx src/lib/dashboards/actions.test.ts \
  src/lib/dashboards/use-widget-data.test.tsx
git commit -m "feat(dashboards): cached completion read via batched widget fetch"
```

---

### Task 5: RPC integration test

**Files:**

- Create: `src/lib/dashboards/dashboard-completion.integration.test.ts`

**Interfaces:**

- Consumes: Task 1's deployed RPC; existing helpers `loadIntegrationEnv`,
  `integrationTargetReady` (`@/test/integration-env`), `signInWithRetry`
  (`@/test/integration-auth`), and the provisioning pattern from
  `src/lib/dashboards/dashboards.rls.integration.test.ts` (provision user → `create_organization`
  → board/groups/items/columns/cells via RPCs + inserts).
- Produces: nothing consumed downstream (verification only).

- [ ] **Step 1: Write the test file**

Follow `dashboards.rls.integration.test.ts` verbatim for env-gating
(`describe.runIf(integrationTargetReady())`), user provisioning, and the serial project
placement (integration suites already run serial — see vitest config). Provision one board
with two groups; then:

- Group A: 2 top-level items with percent cells 50 and 100; 1 subitem (parent_id set) with
  percent 0. Group B: 1 item with **no** percent cell.
- Status column with options `done-id`, `wip-id`; Group A items get `done-id` and `wip-id`;
  Group B item gets no status cell.

Assertions:

```ts
it("percent mode: averages per group, empty cell = 0, subitems excluded", async () => {
  const { data, error } = await client.rpc("dashboard_completion", {
    p_board_id: boardId,
    p_mode: "percent",
    p_value_column_id: percentColId,
  });
  expect(error).toBeNull();
  const byGroup = new Map((data ?? []).map((r) => [r.group_key, r]));
  expect(byGroup.get(groupAId)).toMatchObject({
    item_count: 2,
    completion: 75,
  });
  expect(byGroup.get(groupBId)).toMatchObject({ item_count: 1, completion: 0 });
});

it("status mode: share of items in the done set", async () => {
  const { data } = await client.rpc("dashboard_completion", {
    p_board_id: boardId,
    p_mode: "status",
    p_value_column_id: statusColId,
    p_done_option_ids: [doneOptId],
  });
  const byGroup = new Map((data ?? []).map((r) => [r.group_key, r]));
  expect(byGroup.get(groupAId)?.completion).toBe(50); // 1 of 2 done
  expect(byGroup.get(groupBId)?.completion).toBe(0);
});

it("rejects an invalid mode", async () => {
  const { error } = await client.rpc("dashboard_completion", {
    p_board_id: boardId,
    p_mode: "bogus",
    p_value_column_id: percentColId,
  });
  expect(error).not.toBeNull();
});

it("rejects a non-member / unknown board", async () => {
  const { error } = await anonClient.rpc("dashboard_completion", {
    p_board_id: "00000000-0000-0000-0000-000000000000",
    p_mode: "percent",
    p_value_column_id: "00000000-0000-0000-0000-000000000000",
  });
  expect(error).not.toBeNull();
});
```

(Exact provisioning calls: copy the helper block from `dashboards.rls.integration.test.ts`;
create groups/items with plain inserts through the signed-in client — RLS permits members —
and cells via the same `cell_values` upsert used there. Where that file lacks a needed
helper, `dashboard-series.integration.test.ts` and `boards` integration suites show the
insert shapes.)

- [ ] **Step 2: Run the suite**

Run: `pnpm vitest run src/lib/dashboards/dashboard-completion.integration.test.ts`
Expected: PASS against the dedicated test project (`.env.test` present); SKIP cleanly
otherwise. Note: this suite requires Task 1's SQL to also be applied to the **test**
project — hand the user the same file for it, or run the suite only after they confirm.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboards/dashboard-completion.integration.test.ts
git commit -m "test(dashboards): dashboard_completion rpc integration coverage"
```

---

### Task 6: Config form branch + board options

**Files:**

- Modify: `src/components/dashboards/WidgetConfigForm.tsx` (`BoardOption` line 15,
  widget-type select line 176, kind branches line 213–285, `defaultConfig` line 290)
- Modify: `src/app/(app)/dashboards/[dashboardId]/page.tsx` (BoardOption mapping line 43)
- Test: `src/components/dashboards/WidgetConfigForm.test.tsx`

**Interfaces:**

- Consumes: Task 2's config keys (`mode`, `percentColumnId`, `statusColumnId`,
  `doneOptionIds`).
- Produces: `BoardOption` gains `percentColumns: { id: string; name: string }[]` (Task 7's
  sheet preview and existing tests' fixtures must include it);
  `defaultConfig("completion")` → `{ mode: "status", doneOptionIds: [] }`.

- [ ] **Step 1: Write the failing tests** (extend `WidgetConfigForm.test.tsx`, following its
      existing render/fixture pattern; add `percentColumns: []` to existing board fixtures)

```ts
it("offers the completion kind and defaults to status mode", async () => {
  // select widget type "completion"; expect a "Completion source" select with
  // value "status" and a "Status column" select listing board.statusColumns
});

it("percent mode shows the percent-column select", async () => {
  // switch Completion source to "percent"; expect a "Percent column" select
  // listing board.percentColumns; helper text when percentColumns is empty
});

it("picking a status column pre-checks done-like options", async () => {
  // board fixture: status column with options "Done", "In Progress", "Complete"
  // pick the column; expect checkboxes for all options, with "Done" and
  // "Complete" checked (label match /done|complete|finished/i), editable
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/dashboards/WidgetConfigForm.test.tsx`
Expected: FAIL — no completion option in the kind select.

- [ ] **Step 3: Implement**

`BoardOption` (line 15) gains:

```ts
percentColumns: {
  id: string;
  name: string;
}
[];
```

`page.tsx` mapping (after `dropdownColumns`):

```ts
      percentColumns: cols
        .filter((c) => c.kind === "percent")
        .map((c) => ({ id: c.id, name: c.name })),
```

Widget-type select gains `<option value="completion">Completion</option>`.

`defaultConfig` gains:

```ts
    case "completion":
      return { mode: "status", doneOptionIds: [] };
```

New branch in the kind chain (`value.kind === "completion"`) rendering a module-scope
`CompletionFields` component (same pattern as `NumberFields`):

```tsx
function CompletionFields({
  board,
  cfg,
  patchConfig,
}: {
  board: BoardOption | undefined;
  cfg: Record<string, unknown>;
  patchConfig: (n: Record<string, unknown>) => void;
}) {
  const mode = (cfg.mode as string) ?? "status";
  const statusCols = board?.statusColumns ?? [];
  const percentCols = board?.percentColumns ?? [];
  const statusColumnId = (cfg.statusColumnId as string) ?? "";
  const options =
    board?.allColumns.find((c) => c.id === statusColumnId)?.options ?? [];
  const doneOptionIds = (cfg.doneOptionIds as string[]) ?? [];

  return (
    <>
      <label className="text-sm">
        Completion source
        <select
          aria-label="Completion source"
          className={selectClass}
          value={mode}
          onChange={(e) =>
            patchConfig(
              e.target.value === "percent"
                ? {
                    mode: "percent",
                    statusColumnId: undefined,
                    doneOptionIds: [],
                  }
                : { mode: "status", percentColumnId: undefined },
            )
          }
        >
          <option value="status">Status (done options)</option>
          <option value="percent">Percent column</option>
        </select>
      </label>

      {mode === "percent" ? (
        <>
          <label className="text-sm">
            Percent column
            <select
              aria-label="Percent column"
              className={selectClass}
              value={(cfg.percentColumnId as string) ?? ""}
              onChange={(e) => patchConfig({ percentColumnId: e.target.value })}
            >
              <option value="">Select…</option>
              {percentCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {percentCols.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Add a Percent column to this board to use percent mode.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <label className="text-sm">
            Status column
            <select
              aria-label="Status column"
              className={selectClass}
              value={statusColumnId}
              onChange={(e) => {
                const colId = e.target.value;
                const opts =
                  board?.allColumns.find((c) => c.id === colId)?.options ?? [];
                // Pre-check done-like options; the user can edit the set.
                const preset = opts
                  .filter((o) => /done|complete|finished/i.test(o.label))
                  .map((o) => o.id);
                patchConfig({ statusColumnId: colId, doneOptionIds: preset });
              }}
            >
              <option value="">Select…</option>
              {statusCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {statusColumnId ? (
            <fieldset className="text-sm">
              <legend className="mb-1">Counts as done</legend>
              <div className="flex flex-col gap-1 rounded-md border p-2">
                {options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-primary size-4"
                      checked={doneOptionIds.includes(o.id)}
                      onChange={(e) =>
                        patchConfig({
                          doneOptionIds: e.target.checked
                            ? [...doneOptionIds, o.id]
                            : doneOptionIds.filter((id) => id !== o.id),
                        })
                      }
                    />
                    <span
                      className="size-2.5 rounded-sm"
                      style={{
                        backgroundColor: o.color ?? "var(--muted-foreground)",
                      }}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </>
      )}
    </>
  );
}
```

Wire it into the kind chain before the list fallback:

```tsx
      ) : value.kind === "completion" ? (
        <CompletionFields board={board} cfg={cfg} patchConfig={patchConfig} />
      ) : (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/dashboards/WidgetConfigForm.test.tsx src/components/dashboards/WidgetConfigSheet.test.tsx`
Expected: PASS (sheet tests may need `percentColumns: []` added to fixtures — that is the
only sheet change in this task).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/WidgetConfigForm.tsx \
  src/components/dashboards/WidgetConfigForm.test.tsx \
  "src/app/(app)/dashboards/[dashboardId]/page.tsx"
git commit -m "feat(dashboards): completion widget config form"
```

(If sheet test fixtures changed, stage `src/components/dashboards/WidgetConfigSheet.test.tsx` too.)

---

### Task 7: CompletionWidget component + canvas/preview wiring

**Files:**

- Create: `src/components/dashboards/widgets/CompletionWidget.tsx`
- Create: `src/components/dashboards/widgets/CompletionWidget.test.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx` (render switch line ~139)
- Modify: `src/components/dashboards/WidgetConfigSheet.tsx` (preview switch line ~139)

**Interfaces:**

- Consumes: Task 3 `shapeCompletion` (`@/lib/dashboards/widget-data`); Task 4
  `useWidgetData` → `data.completion`; existing `percentBandColor` from
  `@/lib/boards/percent-color`; `CacheWidget` from `@/lib/dashboards/cache`.
- Produces: `export function CompletionWidget({ widget }: { widget: CacheWidget })` — used
  by `DashboardWidget` and the sheet preview.

- [ ] **Step 1: Write the failing tests** (mirror `BatteryWidget`/`ChartWidget` test setup:
      mock `@/lib/dashboards/use-widget-data`)

```ts
it("prompts for configuration when unconfigured", () => {
  // widget with source_board_id null OR config {} → "Configure a source board
  // and completion source"
});

it("renders overall percent and one row per group", () => {
  // data.completion: rows [{groupKey:"g1",itemCount:3,completion:50},
  //   {groupKey:"g2",itemCount:1,completion:100}],
  // groups [{id:"g1",label:"WS A",color:"#0073ea"},
  //   {id:"g2",label:"WS B",color:"#00c875"},
  //   {id:"g3",label:"Empty",color:"#999"}]
  // expect "63%" overall (Math.round(62.5)), rows "WS A" 50%, "WS B" 100%,
  // "Empty" shows "—"
});

it("shows the empty state for a board with no items", () => {
  // completion: { rows: [], groups: [...] } → "No data yet"
});

it("shows the error state", () => {
  // isError true → "Failed to load"
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/dashboards/widgets/CompletionWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`CompletionWidget.tsx` — plain DOM, no recharts; static import
      keeps it out of the lazy chart chunk, like BatteryWidget)

```tsx
"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { shapeCompletion } from "@/lib/dashboards/widget-data";
import { percentBandColor } from "@/lib/boards/percent-color";
import type { CacheWidget } from "@/lib/dashboards/cache";

/**
 * Completion widget: overall % complete for the source board plus a per-group
 * (workstream) breakdown. Color is redundant with the numeric labels (AA rule);
 * bar fills reuse the board percent column's red→green band ramp so completion
 * reads identically app-wide. Groups with no top-level items render "—" and are
 * excluded from the overall.
 */
export function CompletionWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as {
    mode?: string;
    percentColumnId?: string;
    statusColumnId?: string;
  };
  const configured =
    config.mode === "percent"
      ? !!config.percentColumnId
      : !!config.statusColumnId;
  const { data, isLoading, isError } = useWidgetData(widget.id);

  if (!widget.source_board_id || !configured)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board and completion source
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.completion)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const shaped = shapeCompletion(data.completion.rows, data.completion.groups);
  if (shaped.overall === null)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {Math.round(shaped.overall)}%
        </span>
        <span className="text-muted-foreground text-xs">
          Overall · {shaped.totalItems} items
        </span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {shaped.rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: r.color }}
              aria-hidden
            />
            <span className="w-28 shrink-0 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
              {r.percent !== null ? (
                <span
                  className={`block h-full rounded-full ${percentBandColor(r.percent)}`}
                  style={{ width: `${Math.min(Math.max(r.percent, 0), 100)}%` }}
                />
              ) : null}
            </span>
            <span className="text-muted-foreground w-9 shrink-0 text-right tabular-nums">
              {r.percent === null ? "—" : `${Math.round(r.percent)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Wire the switches**

`DashboardWidget.tsx` — add to the render chain (before the fallback):

```tsx
          ) : widget.kind === "completion" ? (
            <CompletionWidget widget={widget} />
```

with `import { CompletionWidget } from "@/components/dashboards/widgets/CompletionWidget";`.

`WidgetConfigSheet.tsx` — add to the preview chain (before the `ListWidget` fallback):

```tsx
            ) : draft.kind === "completion" ? (
              <CompletionWidget widget={previewWidget} />
```

(outside the `WidgetDataProvider` the hook degrades to its stable error/configure state —
existing documented behavior; the preview shows the configure affordance until saved.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/components/dashboards/widgets/CompletionWidget.test.tsx src/components/dashboards/DashboardWidget.test.tsx src/components/dashboards/WidgetConfigSheet.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboards/widgets/CompletionWidget.tsx \
  src/components/dashboards/widgets/CompletionWidget.test.tsx \
  src/components/dashboards/DashboardWidget.tsx \
  src/components/dashboards/WidgetConfigSheet.tsx
git commit -m "feat(dashboards): completion widget component"
```

---

### Task 8: Full gates + finish

**Files:** none new.

**Interfaces:**

- Consumes: everything above.
- Produces: merged `task/phase-completion-dashboard` → `develop`; worktree removed.

- [ ] **Step 1: Run all four gates from the worktree root**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS. Known traps: cold `pnpm typecheck` can fail on `cacheLife("nav"/"guard")`
until `pnpm build` generates `.next/types` (run build first if so); if a rebase pulls a dep
another session added, `pnpm install` then re-run.

- [ ] **Step 2: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree (auto-rebases onto latest `develop`,
re-runs gates against the merged state, merges, pushes, removes the worktree). If it stops on
a real rebase conflict: resolve `git rebase develop`, re-run.

- [ ] **Step 3: Hand the user the manual-test walkthrough** (closing message + `/wrapup`
      session note). Walkthrough:

1. Pull `develop`, run the app, open a workspace that has a board with groups + a status
   column (and ideally a percent column).
2. Go to **Dashboards** → any dashboard → **Add widget** → type **Completion**.
3. Pick the phase board as source; leave **Status (done options)** mode; pick the status
   column — verify "Done"-like options are pre-checked; save.
4. Expect: a tile with a large overall % and one row per group (group color dot, name,
   red→green progress bar, right-aligned %); groups with no items show "—".
5. Edit the widget → switch to **Percent column** mode, pick the % column, save → values
   become the average % complete per group; items with empty % count as 0.
6. Change an item's status/% on the board, return to the dashboard, wait ~30 s (cache TTL)
   and refresh → numbers update.
7. Add a second Completion widget for the Phase 2 board — "same for Phase 2".

---

## Execution DAG (working agreement #6)

**Dependency edges** (from the Interfaces blocks):

- Task 1 (migration + types) → Task 4 (RPC types), Task 5 (deployed RPC)
- Task 2 (zod) → Task 4 (kind in schema), Task 6 (config keys)
- Task 3 (shaping) → Task 4 (row/meta types), Task 7 (shapeCompletion)
- Task 4 (server plumbing) → Task 7 (`data.completion`)
- Task 6 (BoardOption.percentColumns) → Task 7 only via sheet-test fixtures (soft; run 7
  after 6 to avoid fixture churn)
- Tasks 1–7 → Task 8 (gates + finish)

**Parallel batches** (≥2 tasks in a batch → dispatch with
`superpowers:dispatching-parallel-agents` / parallel subagents; all tasks share this one
worktree, so parallel subagents must touch disjoint files — the batches below are
file-disjoint):

| Wave | Tasks      | Notes                                                                                                  |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 1    | T1, T2, T3 | fully independent (SQL+types / validations / widget-data) — file-disjoint                              |
| 2    | T4, T5, T6 | T4 needs T1+T2+T3; T5 needs T1 (and the user applying SQL to the test DB); T6 needs T2 — file-disjoint |
| 3    | T7         | needs T3+T4 (+T6 fixtures)                                                                             |
| 4    | T8         | gates + finish                                                                                         |

**Critical path (wall-clock floor):** T1 → T4 → T7 → T8 — dominated by T1's human-in-the-loop
migration apply. Start T1 first and get the SQL to the user immediately; T2/T3 fill the wait.

## Out of scope (from the spec)

- AI wizard proposal support for the completion kind (`PROPOSAL_JSON_SCHEMA` unchanged).
- Filters on the completion widget; cross-board rollups; subitem-weighted modes.
- Feedback-row status update (`resolved` + admin response) happens at MVP-item closure per
  the goal plan's definition of done, not in this task.
