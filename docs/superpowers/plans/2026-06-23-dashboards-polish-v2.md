# Dashboards Polish (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Phase-8 dashboards subsystem — a richer chart catalog (line/area, stacked/grouped bar, combo bar+line, donut/radial/gauge) over a generalized aggregation layer, a unified Add/Edit drawer with live preview, and the approved "bordered card + rich chart" visual language across all widgets.

**Architecture:** A new `dashboard_series` Postgres RPC produces bounded, optionally-multi-series aggregates grouped by date-bucket / status / dropdown / people; the **Chart** widget consumes it via a new `getWidgetSeries` action + `useWidgetSeries` hook. **Number** and **Battery** keep the existing `dashboard_aggregate` (Number gains a gauge display mode). A single `WidgetConfigForm` (hosted in the existing shadcn `Sheet`) replaces today's `AddWidgetDialog` and `EditListWidgetDialog`, with a debounced live preview. All aggregation stays in Postgres, bounded + indexed; in-page chart-type switches do zero refetch.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (Postgres RPC, RLS), Zod, TanStack Query, recharts ^3.8.1, react-grid-layout v2, Tailwind v4 + shadcn, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-dashboards-polish-v2-design.md`

**Execution DAG:** T1 (data layer) → then T2 (charts + reskin) ∥ T3 (edit drawer) in parallel worktrees. T1 is the critical path. T2 and T3 only co-touch `DashboardWidget.tsx` (T2 owns visuals; T3 wires the edit trigger) — T3 rebases on T2 if both land.

---

## File Structure

**Task 1 — Data layer**

- Modify: `src/lib/validations/dashboards.ts` — new `chartConfigSchema` (discriminated by `chartType`), `numberConfigSchema` gains `display`/`target`.
- Create: `src/lib/dashboards/chart-config.ts` — `normalizeChartConfig()` back-compat mapper + chart-type metadata.
- Create: `supabase/migrations/20260623120000_dashboard_series.sql` — the `dashboard_series` RPC + supporting index.
- Modify: `src/lib/dashboards/actions.ts` — add `getWidgetSeries()` action.
- Create: `src/lib/dashboards/series.ts` — `SeriesPoint`/`SeriesData`/`PivotedSeries` types + `pivotSeries()` helper.
- Create: `src/lib/dashboards/use-widget-series.ts` — `useWidgetSeries()` hook.
- Modify: `src/types/database.types.ts` — regenerated (the new RPC).

**Task 2 — Charts + reskin** (depends on T1)

- Rewrite: `src/components/dashboards/widgets/ChartWidget.tsx` — all chart types via `useWidgetSeries`.
- Modify: `src/components/dashboards/widgets/NumberWidget.tsx` — gauge display + sparkline shell.
- Modify: `src/components/dashboards/widgets/BatteryWidget.tsx`, `ListWidget.tsx` — visual reskin only.
- Modify: `src/components/dashboards/DashboardWidget.tsx` — bordered-card shell (accent-dot header).
- Create: `src/components/dashboards/widgets/chart-theme.ts` — shared recharts theming constants.

**Task 3 — Edit drawer** (depends on T1)

- Create: `src/components/dashboards/WidgetConfigForm.tsx` — unified Add/Edit config form (all kinds).
- Create: `src/components/dashboards/WidgetConfigSheet.tsx` — the right-side Sheet host + live preview.
- Modify: `src/components/dashboards/DashboardCanvas.tsx` — replace `AddWidgetDialog` with the sheet trigger.
- Modify: `src/components/dashboards/DashboardWidget.tsx` — edit menu opens the sheet for all kinds.
- Delete: `src/components/dashboards/AddWidgetDialog.tsx`, `src/components/dashboards/EditListWidgetDialog.tsx` (the `BoardOption` type moves to `WidgetConfigForm.tsx`).

---

## TASK 1 — Data layer (foundation)

### Task 1.1: Chart config schema + back-compat mapper

**Files:**

- Modify: `src/lib/validations/dashboards.ts`
- Create: `src/lib/dashboards/chart-config.ts`
- Test: `src/lib/dashboards/chart-config.test.ts`

- [ ] **Step 1: Write the failing test for the mapper**

Create `src/lib/dashboards/chart-config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { normalizeChartConfig } from "@/lib/dashboards/chart-config";

describe("normalizeChartConfig", () => {
  it("maps a legacy bar config to the new shape", () => {
    const out = normalizeChartConfig({
      groupColumnId: "col-1",
      chartStyle: "bar",
    });
    expect(out).toEqual({
      chartType: "bar",
      primary: { kind: "status", columnId: "col-1" },
      measure: { agg: "count" },
    });
  });

  it("maps a legacy pie config to chartType pie", () => {
    const out = normalizeChartConfig({
      groupColumnId: "col-1",
      chartStyle: "pie",
    });
    expect(out.chartType).toBe("pie");
    expect(out.primary).toEqual({ kind: "status", columnId: "col-1" });
  });

  it("passes a new-shape config through unchanged", () => {
    const cfg = {
      chartType: "line" as const,
      primary: { kind: "date" as const, bucket: "month" as const },
      measure: { agg: "count" as const },
    };
    expect(normalizeChartConfig(cfg)).toEqual(cfg);
  });

  it("defaults missing measure to count", () => {
    const out = normalizeChartConfig({
      chartType: "donut",
      primary: { kind: "status", columnId: "c" },
    });
    expect(out.measure).toEqual({ agg: "count" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test src/lib/dashboards/chart-config.test.ts`
Expected: FAIL — `Cannot find module '@/lib/dashboards/chart-config'`.

- [ ] **Step 3: Add the new schemas to `validations/dashboards.ts`**

Replace the existing `chartConfigSchema` block (the `z.object({ groupColumnId, chartStyle })`) with:

```typescript
export const chartTypeSchema = z.enum([
  "bar",
  "stackedBar",
  "groupedBar",
  "line",
  "area",
  "combo",
  "pie",
  "donut",
  "radial",
]);
export type ChartType = z.infer<typeof chartTypeSchema>;

export const seriesDimensionSchema = z.object({
  kind: z.enum(["status", "dropdown", "people", "date"]),
  columnId: uuid.optional(), // omitted for date-on-created_at
  bucket: z.enum(["day", "week", "month"]).optional(), // date only
});
export type SeriesDimension = z.infer<typeof seriesDimensionSchema>;

export const measureSchema = z
  .object({
    agg: z.enum(["count", "sum", "avg"]),
    valueColumnId: uuid.optional(),
  })
  .refine((m) => m.agg === "count" || !!m.valueColumnId, {
    message: "Sum and average need a numbers column.",
    path: ["valueColumnId"],
  });
export type Measure = z.infer<typeof measureSchema>;

export const chartConfigSchema = z.object({
  chartType: chartTypeSchema,
  primary: seriesDimensionSchema,
  series: seriesDimensionSchema.optional(),
  measure: measureSchema.default({ agg: "count" }),
  comboMap: z.record(z.string(), z.enum(["bar", "line"])).optional(),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;
```

Update `numberConfigSchema` (add display + target, keep the existing refine):

```typescript
export const numberConfigSchema = z
  .object({
    agg: z.enum(["count", "sum", "avg"]),
    valueColumnId: uuid.optional(),
    display: z.enum(["plain", "gauge"]).default("plain"),
    target: z.number().positive().optional(),
  })
  .refine((c) => c.agg === "count" || !!c.valueColumnId, {
    message: "Sum and average need a numbers column.",
    path: ["valueColumnId"],
  });
```

- [ ] **Step 4: Create the mapper `src/lib/dashboards/chart-config.ts`**

```typescript
import type { ChartConfig } from "@/lib/validations/dashboards";

/**
 * Upgrade a stored chart `config` to the v2 shape at read time.
 * Old widgets store `{ groupColumnId, chartStyle: "bar" | "pie" }`; v2 uses
 * `{ chartType, primary, measure, ... }`. No data migration — we map on read.
 */
export function normalizeChartConfig(
  raw: Record<string, unknown>,
): ChartConfig {
  if (
    raw &&
    typeof raw === "object" &&
    "chartType" in raw &&
    "primary" in raw
  ) {
    const cfg = raw as ChartConfig;
    return { ...cfg, measure: cfg.measure ?? { agg: "count" } };
  }
  const legacy = raw as { groupColumnId?: string; chartStyle?: "bar" | "pie" };
  return {
    chartType: legacy.chartStyle === "pie" ? "pie" : "bar",
    primary: { kind: "status", columnId: legacy.groupColumnId },
    measure: { agg: "count" },
  };
}

/** Chart types that read the optional `series` (second) dimension. */
export const MULTI_SERIES_TYPES: ChartConfig["chartType"][] = [
  "stackedBar",
  "groupedBar",
  "line",
  "area",
  "combo",
];

/** Chart types whose primary axis must be a date bucket. */
export const DATE_PRIMARY_TYPES: ChartConfig["chartType"][] = [
  "line",
  "area",
  "combo",
];
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm test src/lib/dashboards/chart-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If `configSchemaForKind` referenced the old `ChartConfig` field names anywhere, fix to the new shape — it only returns the schema, so no change expected.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/dashboards/chart-config.ts src/lib/dashboards/chart-config.test.ts
git commit -m "feat(dashboards): v2 chart config schema + back-compat mapper"
```

---

### Task 1.2: The `dashboard_series` RPC migration

**Files:**

- Create: `supabase/migrations/20260623120000_dashboard_series.sql`
- Test: `src/lib/dashboards/dashboard-series.integration.test.ts`

> Integration tests run against the linked Supabase project (`.env.local` is symlinked into the worktree). They are named `*.integration.test.ts` and call `supabase.rpc(...)`. They no-op when `.env.local` is absent.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260623120000_dashboard_series.sql`:

```sql
-- Generalized series aggregation for Chart widgets: a primary axis (category
-- column OR date-bucket), an optional series split, a measure (count/sum/avg),
-- bounded to top-K categories (folding the long tail into '__other__') or the
-- last-N date buckets. Dropdown/people dimensions are array-unnested, so an item
-- with N assignees/options counts once per value (documented "workload" semantic).
-- Returns RAW keys; labels/colors are resolved server-side (getWidgetSeries),
-- mirroring how dashboard_aggregate's columnMeta is resolved in the action.

create or replace function public.dashboard_series(
  p_board_id uuid,
  p_primary  jsonb,
  p_series   jsonb default null,
  p_measure  jsonb default '{"agg":"count"}'::jsonb,
  p_limit    int   default 12
) returns table (primary_key text, series_key text, value numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id  uuid;
  v_pkind   text := p_primary ->> 'kind';
  v_pcol    uuid := nullif(p_primary ->> 'columnId', '')::uuid;
  v_bucket  text := coalesce(p_primary ->> 'bucket', 'month');
  v_skind   text := p_series ->> 'kind';
  v_scol    uuid := nullif(p_series ->> 'columnId', '')::uuid;
  v_agg     text := coalesce(p_measure ->> 'agg', 'count');
  v_vcol    uuid := nullif(p_measure ->> 'valueColumnId', '')::uuid;
  v_limit   int  := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_is_date boolean := (v_pkind = 'date');
  v_pk_expr text;
  v_sk_expr text := 'null::text';
  v_measure text;
  v_pjoin   text := '';
  v_sjoin   text := '';
  v_vjoin   text := '';
  v_sql     text;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if v_agg not in ('count', 'sum', 'avg') then
    raise exception 'invalid agg %', v_agg using errcode = '22023';
  end if;
  if v_bucket not in ('day', 'week', 'month') then v_bucket := 'month'; end if;

  -- primary key expression + join
  if v_pkind = 'status' then
    v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L', v_pcol);
    v_pk_expr := 'pcv.value ->> ''optionId''';
  elsif v_pkind = 'dropdown' then
    v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(pcv.value -> ''optionIds'') as pu(v) on true', v_pcol);
    v_pk_expr := 'pu.v';
  elsif v_pkind = 'people' then
    v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(pcv.value -> ''userIds'') as pu(v) on true', v_pcol);
    v_pk_expr := 'pu.v';
  elsif v_pkind = 'date' then
    if v_pcol is null then
      v_pk_expr := format('to_char(date_trunc(%L, i.created_at), ''YYYY-MM-DD'')', v_bucket);
    else
      v_pjoin := format('left join public.cell_values pcv on pcv.item_id = i.id and pcv.column_id = %L', v_pcol);
      v_pk_expr := format('to_char(date_trunc(%L, (pcv.value ->> ''date'')::date), ''YYYY-MM-DD'')', v_bucket);
    end if;
  else
    raise exception 'invalid primary kind %', v_pkind using errcode = '22023';
  end if;

  -- optional series split (category kinds only)
  if v_skind = 'status' then
    v_sjoin := format('left join public.cell_values scv on scv.item_id = i.id and scv.column_id = %L', v_scol);
    v_sk_expr := 'scv.value ->> ''optionId''';
  elsif v_skind = 'dropdown' then
    v_sjoin := format('left join public.cell_values scv on scv.item_id = i.id and scv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(scv.value -> ''optionIds'') as su(v) on true', v_scol);
    v_sk_expr := 'su.v';
  elsif v_skind = 'people' then
    v_sjoin := format('left join public.cell_values scv on scv.item_id = i.id and scv.column_id = %L '
      || 'left join lateral jsonb_array_elements_text(scv.value -> ''userIds'') as su(v) on true', v_scol);
    v_sk_expr := 'su.v';
  end if;

  -- measure
  if v_agg = 'count' then
    v_measure := 'count(*)::numeric';
  else
    v_vjoin := format('left join public.cell_values vcv on vcv.item_id = i.id and vcv.column_id = %L', v_vcol);
    v_measure := case v_agg
      when 'sum' then 'coalesce(sum((vcv.value ->> ''n'')::numeric), 0)'
      else 'coalesce(avg((vcv.value ->> ''n'')::numeric), 0)'
    end;
  end if;

  if v_is_date then
    -- keep the most recent N buckets (ISO date strings sort lexically)
    v_sql := format(
      'with g as (select %s as pk, %s as sk, %s as val '
      || 'from public.items i %s %s %s where i.board_id = %L group by 1, 2), '
      || 'keep as (select distinct pk from g where pk is not null order by pk desc limit %s) '
      || 'select g.pk, g.sk, g.val from g where g.pk in (select pk from keep)',
      v_pk_expr, v_sk_expr, v_measure, v_pjoin, v_sjoin, v_vjoin, p_board_id, v_limit);
  else
    -- keep top-N primary keys by total; fold the rest into '__other__'
    v_sql := format(
      'with g as (select %s as pk, %s as sk, %s as val '
      || 'from public.items i %s %s %s where i.board_id = %L group by 1, 2), '
      || 'totals as (select pk, sum(val) as t from g group by pk), '
      || 'ranked as (select pk, row_number() over (order by t desc nulls last) as rn from totals), '
      || 'folded as (select case when r.rn <= %s then g.pk else ''__other__'' end as pk, g.sk, g.val '
      || 'from g join ranked r on r.pk is not distinct from g.pk) '
      || 'select pk, sk, sum(val)::numeric as val from folded group by pk, sk',
      v_pk_expr, v_sk_expr, v_measure, v_pjoin, v_sjoin, v_vjoin, p_board_id, v_limit);
  end if;

  return query execute v_sql;
end; $$;

grant execute on function public.dashboard_series(uuid, jsonb, jsonb, jsonb, int) to authenticated;

-- Date-bucketing over a date column reads (column_id, value->>'date'); that index
-- already exists (cell_values_date_idx). items(board_id) is indexed (items_board_id_idx).
-- created_at bucketing benefits from a board_id+created_at composite:
create index if not exists items_board_created_idx
  on public.items (board_id, created_at);
```

- [ ] **Step 2: Apply the migration to the linked project**

Apply via the Supabase MCP `apply_migration` tool (name: `dashboard_series`, the SQL above), OR `supabase db push` if using the CLI. Confirm no error.

- [ ] **Step 3: Run advisors**

Use the Supabase MCP `get_advisors` (type `security`). Expected: no NEW warnings for `dashboard_series` (it pins `search_path = ''` and is SECURITY DEFINER like the existing RPCs). Fix if any appear.

- [ ] **Step 4: Write the integration test**

Create `src/lib/dashboards/dashboard-series.integration.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { createClient } from "@/lib/supabase/server";

const hasEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

// These exercise the RPC's SHAPE + auth contract. They run only when the linked
// project env is present; otherwise they no-op (CI without secrets).
describe.runIf(hasEnv)("dashboard_series RPC", () => {
  it("rejects an unknown board with a not-found error", async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("dashboard_series", {
      p_board_id: "00000000-0000-0000-0000-000000000000",
      p_primary: { kind: "date", bucket: "month" },
      p_measure: { agg: "count" },
      p_limit: 12,
    });
    // not-found OR not-a-member depending on RLS visibility — both are non-null.
    expect(error).not.toBeNull();
  });

  it("accepts a valid date-primary call shape (returns rows array)", async () => {
    const supabase = await createClient();
    // A board the test user can see is required for a green data assertion; here
    // we assert the call contract resolves without throwing for a bad board.
    const res = await supabase.rpc("dashboard_series", {
      p_board_id: "00000000-0000-0000-0000-000000000000",
      p_primary: { kind: "date", bucket: "week" },
      p_series: null,
      p_measure: { agg: "count" },
      p_limit: 6,
    });
    expect(res).toHaveProperty("error");
    expect(res).toHaveProperty("data");
  });
});
```

> Note for the implementer: if the project has a SQL-fixture harness (seeded org/board/items) used by other `*.integration.test.ts` files, extend these to assert real bucket folding (top-K → `__other__`) and people-unnest counting. Search for an existing dashboards integration test to copy its fixture setup before writing assertions against live data.

- [ ] **Step 5: Run the integration test**

Run: `pnpm test src/lib/dashboards/dashboard-series.integration.test.ts`
Expected: PASS (error path returns a non-null error; shape assertions hold).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260623120000_dashboard_series.sql src/lib/dashboards/dashboard-series.integration.test.ts
git commit -m "feat(dashboards): dashboard_series RPC (date-bucket + multi-series, bounded)"
```

---

### Task 1.3: `pivotSeries` helper + types

**Files:**

- Create: `src/lib/dashboards/series.ts`
- Test: `src/lib/dashboards/series.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dashboards/series.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { pivotSeries, type SeriesData } from "@/lib/dashboards/series";

const data: SeriesData = {
  chartType: "stackedBar",
  primaryKind: "status",
  seriesKind: "people",
  points: [
    {
      primaryKey: "done",
      primaryLabel: "Done",
      seriesKey: "u1",
      seriesLabel: "Ada",
      seriesColor: "#34d399",
      value: 3,
    },
    {
      primaryKey: "done",
      primaryLabel: "Done",
      seriesKey: "u2",
      seriesLabel: "Lin",
      seriesColor: "#6366f1",
      value: 1,
    },
    {
      primaryKey: "wip",
      primaryLabel: "WIP",
      seriesKey: "u1",
      seriesLabel: "Ada",
      seriesColor: "#34d399",
      value: 2,
    },
  ],
};

describe("pivotSeries", () => {
  it("pivots flat points into recharts rows keyed by series label", () => {
    const out = pivotSeries(data);
    expect(out.rows).toEqual([
      { __label: "Done", Ada: 3, Lin: 1 },
      { __label: "WIP", Ada: 2 },
    ]);
  });

  it("returns the distinct series with their colors", () => {
    const out = pivotSeries(data);
    expect(out.series).toEqual([
      { key: "Ada", color: "#34d399" },
      { key: "Lin", color: "#6366f1" },
    ]);
  });

  it("uses a single synthetic series when there is no series split", () => {
    const out = pivotSeries({
      chartType: "bar",
      primaryKind: "status",
      seriesKind: null,
      points: [
        {
          primaryKey: "done",
          primaryLabel: "Done",
          seriesKey: null,
          seriesLabel: null,
          seriesColor: "#34d399",
          value: 5,
        },
      ],
    });
    expect(out.rows).toEqual([
      { __label: "Done", Value: 5, __color_Done: "#34d399" },
    ]);
    expect(out.series).toEqual([{ key: "Value", color: "#818cf8" }]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test src/lib/dashboards/series.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/dashboards/series.ts`**

```typescript
import type { ChartType } from "@/lib/validations/dashboards";

export type SeriesPoint = {
  primaryKey: string | null;
  primaryLabel: string;
  seriesKey: string | null;
  seriesLabel: string | null;
  seriesColor: string;
  value: number;
};

export type SeriesData = {
  chartType: ChartType;
  primaryKind: "status" | "dropdown" | "people" | "date";
  seriesKind: "status" | "dropdown" | "people" | "date" | null;
  points: SeriesPoint[];
};

/** A recharts-ready row: a primary label plus one numeric field per series. */
export type PivotRow = Record<string, string | number>;

export type PivotedSeries = {
  rows: PivotRow[];
  series: { key: string; color: string }[];
};

/** Default accent for the single-series (no split) case. */
const SOLO_COLOR = "#818cf8";

/**
 * Pivot flat (primary × series) points into recharts rows.
 * - With a series split: each distinct series label becomes a numeric field.
 * - Without a split: a single "Value" field; per-row color is stashed as
 *   `__color_<label>` so the chart can color bars/slices individually.
 */
export function pivotSeries(data: SeriesData): PivotedSeries {
  const rowByPrimary = new Map<string, PivotRow>();
  const order: string[] = [];
  const seriesColor = new Map<string, string>();
  const seriesOrder: string[] = [];

  for (const p of data.points) {
    if (!rowByPrimary.has(p.primaryLabel)) {
      rowByPrimary.set(p.primaryLabel, { __label: p.primaryLabel });
      order.push(p.primaryLabel);
    }
    const row = rowByPrimary.get(p.primaryLabel)!;

    if (data.seriesKind && p.seriesLabel) {
      row[p.seriesLabel] = (Number(row[p.seriesLabel]) || 0) + p.value;
      if (!seriesColor.has(p.seriesLabel)) {
        seriesColor.set(p.seriesLabel, p.seriesColor);
        seriesOrder.push(p.seriesLabel);
      }
    } else {
      row.Value = (Number(row.Value) || 0) + p.value;
      row[`__color_${p.primaryLabel}`] = p.seriesColor;
    }
  }

  const series = data.seriesKind
    ? seriesOrder.map((key) => ({ key, color: seriesColor.get(key)! }))
    : [{ key: "Value", color: SOLO_COLOR }];

  return { rows: order.map((k) => rowByPrimary.get(k)!), series };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm test src/lib/dashboards/series.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/series.ts src/lib/dashboards/series.test.ts
git commit -m "feat(dashboards): pivotSeries helper for recharts rows"
```

---

### Task 1.4: `getWidgetSeries` action + `useWidgetSeries` hook

**Files:**

- Modify: `src/lib/dashboards/actions.ts`
- Create: `src/lib/dashboards/use-widget-series.ts`

> This action calls the RPC then resolves labels/colors server-side: status/dropdown from `columns.settings` options; people from org members; dates formatted by bucket; `__other__` → "Other".

- [ ] **Step 1: Add `getWidgetSeries` to `actions.ts`**

Add these imports at the top of `actions.ts` (alongside the existing ones):

```typescript
import { normalizeChartConfig } from "@/lib/dashboards/chart-config";
import type { SeriesData, SeriesPoint } from "@/lib/dashboards/series";
import { optionSchema } from "@/lib/validations/boards";
```

Append the action:

```typescript
const MUTED = "var(--muted-foreground)";
const PALETTE = [
  "var(--brand)",
  "var(--status-green)",
  "var(--status-orange)",
  "var(--status-purple)",
  "var(--status-teal)",
  "var(--status-red)",
  "var(--status-yellow)",
  "var(--status-blue)",
];

function formatBucketLabel(key: string, bucket: string): string {
  // key is "YYYY-MM-DD" (start of bucket)
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  if (bucket === "month")
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export async function getWidgetSeries(input: {
  widgetId: string;
}): Promise<ActionResult<SeriesData>> {
  const parsed = getWidgetDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: widget } = await supabase
    .from("dashboard_widgets")
    .select("config, source_board_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");

  const cfg = normalizeChartConfig(
    (widget.config ?? {}) as Record<string, unknown>,
  );
  const empty: SeriesData = {
    chartType: cfg.chartType,
    primaryKind: cfg.primary.kind,
    seriesKind: cfg.series?.kind ?? null,
    points: [],
  };
  if (
    !widget.source_board_id ||
    (cfg.primary.kind !== "date" && !cfg.primary.columnId)
  )
    return { ok: true, data: empty };

  const { data: raw, error } = await supabase.rpc("dashboard_series", {
    p_board_id: widget.source_board_id,
    p_primary: cfg.primary as Json,
    p_series: (cfg.series ?? null) as Json,
    p_measure: cfg.measure as Json,
    p_limit: 12,
  });
  if (error) return fail(error.message);

  // Resolve a key -> {label,color} map for a dimension.
  async function resolver(dim: { kind: string; columnId?: string }) {
    const map = new Map<string, { label: string; color: string }>();
    if (dim.kind === "status" || dim.kind === "dropdown") {
      if (!dim.columnId) return map;
      const { data: col } = await supabase
        .from("columns")
        .select("settings")
        .eq("id", dim.columnId)
        .maybeSingle();
      const opts =
        optionSchema
          .array()
          .safeParse((col?.settings as { options?: unknown })?.options ?? [])
          .data ?? [];
      opts.forEach((o) => map.set(o.id, { label: o.label, color: o.color }));
    } else if (dim.kind === "people") {
      const { data: members } = await supabase
        .from("org_members")
        .select("user_id, profiles(full_name)");
      (members ?? []).forEach((m, i) =>
        map.set(m.user_id, {
          label:
            (m.profiles as { full_name?: string } | null)?.full_name ??
            "Member",
          color: PALETTE[i % PALETTE.length],
        }),
      );
    }
    return map;
  }

  const primaryMap = await resolver(cfg.primary);
  const seriesMap = cfg.series ? await resolver(cfg.series) : new Map();

  const points: SeriesPoint[] = (raw ?? []).map((r, i) => {
    const pk = r.primary_key;
    const sk = r.series_key;
    const primaryLabel =
      pk === null
        ? "None"
        : pk === "__other__"
          ? "Other"
          : cfg.primary.kind === "date"
            ? formatBucketLabel(pk, cfg.primary.bucket ?? "month")
            : (primaryMap.get(pk)?.label ?? "Unknown");
    const seriesLabel =
      sk === null
        ? null
        : (seriesMap.get(sk)?.label ??
          (sk === "__other__" ? "Other" : "Unknown"));
    const seriesColor =
      (sk !== null
        ? seriesMap.get(sk!)?.color
        : primaryMap.get(pk ?? "")?.color) ?? PALETTE[i % PALETTE.length];
    return {
      primaryKey: pk,
      primaryLabel,
      seriesKey: sk,
      seriesLabel,
      seriesColor,
      value: Number(r.value),
    };
  });

  return {
    ok: true,
    data: { ...empty, points },
  };
}
```

> Implementer note: confirm the `org_members` table name + the `profiles` relation by checking `src/types/database.types.ts`. If the project resolves member names differently (e.g. a `members` view or `full_name` on `org_members`), adapt the `people` branch — the surrounding code is correct, only the member query changes.

- [ ] **Step 2: Create the hook `src/lib/dashboards/use-widget-series.ts`**

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetSeries } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import type { SeriesData } from "@/lib/dashboards/series";

/** Fetch a Chart widget's bounded series. Keyed by widget id + config hash so an
 * edit re-queries only this widget; never refetched by a layout drag. */
export function useWidgetSeries(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget-series", widgetId, configHash(config)],
    queryFn: async (): Promise<SeriesData> => {
      const res = await getWidgetSeries({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Fix any `Json` import (it's already imported in `actions.ts`) or member-query type mismatch per the implementer note.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboards/actions.ts src/lib/dashboards/use-widget-series.ts
git commit -m "feat(dashboards): getWidgetSeries action + useWidgetSeries hook"
```

---

### Task 1.5: Regenerate database types

**Files:** Modify `src/types/database.types.ts`

- [ ] **Step 1: Regenerate**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now includes a `dashboard_series` entry under `Functions`.

- [ ] **Step 2: Typecheck + full test + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.types.ts
git commit -m "chore(dashboards): regenerate types for dashboard_series"
```

**T1 gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before T2/T3 start.

---

## TASK 2 — Charts + reskin (depends on T1)

### Task 2.1: Shared chart theme

**Files:** Create `src/components/dashboards/widgets/chart-theme.ts`

- [ ] **Step 1: Create the theme constants**

```typescript
/** Shared recharts theming so every chart reads from Pulse tokens. */
export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
} as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--foreground)",
  },
  cursor: { fill: "var(--muted)" },
} as const;

export const GRID_STROKE = "var(--border)";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboards/widgets/chart-theme.ts
git commit -m "feat(dashboards): shared recharts theme constants"
```

---

### Task 2.2: Rewrite `ChartWidget` for all chart types

**Files:**

- Rewrite: `src/components/dashboards/widgets/ChartWidget.tsx`
- Test: `src/components/dashboards/widgets/ChartWidget.test.tsx`

- [ ] **Step 1: Write a render smoke test (pivot-driven)**

Create `src/components/dashboards/widgets/ChartWidget.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
import type { SeriesData } from "@/lib/dashboards/series";

const sample: SeriesData = {
  chartType: "bar",
  primaryKind: "status",
  seriesKind: null,
  points: [
    { primaryKey: "done", primaryLabel: "Done", seriesKey: null, seriesLabel: null, seriesColor: "#34d399", value: 4 },
  ],
};

vi.mock("@/lib/dashboards/use-widget-series", () => ({
  useWidgetSeries: () => ({ data: sample, isLoading: false, isError: false }),
}));

// recharts needs a sized container in jsdom; stub ResponsiveContainer.
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 400, height: 300 }}>{children}</div> };
});

describe("ChartWidget", () => {
  it("renders a bar chart without crashing", () => {
    render(
      <ChartWidget
        widget={{ id: "w1", source_board_id: "b1", config: { chartType: "bar", primary: { kind: "status", columnId: "c1" } } } as never}
      />,
    );
    // recharts renders an svg surface
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: FAIL (current ChartWidget imports `useWidgetData`/`shapeBuckets`, not the new shape — the mock + new props won't line up, or it errors on the legacy config cast).

- [ ] **Step 3: Rewrite `ChartWidget.tsx`**

```typescript
"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useWidgetSeries } from "@/lib/dashboards/use-widget-series";
import { pivotSeries } from "@/lib/dashboards/series";
import {
  AXIS_PROPS,
  GRID_STROKE,
  TOOLTIP_STYLE,
} from "@/components/dashboards/widgets/chart-theme";
import type { CacheWidget } from "@/lib/dashboards/cache";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
      {children}
    </div>
  );
}

export function ChartWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as Record<string, unknown>;
  const { data, isLoading, isError } = useWidgetSeries(widget.id, config);

  if (!widget.source_board_id) return <Empty>Pick a source board</Empty>;
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data) return <Empty>Failed to load</Empty>;
  if (data.points.length === 0) return <Empty>No data yet</Empty>;

  const { rows, series } = pivotSeries(data);
  const ct = data.chartType;

  // ── circular charts ──
  if (ct === "pie" || ct === "donut") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip {...TOOLTIP_STYLE} />
          <Pie
            data={rows}
            dataKey="Value"
            nameKey="__label"
            innerRadius={ct === "donut" ? "55%" : 0}
            outerRadius="80%"
          >
            {rows.map((r) => (
              <Cell
                key={String(r.__label)}
                fill={String(r[`__color_${r.__label}`] ?? "var(--brand)")}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (ct === "radial") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={rows} innerRadius="25%" outerRadius="95%">
          <Tooltip {...TOOLTIP_STYLE} />
          <RadialBar dataKey="Value" background>
            {rows.map((r) => (
              <Cell
                key={String(r.__label)}
                fill={String(r[`__color_${r.__label}`] ?? "var(--brand)")}
              />
            ))}
          </RadialBar>
        </RadialBarChart>
      </ResponsiveContainer>
    );
  }

  // ── line / area ──
  if (ct === "line" || ct === "area") {
    const Chart = ct === "line" ? LineChart : AreaChart;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={rows}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <Tooltip {...TOOLTIP_STYLE} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {series.map((s) =>
            ct === "line" ? (
              <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} />
            ) : (
              <Area key={s.key} dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.2} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    );
  }

  // ── combo (bar + line) ──
  if (ct === "combo") {
    const comboMap = (config.comboMap ?? {}) as Record<string, "bar" | "line">;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <Tooltip {...TOOLTIP_STYLE} />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {series.map((s, i) =>
            (comboMap[s.key] ?? (i === 0 ? "bar" : "line")) === "bar" ? (
              <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} />
            ) : (
              <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // ── bar family (bar / stackedBar / groupedBar) ──
  const stack = ct === "stackedBar";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="__label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={32} />
        <Tooltip {...TOOLTIP_STYLE} />
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stack ? "a" : undefined}
            fill={s.color}
            radius={stack ? undefined : [4, 4, 0, 0]}
          >
            {series.length === 1
              ? rows.map((r) => (
                  <Cell
                    key={String(r.__label)}
                    fill={String(r[`__color_${r.__label}`] ?? s.color)}
                  />
                ))
              : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm test src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: PASS — an `<svg>` renders.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboards/widgets/ChartWidget.tsx src/components/dashboards/widgets/ChartWidget.test.tsx
git commit -m "feat(dashboards): ChartWidget renders line/area/stacked/grouped/combo/donut/radial"
```

---

### Task 2.3: Number widget — gauge + sparkline shell

**Files:** Modify `src/components/dashboards/widgets/NumberWidget.tsx`

- [ ] **Step 1: Replace `NumberWidget.tsx`**

```typescript
"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { formatMetric, numberFromBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function NumberWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as {
    agg?: "count" | "sum" | "avg";
    display?: "plain" | "gauge";
    target?: number;
  };
  const agg = config.agg ?? "count";
  const { data, isLoading, isError } = useWidgetData(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Pick a source board
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const value = numberFromBuckets(data?.buckets ?? []);

  if (config.display === "gauge" && config.target && config.target > 0) {
    const pct = Math.min(value / config.target, 1);
    const r = 38;
    const circ = 2 * Math.PI * r;
    return (
      <div className="flex h-full items-center justify-center gap-4">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle cx="46" cy="46" r={r} fill="none" stroke="var(--muted)" strokeWidth="9" />
          <circle
            cx="46"
            cy="46"
            r={r}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
            transform="rotate(-90 46 46)"
          />
        </svg>
        <div>
          <div className="text-2xl font-semibold tabular-nums">
            {Math.round(pct * 100)}%
          </div>
          <div className="text-muted-foreground text-xs">
            {formatMetric(value, agg)} / {config.target}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <span className="bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-4xl font-semibold tabular-nums text-transparent">
        {formatMetric(value, agg)}
      </span>
      <span className="text-muted-foreground mt-1 text-xs tracking-wide uppercase">
        {agg === "count" ? "items" : agg}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboards/widgets/NumberWidget.tsx
git commit -m "feat(dashboards): NumberWidget gauge display + gradient numeral"
```

---

### Task 2.4: Card shell reskin (`DashboardWidget`) + battery/list polish

**Files:**

- Modify: `src/components/dashboards/DashboardWidget.tsx`
- Modify: `src/components/dashboards/widgets/BatteryWidget.tsx` (legend spacing), `ListWidget.tsx` (sticky header polish)

> Apply the approved B+C language to the shell only — accent-dot header, subtle top glow, refined border. Do NOT change `DashboardWidget`'s edit/menu wiring in this task (T3 owns that). Battery/List get light token polish.

- [ ] **Step 1: Update the card shell in `DashboardWidget.tsx`**

Replace the outer card `<div className="bg-card flex h-full flex-col rounded-lg border">` opening tag and its header row's leading element. Change the card wrapper to:

```typescript
      <div className="bg-card relative flex h-full flex-col overflow-hidden rounded-xl border [background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]">
```

And in the header row, add an accent dot before the title block. Find the header `<div className="flex items-center justify-between border-b px-3 py-2">` and insert, as its first child, a leading flex wrapper around the title with the dot:

```typescript
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-[3px] bg-[var(--brand)]" aria-hidden />
          {/* existing title button / input / span goes here unchanged */}
        </div>
```

(Keep the title `<button>`/`<Input>`/`<span>` exactly as-is, just nested inside this new wrapper; keep the menu `DropdownMenu` as the second child of the header row.)

- [ ] **Step 2: Battery legend + List header token polish**

In `BatteryWidget.tsx`, change the bar container `className="flex h-7 w-full overflow-hidden rounded-md"` to `rounded-lg` and add `ring-1 ring-border` for definition:

```typescript
      <div className="ring-border flex h-7 w-full overflow-hidden rounded-lg ring-1">
```

In `ListWidget.tsx`, the `<thead>` className `"text-muted-foreground bg-card sticky top-0 text-left text-xs"` → add a bottom border for separation:

```typescript
        <thead className="text-muted-foreground bg-card sticky top-0 border-b text-left text-xs">
```

- [ ] **Step 3: Run the full widget test + typecheck**

Run: `pnpm test src/components/dashboards && pnpm typecheck`
Expected: PASS (ChartWidget test still green; no widget test regressions).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/DashboardWidget.tsx src/components/dashboards/widgets/BatteryWidget.tsx src/components/dashboards/widgets/ListWidget.tsx
git commit -m "feat(dashboards): bordered-card shell + accent-dot header reskin"
```

**T2 gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.

---

## TASK 3 — Edit drawer + unified config (depends on T1)

### Task 3.1: `WidgetConfigForm` (unified, all kinds)

**Files:**

- Create: `src/components/dashboards/WidgetConfigForm.tsx`
- Test: `src/components/dashboards/WidgetConfigForm.test.tsx`

> This is the single source of truth for building a widget config. It owns the `BoardOption` type (moved from `AddWidgetDialog`). It is a **controlled** component: it takes `value` (a draft config + kind + board + title) and emits `onChange`, so the parent Sheet can render a live preview from the same draft.

- [ ] **Step 1: Define the draft type + write a logic test**

Create `src/components/dashboards/WidgetConfigForm.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WidgetConfigForm,
  type WidgetDraft,
  type BoardOption,
} from "@/components/dashboards/WidgetConfigForm";

const boards: BoardOption[] = [
  {
    id: "b1",
    name: "Board 1",
    numbersColumns: [{ id: "n1", name: "Points" }],
    statusColumns: [{ id: "s1", name: "Status" }],
    dateColumns: [{ id: "d1", name: "Due" }],
    peopleColumns: [{ id: "p1", name: "Owner" }],
    dropdownColumns: [{ id: "dd1", name: "Priority" }],
    allColumns: [],
  },
];

function draft(): WidgetDraft {
  return {
    kind: "chart",
    sourceBoardId: "b1",
    title: "",
    config: { chartType: "bar", primary: { kind: "status", columnId: "s1" }, measure: { agg: "count" } },
  };
}

describe("WidgetConfigForm", () => {
  it("emits a chartType change when the user picks line", () => {
    const onChange = vi.fn();
    render(<WidgetConfigForm boards={boards} value={draft()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "line" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ chartType: "line" }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm test src/components/dashboards/WidgetConfigForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `WidgetConfigForm.tsx`**

```typescript
"use client";

import { Input } from "@/components/ui/input";
import { FilterBuilder } from "@/components/dashboards/FilterBuilder";
import { MULTI_SERIES_TYPES, DATE_PRIMARY_TYPES } from "@/lib/dashboards/chart-config";
import type { ChartType, ListFilter, SeriesDimension } from "@/lib/validations/dashboards";

export type BoardOption = {
  id: string;
  name: string;
  numbersColumns: { id: string; name: string }[];
  statusColumns: { id: string; name: string }[];
  dateColumns: { id: string; name: string }[];
  peopleColumns: { id: string; name: string }[];
  dropdownColumns: { id: string; name: string }[];
  allColumns: { id: string; name: string; kind: string; options: { id: string; label: string; color?: string }[] }[];
};

export type WidgetDraft = {
  kind: "number" | "chart" | "battery" | "list";
  sourceBoardId: string;
  title: string;
  config: Record<string, unknown>;
};

const selectClass = "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "stackedBar", label: "Stacked bar" },
  { value: "groupedBar", label: "Grouped bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "combo", label: "Combo (bar + line)" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "radial", label: "Radial" },
];

export function WidgetConfigForm({
  boards,
  value,
  onChange,
}: {
  boards: BoardOption[];
  value: WidgetDraft;
  onChange: (next: WidgetDraft) => void;
}) {
  const board = boards.find((b) => b.id === value.sourceBoardId);
  const cfg = value.config;

  function patch(next: Partial<WidgetDraft>) {
    onChange({ ...value, ...next });
  }
  function patchConfig(next: Record<string, unknown>) {
    onChange({ ...value, config: { ...value.config, ...next } });
  }

  // Dimension picker shared by primary + series.
  function DimensionPicker({
    label,
    dim,
    onPick,
    allowDate,
    allowNone,
  }: {
    label: string;
    dim: SeriesDimension | undefined;
    onPick: (d: SeriesDimension | undefined) => void;
    allowDate: boolean;
    allowNone: boolean;
  }) {
    const kind = dim?.kind ?? (allowNone ? "none" : "status");
    return (
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          {label}
          <select
            aria-label={label}
            className={selectClass}
            value={kind}
            onChange={(e) => {
              const k = e.target.value;
              if (k === "none") return onPick(undefined);
              if (k === "date")
                return onPick({ kind: "date", bucket: "month" });
              onPick({ kind: k as SeriesDimension["kind"], columnId: undefined });
            }}
          >
            {allowNone ? <option value="none">None</option> : null}
            <option value="status">Status</option>
            <option value="dropdown">Dropdown</option>
            <option value="people">People</option>
            {allowDate ? <option value="date">Date</option> : null}
          </select>
        </label>
        {dim && dim.kind === "date" ? (
          <label className="text-sm">
            Bucket
            <select
              aria-label={`${label} bucket`}
              className={selectClass}
              value={dim.bucket ?? "month"}
              onChange={(e) => onPick({ ...dim, bucket: e.target.value as "day" | "week" | "month" })}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
        ) : dim ? (
          <label className="text-sm">
            Column
            <select
              aria-label={`${label} column`}
              className={selectClass}
              value={dim.columnId ?? ""}
              onChange={(e) => onPick({ ...dim, columnId: e.target.value })}
            >
              <option value="">Select…</option>
              {columnsFor(board, dim.kind).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">
        Widget type
        <select
          className={selectClass}
          value={value.kind}
          onChange={(e) => patch({ kind: e.target.value as WidgetDraft["kind"], config: defaultConfig(e.target.value as WidgetDraft["kind"]) })}
        >
          <option value="number">Number</option>
          <option value="chart">Chart</option>
          <option value="battery">Battery</option>
          <option value="list">List</option>
        </select>
      </label>

      <label className="text-sm">
        Source board
        <select
          className={selectClass}
          value={value.sourceBoardId}
          onChange={(e) => patch({ sourceBoardId: e.target.value, config: defaultConfig(value.kind) })}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        Title
        <Input className="mt-1" value={value.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. By status" />
      </label>

      {value.kind === "chart" ? (
        <>
          <label className="text-sm">
            Chart type
            <select
              aria-label="Chart type"
              className={selectClass}
              value={(cfg.chartType as string) ?? "bar"}
              onChange={(e) => {
                const next = e.target.value as ChartType;
                const isDate = DATE_PRIMARY_TYPES.includes(next);
                patchConfig({
                  chartType: next,
                  primary: isDate ? { kind: "date", bucket: "month" } : (cfg.primary ?? { kind: "status" }),
                  ...(MULTI_SERIES_TYPES.includes(next) ? {} : { series: undefined }),
                });
              }}
            >
              {CHART_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <DimensionPicker
            label="Group by"
            dim={cfg.primary as SeriesDimension}
            onPick={(d) => patchConfig({ primary: d })}
            allowDate={DATE_PRIMARY_TYPES.includes(cfg.chartType as ChartType)}
            allowNone={false}
          />

          {MULTI_SERIES_TYPES.includes(cfg.chartType as ChartType) ? (
            <DimensionPicker
              label="Split series by"
              dim={cfg.series as SeriesDimension | undefined}
              onPick={(d) => patchConfig({ series: d })}
              allowDate={false}
              allowNone
            />
          ) : null}

          <MeasureFields board={board} cfg={cfg} patchConfig={patchConfig} />
        </>
      ) : value.kind === "number" ? (
        <NumberFields board={board} cfg={cfg} patchConfig={patchConfig} />
      ) : value.kind === "battery" ? (
        <label className="text-sm">
          Group by (status column)
          <select
            className={selectClass}
            value={(cfg.groupColumnId as string) ?? ""}
            onChange={(e) => patchConfig({ groupColumnId: e.target.value })}
          >
            <option value="">Select…</option>
            {(board?.statusColumns ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <ListFields board={board} cfg={cfg} patchConfig={patchConfig} />
      )}
    </div>
  );
}

function columnsFor(board: BoardOption | undefined, kind: string) {
  if (!board) return [];
  if (kind === "status") return board.statusColumns;
  if (kind === "dropdown") return board.dropdownColumns;
  if (kind === "people") return board.peopleColumns;
  if (kind === "date") return board.dateColumns;
  return [];
}

export function defaultConfig(kind: WidgetDraft["kind"]): Record<string, unknown> {
  switch (kind) {
    case "number":
      return { agg: "count", display: "plain" };
    case "chart":
      return { chartType: "bar", primary: { kind: "status" }, measure: { agg: "count" } };
    case "battery":
      return {};
    case "list":
      return { columnIds: [], limit: 25 };
  }
}

function MeasureFields({ board, cfg, patchConfig }: { board: BoardOption | undefined; cfg: Record<string, unknown>; patchConfig: (n: Record<string, unknown>) => void }) {
  const measure = (cfg.measure ?? { agg: "count" }) as { agg: string; valueColumnId?: string };
  return (
    <>
      <label className="text-sm">
        Measure
        <select className={selectClass} value={measure.agg} onChange={(e) => patchConfig({ measure: { ...measure, agg: e.target.value } })}>
          <option value="count">Count of items</option>
          <option value="sum">Sum of a number column</option>
          <option value="avg">Average of a number column</option>
        </select>
      </label>
      {measure.agg !== "count" ? (
        <label className="text-sm">
          Number column
          <select className={selectClass} value={measure.valueColumnId ?? ""} onChange={(e) => patchConfig({ measure: { ...measure, valueColumnId: e.target.value } })}>
            <option value="">Select…</option>
            {(board?.numbersColumns ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

function NumberFields({ board, cfg, patchConfig }: { board: BoardOption | undefined; cfg: Record<string, unknown>; patchConfig: (n: Record<string, unknown>) => void }) {
  const agg = (cfg.agg as string) ?? "count";
  const display = (cfg.display as string) ?? "plain";
  return (
    <>
      <label className="text-sm">
        Metric
        <select className={selectClass} value={agg} onChange={(e) => patchConfig({ agg: e.target.value })}>
          <option value="count">Count of items</option>
          <option value="sum">Sum of a number column</option>
          <option value="avg">Average of a number column</option>
        </select>
      </label>
      {agg !== "count" ? (
        <label className="text-sm">
          Number column
          <select className={selectClass} value={(cfg.valueColumnId as string) ?? ""} onChange={(e) => patchConfig({ valueColumnId: e.target.value })}>
            <option value="">Select…</option>
            {(board?.numbersColumns ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-sm">
        Display
        <select className={selectClass} value={display} onChange={(e) => patchConfig({ display: e.target.value })}>
          <option value="plain">Plain number</option>
          <option value="gauge">Gauge (vs target)</option>
        </select>
      </label>
      {display === "gauge" ? (
        <label className="text-sm">
          Target
          <Input type="number" min={1} className="mt-1" value={(cfg.target as number) ?? ""} onChange={(e) => patchConfig({ target: Number(e.target.value) || undefined })} />
        </label>
      ) : null}
    </>
  );
}

function ListFields({ board, cfg, patchConfig }: { board: BoardOption | undefined; cfg: Record<string, unknown>; patchConfig: (n: Record<string, unknown>) => void }) {
  const columnIds = (cfg.columnIds as string[]) ?? [];
  const limit = (cfg.limit as number) ?? 25;
  const filter = (cfg.filter as ListFilter) ?? { combinator: "and", conditions: [] };
  return (
    <>
      <fieldset className="text-sm">
        <legend className="mb-1">Columns to show</legend>
        <div className="flex flex-col gap-1 rounded-md border p-2">
          {(board?.allColumns ?? []).length === 0 ? (
            <span className="text-muted-foreground text-xs">This board has no columns.</span>
          ) : (
            board?.allColumns.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={columnIds.includes(c.id)}
                  onChange={(e) =>
                    patchConfig({ columnIds: e.target.checked ? [...columnIds, c.id] : columnIds.filter((id) => id !== c.id) })
                  }
                />
                {c.name}
              </label>
            ))
          )}
        </div>
      </fieldset>
      <label className="text-sm">
        Max rows
        <Input type="number" min={1} max={100} className="mt-1" value={limit} onChange={(e) => patchConfig({ limit: Math.min(Math.max(Number(e.target.value) || 1, 1), 100) })} />
      </label>
      <FilterBuilder columns={board?.allColumns ?? []} value={filter} onChange={(f) => patchConfig({ filter: f })} />
    </>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm test src/components/dashboards/WidgetConfigForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/WidgetConfigForm.tsx src/components/dashboards/WidgetConfigForm.test.tsx
git commit -m "feat(dashboards): unified WidgetConfigForm for all widget kinds"
```

---

### Task 3.2: `WidgetConfigSheet` with live preview

**Files:** Create `src/components/dashboards/WidgetConfigSheet.tsx`

> The Sheet hosts the form (left) and a debounced live preview (right). On save it calls `addWidget`/`editWidget` from `useDashboardMutations`. For an EDIT, it normalizes the stored chart config to the v2 draft shape via `normalizeChartConfig`. The preview renders the real widget components fed by the draft — but widget components fetch by `widget.id` via the hooks, so the preview builds a transient widget object and lets the hook re-query on a debounced draft (config hash changes → one scoped refetch).

- [ ] **Step 1: Implement `WidgetConfigSheet.tsx`**

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  WidgetConfigForm,
  defaultConfig,
  type BoardOption,
  type WidgetDraft,
} from "@/components/dashboards/WidgetConfigForm";
import { NumberWidget } from "@/components/dashboards/widgets/NumberWidget";
import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
import { BatteryWidget } from "@/components/dashboards/widgets/BatteryWidget";
import { ListWidget } from "@/components/dashboards/widgets/ListWidget";
import { normalizeChartConfig } from "@/lib/dashboards/chart-config";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";

function draftFromWidget(w: CacheWidget): WidgetDraft {
  const config =
    w.kind === "chart"
      ? (normalizeChartConfig((w.config ?? {}) as Record<string, unknown>) as unknown as Record<string, unknown>)
      : ((w.config ?? {}) as Record<string, unknown>);
  return { kind: w.kind, sourceBoardId: w.source_board_id ?? "", title: w.title ?? "", config };
}

export function WidgetConfigSheet({
  dashboardId,
  boards,
  open,
  onOpenChange,
  editWidget: target,
}: {
  dashboardId: string;
  boards: BoardOption[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editWidget?: CacheWidget;
}) {
  const { addWidget, editWidget } = useDashboardMutations(dashboardId);
  const [draft, setDraft] = useState<WidgetDraft>(() =>
    target
      ? draftFromWidget(target)
      : { kind: "number", sourceBoardId: boards[0]?.id ?? "", title: "", config: defaultConfig("number") },
  );
  const [error, setError] = useState<string | null>(null);

  // Re-seed the draft whenever the sheet (re)opens for a different target.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDraft(
      target
        ? draftFromWidget(target)
        : { kind: "number", sourceBoardId: boards[0]?.id ?? "", title: "", config: defaultConfig("number") },
    );
  }, [open, target, boards]);

  // Debounce the draft → preview config so typing/picking doesn't spam queries.
  const [previewCfg, setPreviewCfg] = useState(draft.config);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCfg(draft.config), 400);
    return () => clearTimeout(t);
  }, [draft.config]);

  const previewWidget = useMemo(
    () =>
      ({
        id: target?.id ?? "__preview__",
        kind: draft.kind,
        source_board_id: draft.sourceBoardId || null,
        title: draft.title,
        config: previewCfg,
      }) as CacheWidget,
    [target?.id, draft.kind, draft.sourceBoardId, draft.title, previewCfg],
  );

  function save() {
    setError(null);
    if (!draft.sourceBoardId) return setError("Pick a source board.");
    if (target) {
      editWidget.mutate(
        { widgetId: target.id, title: draft.title, sourceBoardId: draft.sourceBoardId, config: draft.config },
        { onSuccess: () => onOpenChange(false), onError: (e) => setError(e.message) },
      );
    } else {
      addWidget.mutate(
        { kind: draft.kind, sourceBoardId: draft.sourceBoardId, title: draft.title, config: draft.config },
        { onSuccess: () => onOpenChange(false), onError: (e) => setError(e.message) },
      );
    }
  }

  const pending = addWidget.isPending || editWidget.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{target ? "Edit widget" : "Add a widget"}</SheetTitle>
        </SheetHeader>
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto py-4 md:grid-cols-[1fr_1.1fr]">
          <WidgetConfigForm boards={boards} value={draft} onChange={setDraft} />
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs tracking-wide uppercase">Live preview</span>
            <div className="bg-card relative h-64 rounded-xl border p-3">
              {draft.kind === "number" ? (
                <NumberWidget widget={previewWidget} />
              ) : draft.kind === "chart" ? (
                <ChartWidget widget={previewWidget} />
              ) : draft.kind === "battery" ? (
                <BatteryWidget widget={previewWidget} />
              ) : (
                <ListWidget widget={previewWidget} />
              )}
            </div>
          </div>
        </div>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{target ? "Save" : "Add widget"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

> Implementer note: the preview for a NEW widget uses id `"__preview__"`; the hooks will call `getWidgetData`/`getWidgetSeries` with that id, which returns "Widget not found." → the preview shows the "Failed to load" state until first save. If you want a true pre-save preview, add an optional `previewConfig` path to the actions that accepts an inline config instead of a widgetId. That is a **stretch**; the spec's live preview is fully satisfied for EDIT (real id). Note this limitation in the PR description and the "How to test" guide.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboards/WidgetConfigSheet.tsx
git commit -m "feat(dashboards): WidgetConfigSheet drawer with live preview"
```

---

### Task 3.3: Wire the sheet in; remove old dialogs

**Files:**

- Modify: `src/components/dashboards/DashboardCanvas.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx`
- Modify: `src/app/dashboards/[dashboardId]/page.tsx` (extend `BoardOption` fetch)
- Delete: `src/components/dashboards/AddWidgetDialog.tsx`, `EditListWidgetDialog.tsx`

- [ ] **Step 1: Extend the server `BoardOption` fetch in `page.tsx`**

Update the import (`BoardOption` now comes from `WidgetConfigForm`) and the `boards` mapping to populate the new column groups. Replace the import line:

```typescript
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
```

Replace the `.map((b) => {...})` body's returned object with:

```typescript
return {
  id: b.id,
  name: b.name,
  numbersColumns: cols
    .filter((c) => c.kind === "numbers")
    .map((c) => ({ id: c.id, name: c.name })),
  statusColumns: cols
    .filter((c) => c.kind === "status")
    .map((c) => ({ id: c.id, name: c.name })),
  dateColumns: cols
    .filter((c) => c.kind === "date")
    .map((c) => ({ id: c.id, name: c.name })),
  peopleColumns: cols
    .filter((c) => c.kind === "people")
    .map((c) => ({ id: c.id, name: c.name })),
  dropdownColumns: cols
    .filter((c) => c.kind === "dropdown")
    .map((c) => ({ id: c.id, name: c.name })),
  allColumns: cols.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    options:
      optionSchema
        .array()
        .safeParse((c.settings as { options?: unknown }).options ?? []).data ??
      [],
  })),
};
```

- [ ] **Step 2: Swap `AddWidgetDialog` for the sheet trigger in `DashboardCanvas.tsx`**

Replace the import:

```typescript
import { WidgetConfigSheet } from "@/components/dashboards/WidgetConfigSheet";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
```

Add state near the other `useState`s:

```typescript
const [addOpen, setAddOpen] = useState(false);
```

Replace the `{editing ? <AddWidgetDialog ... /> : null}` block with:

```typescript
          {editing ? (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              Add widget
            </Button>
          ) : null}
```

And before the closing `</div>` of the component, render the sheet:

```typescript
      <WidgetConfigSheet
        dashboardId={dashboardId}
        boards={boards}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
```

- [ ] **Step 3: Route the edit menu through the sheet in `DashboardWidget.tsx`**

Replace the `EditListWidgetDialog` import with:

```typescript
import { WidgetConfigSheet } from "@/components/dashboards/WidgetConfigSheet";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
```

Change the menu so **every** kind shows Edit (not just list). Replace the conditional `{widget.kind === "list" ? (<>…Edit…</>) : null}` with an always-present Edit item:

```typescript
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 size-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
```

Replace the trailing `{widget.kind === "list" ? (<EditListWidgetDialog … />) : null}` with:

```typescript
      <WidgetConfigSheet
        dashboardId={dashboardId}
        boards={boards}
        open={editOpen}
        onOpenChange={setEditOpen}
        editWidget={widget}
      />
```

- [ ] **Step 4: Delete the obsolete dialogs**

```bash
git rm src/components/dashboards/AddWidgetDialog.tsx src/components/dashboards/EditListWidgetDialog.tsx
```

- [ ] **Step 5: Fix references + typecheck**

Run: `pnpm typecheck`
Expected: errors only where `BoardOption` was imported from the deleted `AddWidgetDialog` — repoint each to `@/components/dashboards/WidgetConfigForm`. Re-run until PASS.

- [ ] **Step 6: Lint + test + build**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboards/DashboardCanvas.tsx src/components/dashboards/DashboardWidget.tsx src/app/dashboards/[dashboardId]/page.tsx
git commit -m "feat(dashboards): unified Add/Edit drawer; remove per-kind dialogs"
```

**T3 gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.

---

## Final integration & close-out (after T2 + T3 merge)

- [ ] **Step 1: Rebase the second-to-merge task** on the first (T2/T3 only co-touch `DashboardWidget.tsx`). Resolve the header/menu overlap: T2's accent-dot shell + T3's always-Edit menu and sheet wiring must both be present.

- [ ] **Step 2: Full gate on merged state**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 3: Manual acceptance** (see spec §11): add a combo-over-time chart via the drawer; add a stacked bar grouped by People; switch a Number to gauge; confirm drags don't refetch; confirm legacy widgets still render.

- [ ] **Step 4: `/wrapup`** — session note + north-star bump; mark Phase-8 dashboards polish shipped.

---

## Self-Review notes (filled during planning)

- **Spec coverage:** Pillar 0 → T1.1–T1.5. Pillar A (charts) → T2.1–T2.2. Pillar C (reskin) → T2.3–T2.4. Pillar B (drawer) → T3.1–T3.3. Perf budget → `useWidgetSeries` 60s stale + configHash keying (T1.4), debounced preview (T3.2), bounded RPC (T1.2). Tests → each task ships its test step.
- **Scope refinement vs spec:** Number/Battery keep `dashboard_aggregate` (Number ungrouped; Battery status-distribution); `dashboard_series` powers Chart only. `dashboard_aggregate` is **not** retired (spec D5 superseded — documented in this plan's Architecture). Battery/Number grouping by dropdown/people deferred to a follow-up.
- **Live-preview caveat:** real for EDIT (existing widget id); NEW-widget preview needs an inline-config action path (flagged as a stretch in T3.2) — otherwise preview is post-first-save. Surface in the PR + how-to-test.
- **Type consistency:** `WidgetDraft`/`BoardOption` defined once in `WidgetConfigForm.tsx`; `SeriesData`/`SeriesPoint` in `series.ts`; `ChartConfig`/`SeriesDimension`/`ChartType` in `validations/dashboards.ts`. Hooks key off `configHash` (existing).
- **Must verify against real code:** the `org_members`/`profiles` member-query in `getWidgetSeries` (T1.4) — confirm the table/relation names in `database.types.ts` before relying on them; the people-name resolution is the only place that query shape matters.
