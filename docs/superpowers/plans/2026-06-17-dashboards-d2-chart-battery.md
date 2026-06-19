# Dashboards D2 — Chart + Battery Widgets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two grouped-aggregate widgets to the dashboards built in D1 — a **Chart** (bar/pie) and a **Battery** (status distribution bar) — both grouping a source board's items by a **Status** column.

**Architecture:** No DB/RPC change — D1's `dashboard_aggregate` already groups by a status column's `optionId`. D2 (a) extends `getWidgetData` to also return the group column's `columnMeta` (kind + options with label/color), (b) adds a pure `shapeBuckets` helper that joins aggregate buckets to those options (with a "None" bucket for items lacking a value), (c) renders Chart via `recharts` and Battery via plain CSS, and (d) generalizes the add-widget dialog to pick a widget type + status group column + chart style.

**Tech Stack:** Next.js 16, React 19, Supabase, TanStack Query, Zod, `recharts` (new), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-17-dashboards-cross-board-design.md` (§3.2 chart/battery config, §3.3 grouping, §3.4 columnMeta, §5 D2). **Scope decision (2026-06-17):** grouping is **Status columns only** this slice — Dropdown/People grouping deferred (no RPC change needed).

---

## File structure

**Create:**

- `src/components/dashboards/widgets/ChartWidget.tsx` — recharts bar/pie.
- `src/components/dashboards/widgets/BatteryWidget.tsx` — CSS stacked status bar.

**Modify:**

- `src/lib/validations/dashboards.ts` — add `chartConfigSchema`, `batteryConfigSchema`; wire into `configSchemaForKind`.
- `src/lib/dashboards/widget-data.ts` — add `ColumnMeta`/`ShapedBucket` types + `shapeBuckets()` + `bucketsTotal()`.
- `src/lib/dashboards/actions.ts` — `getWidgetData` returns `columnMeta` for grouped widgets.
- `src/lib/dashboards/use-widget-data.ts` — return the full `{ buckets, columnMeta }`, not just buckets.
- `src/components/dashboards/widgets/NumberWidget.tsx` — read `data.buckets` (return-shape change).
- `src/components/dashboards/DashboardWidget.tsx` — dispatch `chart`/`battery` cases.
- `src/components/dashboards/AddWidgetDialog.tsx` — widget-type picker + status-group + chart-style config; `BoardOption` gains `statusColumns`.
- `src/app/dashboards/[dashboardId]/page.tsx` — load status columns per board into `BoardOption`.
- `src/lib/dashboards/dashboards.rls.integration.test.ts` — add a grouped-by-status aggregate assertion.
- `package.json` (+ lockfile) — add `recharts`.
- `e2e/dashboards.spec.ts` — add a Chart-widget flow.

---

## Task 1: Add recharts

**Files:** `package.json`, lockfile

- [ ] **Step 1: Install**

Run: `pnpm add recharts`
Expected: `recharts` added to `package.json` dependencies.

- [ ] **Step 2: Verify build still green**

Run: `pnpm build`
Expected: PASS (no usage yet).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(dashboards): add recharts (D2)"
```

---

## Task 2: Chart + Battery config schemas

**Files:**

- Modify: `src/lib/validations/dashboards.ts`
- Test: `src/lib/validations/dashboards.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append to the existing test file)**

Add to `src/lib/validations/dashboards.test.ts`:

```ts
import {
  batteryConfigSchema,
  chartConfigSchema,
  configSchemaForKind,
} from "./dashboards";

describe("chartConfigSchema", () => {
  const col = "11111111-1111-4111-8111-111111111111";
  it("requires a groupColumnId and a valid chartStyle", () => {
    expect(
      chartConfigSchema.safeParse({ groupColumnId: col, chartStyle: "bar" })
        .success,
    ).toBe(true);
    expect(
      chartConfigSchema.safeParse({ groupColumnId: col, chartStyle: "pie" })
        .success,
    ).toBe(true);
    expect(
      chartConfigSchema.safeParse({ groupColumnId: col, chartStyle: "line" })
        .success,
    ).toBe(false);
    expect(chartConfigSchema.safeParse({ chartStyle: "bar" }).success).toBe(
      false,
    );
  });
});

describe("batteryConfigSchema", () => {
  it("requires a groupColumnId", () => {
    expect(
      batteryConfigSchema.safeParse({
        groupColumnId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(batteryConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe("configSchemaForKind (D2)", () => {
  it("routes chart and battery to their schemas", () => {
    const col = "11111111-1111-4111-8111-111111111111";
    expect(
      configSchemaForKind("chart").safeParse({
        groupColumnId: col,
        chartStyle: "bar",
      }).success,
    ).toBe(true);
    expect(
      configSchemaForKind("battery").safeParse({ groupColumnId: col }).success,
    ).toBe(true);
    // chart without a group column is rejected (no longer the permissive default)
    expect(configSchemaForKind("chart").safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: FAIL — `chartConfigSchema`/`batteryConfigSchema` not exported; chart `{}` currently passes the permissive default.

- [ ] **Step 3: Implement**

In `src/lib/validations/dashboards.ts`, add after `numberConfigSchema`/`NumberConfig` (before the `configObject` declaration):

```ts
export const chartConfigSchema = z.object({
  groupColumnId: uuid,
  chartStyle: z.enum(["bar", "pie"]),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

export const batteryConfigSchema = z.object({ groupColumnId: uuid });
export type BatteryConfig = z.infer<typeof batteryConfigSchema>;
```

Then update `configSchemaForKind` to route the new kinds:

```ts
export function configSchemaForKind(kind: z.infer<typeof widgetKindSchema>) {
  switch (kind) {
    case "number":
      return numberConfigSchema;
    case "chart":
      return chartConfigSchema;
    case "battery":
      return batteryConfigSchema;
    // D3 adds list; until then accept any object.
    default:
      return configObject;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: PASS (all old + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts
git commit -m "feat(dashboards): chart + battery config schemas (D2)"
```

---

## Task 3: `shapeBuckets` — join aggregate buckets to status options

**Files:**

- Modify: `src/lib/dashboards/widget-data.ts`
- Test: `src/lib/dashboards/widget-data.test.ts` (extend)

- [ ] **Step 1: Write the failing test (append)**

Add to `src/lib/dashboards/widget-data.test.ts`:

```ts
import { bucketsTotal, shapeBuckets, type ColumnMeta } from "./widget-data";

const meta: ColumnMeta = {
  kind: "status",
  options: [
    { id: "o1", label: "Working on it", color: "#fdab3d" },
    { id: "o2", label: "Done", color: "#00c875" },
  ],
};

describe("shapeBuckets", () => {
  it("resolves optionId buckets to label+color in option order", () => {
    const rows = shapeBuckets(
      [
        { group_key: "o2", metric: 3 },
        { group_key: "o1", metric: 5 },
      ],
      meta,
    );
    expect(rows.map((r) => [r.label, r.count, r.color])).toEqual([
      ["Working on it", 5, "#fdab3d"],
      ["Done", 3, "#00c875"],
    ]);
  });

  it("adds a trailing 'None' bucket for the null group key", () => {
    const rows = shapeBuckets([{ group_key: null, metric: 2 }], meta);
    expect(rows.at(-1)).toMatchObject({ key: null, label: "None", count: 2 });
  });

  it("includes zero-count options and labels unknown ids", () => {
    const rows = shapeBuckets([{ group_key: "ghost", metric: 1 }], meta);
    // both known options appear with 0, plus the unknown id
    expect(rows.find((r) => r.label === "Working on it")?.count).toBe(0);
    expect(rows.find((r) => r.label === "Done")?.count).toBe(0);
    expect(rows.find((r) => r.label === "Unknown")?.count).toBe(1);
  });
});

describe("bucketsTotal", () => {
  it("sums metrics", () => {
    expect(
      bucketsTotal([
        { group_key: "o1", metric: 5 },
        { group_key: null, metric: 2 },
      ]),
    ).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/dashboards/widget-data.test.ts`
Expected: FAIL — `shapeBuckets`/`bucketsTotal`/`ColumnMeta` not exported.

- [ ] **Step 3: Implement (append to `src/lib/dashboards/widget-data.ts`)**

```ts
/** A status/dropdown column option as resolved from columns.settings. */
export type ColumnOption = { id: string; label: string; color: string };

/** Metadata about a widget's group column, resolved server-side for rendering. */
export type ColumnMeta = { kind: string; options: ColumnOption[] };

/** A display-ready bucket: option label/color joined to its count. */
export type ShapedBucket = {
  key: string | null;
  label: string;
  color: string;
  count: number;
};

const NONE_COLOR = "var(--muted-foreground)";

/**
 * Join aggregate buckets to a status column's options for rendering.
 * - one row per option (in option order), even when count is 0;
 * - a trailing "None" row for the null group key (items with no value);
 * - unknown ids (e.g. a deleted option still present in old cells) → "Unknown".
 */
export function shapeBuckets(
  buckets: AggregateBucket[],
  meta: ColumnMeta,
): ShapedBucket[] {
  const counts = new Map<string | null, number>();
  for (const b of buckets) counts.set(b.group_key, b.metric ?? 0);

  const rows: ShapedBucket[] = meta.options.map((o) => ({
    key: o.id,
    label: o.label,
    color: o.color,
    count: counts.get(o.id) ?? 0,
  }));

  const known = new Set(meta.options.map((o) => o.id));
  let unknown = 0;
  let none = 0;
  for (const [key, count] of counts) {
    if (key === null) none += count;
    else if (!known.has(key)) unknown += count;
  }
  if (unknown > 0)
    rows.push({
      key: "__unknown__",
      label: "Unknown",
      color: NONE_COLOR,
      count: unknown,
    });
  if (none > 0)
    rows.push({ key: null, label: "None", color: NONE_COLOR, count: none });

  return rows;
}

/** Total across buckets (denominator for battery percentages). */
export function bucketsTotal(buckets: AggregateBucket[]): number {
  return buckets.reduce((sum, b) => sum + (b.metric ?? 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/dashboards/widget-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/widget-data.ts src/lib/dashboards/widget-data.test.ts
git commit -m "feat(dashboards): shapeBuckets helper joins buckets to status options (D2)"
```

---

## Task 4: `getWidgetData` returns columnMeta; hook + NumberWidget follow the new shape

**Files:**

- Modify: `src/lib/dashboards/actions.ts`
- Modify: `src/lib/dashboards/use-widget-data.ts`
- Modify: `src/components/dashboards/widgets/NumberWidget.tsx`
- Modify: `src/lib/dashboards/dashboards.rls.integration.test.ts` (add grouped assertion)

- [ ] **Step 1: Extend `getWidgetData` to resolve the group column's options**

In `src/lib/dashboards/actions.ts`, import the option parser and the new type. At the top add:

```ts
import { optionSchema } from "@/lib/validations/boards";
import {
  type AggregateBucket,
  type ColumnMeta,
} from "@/lib/dashboards/widget-data";
```

(Replace the existing `import { type AggregateBucket } ...` line with the combined import above.)

Change the `getWidgetData` return type to include `columnMeta`:

```ts
export async function getWidgetData(input: { widgetId: string }): Promise<
  ActionResult<{
    kind: Widget["kind"];
    config: Record<string, unknown>;
    buckets: AggregateBucket[];
    columnMeta: ColumnMeta | null;
  }>
> {
```

Then, after the buckets are built and before the final return, resolve `columnMeta` when the config names a group column:

```ts
const buckets: AggregateBucket[] = (data ?? []).map((r) => ({
  group_key: r.group_key,
  metric: Number(r.metric),
}));

// For grouped widgets, resolve the group column's options for label/color
// rendering (kept server-side so renames/recolors reflect without a stale snapshot).
let columnMeta: ColumnMeta | null = null;
const groupColumnId = config.groupColumnId as string | undefined;
if (groupColumnId) {
  const { data: col } = await supabase
    .from("columns")
    .select("kind, settings")
    .eq("id", groupColumnId)
    .maybeSingle();
  if (col) {
    const opts = optionSchema
      .array()
      .safeParse((col.settings as { options?: unknown }).options ?? []);
    columnMeta = { kind: col.kind, options: opts.success ? opts.data : [] };
  }
}

return { ok: true, data: { kind: widget.kind, config, buckets, columnMeta } };
```

Also update the early `source_board_id`-missing return to include `columnMeta: null`:

```ts
if (!widget.source_board_id)
  return {
    ok: true,
    data: { kind: widget.kind, config: {}, buckets: [], columnMeta: null },
  };
```

- [ ] **Step 2: Update `use-widget-data.ts` to return the full payload**

Replace `src/lib/dashboards/use-widget-data.ts` with:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetData } from "@/lib/dashboards/actions";
import {
  configHash,
  type AggregateBucket,
  type ColumnMeta,
} from "@/lib/dashboards/widget-data";

export type WidgetData = {
  buckets: AggregateBucket[];
  columnMeta: ColumnMeta | null;
};

/**
 * Fetch one widget's bounded aggregate + (for grouped widgets) its group
 * column's options. Keyed by widget id + config hash so an edit re-queries only
 * this widget. Never refetched by layout drags.
 */
export function useWidgetData(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget", widgetId, configHash(config)],
    queryFn: async (): Promise<WidgetData> => {
      const res = await getWidgetData({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return { buckets: res.data.buckets, columnMeta: res.data.columnMeta };
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Update `NumberWidget.tsx` for the new shape**

In `src/components/dashboards/widgets/NumberWidget.tsx`, the hook now returns `{ buckets, columnMeta }`. Change the value derivation from `numberFromBuckets(data ?? [])` to read `data?.buckets`:

```tsx
const { data, isLoading, isError } = useWidgetData(
  widget.id,
  widget.config as Record<string, unknown>,
);
// ... unchanged guards ...
const value = numberFromBuckets(data?.buckets ?? []);
```

(Only that one line changes — everything else in the component stays.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Add a grouped-aggregate assertion to the integration test**

In `src/lib/dashboards/dashboards.rls.integration.test.ts`, add a test that sets a status value on some items and asserts grouped counts. Use the `statusColumnId` + `doneOptionId` already provisioned in the test's `provisionUser`. Insert cell values via the existing cell upsert path the boards test uses (mirror it — likely `upsert_cell`/`set_cell` RPC or a direct `cell_values` upsert under the user's anon client), then:

```ts
it("dashboard_aggregate groups items by a status column (optionId + None bucket)", async () => {
  // a.boardId has items from the earlier count test; set "Done" on one item.
  const { data: items } = await a.anon
    .from("items")
    .select("id")
    .eq("board_id", a.boardId);
  expect(items && items.length > 0).toBe(true);
  // set the status cell on the first item (mirror the boards test's cell-write path)
  await a.anon.from("cell_values").upsert({
    org_id: a.orgId,
    board_id: a.boardId,
    item_id: items![0].id,
    column_id: a.statusColumnId,
    value: { optionId: a.doneOptionId },
  });

  const { data, error } = await a.anon.rpc("dashboard_aggregate", {
    p_board_id: a.boardId,
    p_group_column_id: a.statusColumnId,
    p_agg: "count",
  });
  expect(error).toBeNull();
  const done = data!.find((r) => r.group_key === a.doneOptionId);
  const none = data!.find((r) => r.group_key === null);
  expect(Number(done!.metric)).toBe(1);
  expect(Number(none!.metric)).toBeGreaterThanOrEqual(1); // the other items
});
```

> When implementing: confirm the exact cell-write mechanism used elsewhere (a direct `cell_values` upsert under RLS vs. an RPC). Use whatever the boards integration test / `upsertCell` action uses so RLS accepts it.

- [ ] **Step 6: Run the integration test (live)**

Run: `pnpm vitest run src/lib/dashboards/dashboards.rls.integration.test.ts`
Expected: PASS (now 5 tests). If the grouped counts are wrong, STOP and report BLOCKED (it would indicate a real RPC bug).

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboards/actions.ts src/lib/dashboards/use-widget-data.ts src/components/dashboards/widgets/NumberWidget.tsx src/lib/dashboards/dashboards.rls.integration.test.ts
git commit -m "feat(dashboards): getWidgetData resolves group-column options; verify grouped aggregate (D2)"
```

---

## Task 5: Chart + Battery widget bodies + dispatch

**Files:**

- Create: `src/components/dashboards/widgets/ChartWidget.tsx`
- Create: `src/components/dashboards/widgets/BatteryWidget.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx`

**MANDATORY:** invoke the `pulse-ui` and `frontend-design` skills before writing these UI components. Status segment colors come from the option's own `color` (semantic data color, Monday-style) — that is correct here, not a palette violation. Chrome/empty/loading states use semantic tokens (`text-muted-foreground`, `bg-muted/40`).

- [ ] **Step 1: Create `ChartWidget.tsx`**

```tsx
"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { shapeBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function ChartWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as {
    groupColumnId?: string;
    chartStyle?: "bar" | "pie";
  };
  const { data, isLoading, isError } = useWidgetData(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id || !config.groupColumnId)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board and group column
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.columnMeta)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const rows = shapeBuckets(data.buckets, data.columnMeta).filter(
    (r) => r.count > 0,
  );
  if (rows.length === 0)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  return (
    <ResponsiveContainer width="100%" height="100%">
      {config.chartStyle === "pie" ? (
        <PieChart>
          <Tooltip />
          <Pie
            data={rows}
            dataKey="count"
            nameKey="label"
            innerRadius="45%"
            outerRadius="80%"
          >
            {rows.map((r) => (
              <Cell key={r.key ?? "none"} fill={r.color} />
            ))}
          </Pie>
        </PieChart>
      ) : (
        <BarChart data={rows}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
          />
          <Tooltip cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.key ?? "none"} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
```

> Note: recharts `ResponsiveContainer` needs a sized parent — `DashboardWidget`'s body is `min-h-0 flex-1 p-3`, which gives it height inside the grid tile. If charts render 0-height, confirm the tile body has a concrete height (the rgl row height × widget `h` provides it).

- [ ] **Step 2: Create `BatteryWidget.tsx`**

```tsx
"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { bucketsTotal, shapeBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function BatteryWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as { groupColumnId?: string };
  const { data, isLoading, isError } = useWidgetData(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id || !config.groupColumnId)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board and group column
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.columnMeta)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const rows = shapeBuckets(data.buckets, data.columnMeta);
  const total = bucketsTotal(data.buckets);
  if (total === 0)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="flex h-7 w-full overflow-hidden rounded-md">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <div
              key={r.key ?? "none"}
              className="h-full"
              style={{
                width: `${(r.count / total) * 100}%`,
                backgroundColor: r.color,
              }}
              title={`${r.label}: ${r.count}`}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <li key={r.key ?? "none"} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ backgroundColor: r.color }}
              />
              <span className="text-muted-foreground">
                {r.label} {Math.round((r.count / total) * 100)}%
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Dispatch the new kinds in `DashboardWidget.tsx`**

Add the imports and replace the body dispatch. New imports:

```tsx
import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
import { BatteryWidget } from "@/components/dashboards/widgets/BatteryWidget";
```

Replace the `min-h-0 flex-1 p-3` body block's contents with:

```tsx
<div className="min-h-0 flex-1 p-3">
  {widget.kind === "number" ? (
    <NumberWidget widget={widget} />
  ) : widget.kind === "chart" ? (
    <ChartWidget widget={widget} />
  ) : widget.kind === "battery" ? (
    <BatteryWidget widget={widget} />
  ) : (
    <div className="text-muted-foreground text-sm">
      {widget.kind} widget — coming soon
    </div>
  )}
</div>
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/widgets/ChartWidget.tsx src/components/dashboards/widgets/BatteryWidget.tsx src/components/dashboards/DashboardWidget.tsx
git commit -m "feat(dashboards): chart (bar/pie) + battery widget bodies (D2)"
```

---

## Task 6: Generalize the Add-widget dialog

**Files:**

- Modify: `src/components/dashboards/AddWidgetDialog.tsx`
- Modify: `src/app/dashboards/[dashboardId]/page.tsx`

**MANDATORY:** invoke `pulse-ui` + `frontend-design` before editing the dialog.

- [ ] **Step 1: Add `statusColumns` to `BoardOption` + load them**

In `src/app/dashboards/[dashboardId]/page.tsx`, extend the per-board column query to also fetch status columns, and populate `statusColumns`. After the existing `numberCols` query add a status-columns query (bounded to the workspace's boards):

```tsx
const { data: statusCols } = await supabase
  .from("columns")
  .select("id, name, board_id")
  .eq("kind", "status")
  .in("board_id", boardIds);

const boards: BoardOption[] = (boardRows ?? []).map((b) => ({
  id: b.id,
  name: b.name,
  numbersColumns: (numberCols ?? [])
    .filter((c) => c.board_id === b.id)
    .map((c) => ({ id: c.id, name: c.name })),
  statusColumns: (statusCols ?? [])
    .filter((c) => c.board_id === b.id)
    .map((c) => ({ id: c.id, name: c.name })),
}));
```

- [ ] **Step 2: Rewrite `AddWidgetDialog.tsx` to support all three kinds**

Replace `src/components/dashboards/AddWidgetDialog.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";

export type BoardOption = {
  id: string;
  name: string;
  numbersColumns: { id: string; name: string }[];
  statusColumns: { id: string; name: string }[];
};

type Kind = "number" | "chart" | "battery";

const selectClass =
  "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

export function AddWidgetDialog({
  dashboardId,
  boards,
}: {
  dashboardId: string;
  boards: BoardOption[];
}) {
  const { addWidget } = useDashboardMutations(dashboardId);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("number");
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [agg, setAgg] = useState<"count" | "sum" | "avg">("count");
  const [valueColumnId, setValueColumnId] = useState("");
  const [groupColumnId, setGroupColumnId] = useState("");
  const [chartStyle, setChartStyle] = useState<"bar" | "pie">("bar");
  const [error, setError] = useState<string | null>(null);

  const board = boards.find((b) => b.id === boardId);
  const numbersCols = board?.numbersColumns ?? [];
  const statusCols = board?.statusColumns ?? [];

  function reset() {
    setTitle("");
    setAgg("count");
    setValueColumnId("");
    setGroupColumnId("");
    setChartStyle("bar");
    setKind("number");
  }

  function submit() {
    setError(null);
    if (!boardId) return setError("Pick a source board.");

    let config: Record<string, unknown>;
    if (kind === "number") {
      if (agg !== "count" && !valueColumnId)
        return setError("Pick a numbers column for sum/average.");
      config = agg === "count" ? { agg } : { agg, valueColumnId };
    } else {
      // chart + battery both group by a status column
      if (!groupColumnId) return setError("Pick a status column to group by.");
      config =
        kind === "chart" ? { groupColumnId, chartStyle } : { groupColumnId };
    }

    addWidget.mutate(
      { kind, sourceBoardId: boardId, title, config },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1.5 size-4" /> Add widget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            Widget type
            <select
              className={selectClass}
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              <option value="number">Number</option>
              <option value="chart">Chart</option>
              <option value="battery">Battery</option>
            </select>
          </label>

          <label className="text-sm">
            Source board
            <select
              className={selectClass}
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Title
            <Input
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. By status"
            />
          </label>

          {kind === "number" ? (
            <>
              <label className="text-sm">
                Metric
                <select
                  className={selectClass}
                  value={agg}
                  onChange={(e) =>
                    setAgg(e.target.value as "count" | "sum" | "avg")
                  }
                >
                  <option value="count">Count of items</option>
                  <option value="sum">Sum of a number column</option>
                  <option value="avg">Average of a number column</option>
                </select>
              </label>
              {agg !== "count" ? (
                <label className="text-sm">
                  Number column
                  <select
                    className={selectClass}
                    value={valueColumnId}
                    onChange={(e) => setValueColumnId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {numbersCols.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : (
            <>
              <label className="text-sm">
                Group by (status column)
                <select
                  className={selectClass}
                  value={groupColumnId}
                  onChange={(e) => setGroupColumnId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {statusCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "chart" ? (
                <label className="text-sm">
                  Chart style
                  <select
                    className={selectClass}
                    value={chartStyle}
                    onChange={(e) =>
                      setChartStyle(e.target.value as "bar" | "pie")
                    }
                  >
                    <option value="bar">Bar</option>
                    <option value="pie">Pie</option>
                  </select>
                </label>
              ) : null}
            </>
          )}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={addWidget.isPending}>
            Add widget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS (the `BoardOption` shape change flows to `DashboardCanvas` + the page; build confirms).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/AddWidgetDialog.tsx "src/app/dashboards/[dashboardId]/page.tsx"
git commit -m "feat(dashboards): add-widget dialog supports chart + battery (status grouping) (D2)"
```

---

## Task 7: e2e — add a Chart widget grouped by status

**Files:**

- Modify: `e2e/dashboards.spec.ts`

- [ ] **Step 1: Add a Chart-widget test**

Append a test to `e2e/dashboards.spec.ts` that reuses the existing fixtures (the same auth/board/seeded-item setup the D1 test uses — the seeded board has a Status column). It creates a dashboard, enters Edit, adds a **Chart** widget grouped by the Status column, and asserts a chart renders. Because recharts draws SVG, assert on the SVG presence inside the widget card:

```ts
test("add a Chart widget grouped by status renders an SVG chart", async ({
  page,
}) => {
  // reuse the same sign-in + board-with-item setup as the D1 test (copy its helpers)
  // ...
  await page.goto("/dashboards");
  await page.getByRole("button", { name: /new dashboard/i }).click();
  await page.getByLabel(/name/i).fill("Chart Dash");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]+/);

  await page.getByRole("button", { name: /^edit$/i }).click();
  await page.getByRole("button", { name: /add widget/i }).click();

  // pick Chart, default source board, group by the Status column, Bar
  await page.locator("select").first().selectOption("chart"); // Widget type
  // Group-by select appears for chart/battery; choose the first status column
  const groupSelect = page
    .getByText("Group by (status column)")
    .locator("select");
  await groupSelect.selectOption({ index: 1 }); // first real status column
  await page
    .getByRole("button", { name: /add widget/i })
    .last()
    .click();

  // a recharts SVG renders inside the widget card
  const widget = page.locator(".bg-card").filter({ hasText: /./ }).first();
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible({
    timeout: 10_000,
  });
});
```

> Note: confirm the exact selectors against the implemented dialog while writing — the "Widget type" select is the first `<select>`; the group-by select is the one under the "Group by (status column)" label. Adjust to robust accessors. The binding intent: adding a Chart widget grouped by status renders a chart (SVG) without errors.

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e e2e/dashboards.spec.ts`
Expected: PASS (both the D1 test and the new Chart test).

- [ ] **Step 3: Commit**

```bash
git add e2e/dashboards.spec.ts
git commit -m "test(dashboards): e2e add chart widget grouped by status (D2)"
```

---

## Task 8: Full gate + final review + push

- [ ] **Step 1: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS (unit + the live integration suite green; build clean).

- [ ] **Step 2: Final code review**

Use `superpowers:requesting-code-review` on the D2 diff. Priorities: the `getWidgetData` columnMeta resolution stays org-scoped (RLS on `columns`); `shapeBuckets` correctness (None/Unknown/zero-count); recharts renders within the tile; no `any`/`@ts-ignore`; the add-widget dialog resets state between kinds. Address findings.

- [ ] **Step 3: Push**

```bash
git push origin develop
```

---

## Notes for the implementer

- **No DB/RPC change** in D2 — `dashboard_aggregate` already groups by status `optionId`. If you find yourself editing the migration, stop and reconsider.
- **Status colors are data colors.** Chart segments / battery fills use each option's own `color` (hex from `columns.settings.options`) — this is the Monday-style intent, not a pulse-ui palette violation. Chrome and empty/loading states use semantic tokens.
- **Return-shape change:** `useWidgetData` now returns `{ buckets, columnMeta }` (was `buckets`). The only existing consumer is `NumberWidget` (updated in Task 4). Don't miss it — typecheck will catch it.
- **0-refetch budget still holds:** widgets remain keyed `["dashboard-widget", id, configHash]`; layout drags only touch `["dashboard", id]`. Nothing in D2 changes that.
- **recharts + sized parent:** `ResponsiveContainer` needs a parent with height. The grid tile body provides it (rgl row height × `h`). If a chart is invisible, that's the cause.
- **Deferred to a later slice:** Dropdown/People grouping (needs RPC array-unnest + member resolution), per-widget config _editing_ UI (D2 is add-only, like D1), and the List widget (D3).

```

```
