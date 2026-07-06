# shadcn Charts — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap `ChartWidget`'s hand-rolled Recharts scaffolding for shadcn's chart primitives (tooltip/legend/container) while preserving the current visual look.

**Architecture:** shadcn "Charts" are wrapper components over Recharts (which we already ship). Vendor `ui/chart.tsx`, add a pure `buildChartConfig` helper that maps our per-series colors into shadcn's `ChartConfig`, then replace `ResponsiveContainer`/`Tooltip`/`Legend` in `ChartWidget` with `ChartContainer`/`ChartTooltip`/`ChartLegend`. Marks (`<Bar>`, `<Line>`, `<Pie>`, `<Cell>`, …) and per-cell coloring stay unchanged.

**Tech Stack:** Next.js 16, React, TypeScript (strict), Recharts 3.8, shadcn/ui (radix-nova), Vitest + Testing Library, Tailwind v4.

## Global Constraints

- Stay on `recharts@^3.8.1` — **no version change**, no new charting dependency.
- `ui/chart.tsx` must only be imported by `ChartWidget` (or other already-lazy consumers) — it must **not** reach any statically/first-paint-loaded module, so it stays inside the existing `dynamic()` chart chunk.
- `HealthWidget` and `CompletionWidget` are **not touched** — they stay plain-DOM and out of the chart chunk.
- Preserve the current look: single-series accent stays `SOLO_COLOR = "#818cf8"`; keep `chart-theme.ts` axis/grid tokens; legend shows only when `series.length > 1`.
- Commit identity is pinned by `start-task.sh` (`Danijel Jovanovic <info@synapse-solutions.ai>`). Commit subjects lowercase after `type(scope):`; every commit has a body + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Stage explicitly by path — never `git add -A`.
- Definition of done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## Execution DAG

- **Task 1** (vendor `ui/chart.tsx` + compat check) — no deps.
- **Task 2** (`buildChartConfig` helper) — no deps.
- **Task 3** (migrate `ChartWidget` + cleanup + full gate) — depends on Task 1 and Task 2.

Parallel batches: **Batch A = {Task 1, Task 2}** (independent, may run concurrently); **Batch B = {Task 3}**. Critical path: (Task 1 ∥ Task 2) → Task 3.

---

### Task 1: Vendor shadcn chart primitives + Recharts-3 compat check

Adds the shadcn chart wrapper file and locks the primary risk (shadcn `chart.tsx` was authored against Recharts 2; verify `ChartTooltipContent` renders against a Recharts-3-shaped payload).

**Files:**

- Create: `src/components/ui/chart.tsx` (via shadcn CLI)
- Test: `src/components/ui/chart.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces (exports other tasks rely on): `ChartContainer` (props: `config: ChartConfig`, `className?`, `children`), `ChartConfig` (type: `Record<string, { label?: React.ReactNode; color?: string; icon?: ... }>`), `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`.

- [ ] **Step 1: Generate the vendored primitives**

Run: `pnpm dlx shadcn@latest add chart --yes`
Expected: creates `src/components/ui/chart.tsx` exporting `ChartContainer`, `ChartConfig`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`. If the CLI is unavailable offline, vendor the file manually from https://ui.shadcn.com/docs/components/chart (same exports).

Confirm the file exists and its imports resolve:
Run: `pnpm typecheck`
Expected: PASS (no errors referencing `ui/chart.tsx`).

- [ ] **Step 2: Write the failing compat test**

This renders `ChartTooltipContent` directly with a Recharts-3-shaped active payload — the exact shape Recharts 3 passes to a Tooltip `content` component — and asserts it renders the series label and value. This is the risk check from the spec.

```tsx
// src/components/ui/chart.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const config: ChartConfig = {
  Ada: { label: "Ada", color: "#34d399" },
};

// Recharts 3 passes tooltip content this shape: active + payload[].
const payload = [
  {
    dataKey: "Ada",
    name: "Ada",
    value: 3,
    color: "#34d399",
    payload: { __label: "Done", Ada: 3 },
  },
];

describe("ChartTooltipContent (recharts 3 compat)", () => {
  it("renders label + value from a v3-shaped tooltip payload", () => {
    render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={payload as never} label="Done" />
      </ChartContainer>,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm test src/components/ui/chart.test.tsx`
Expected: PASS. If it FAILS (v3 payload mismatch), patch our vendored `src/components/ui/chart.tsx` minimally so `ChartTooltipContent` reads the v3 `payload` items correctly (do not downgrade Recharts). Re-run until PASS. This is the whole point of doing this task first.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/chart.tsx src/components/ui/chart.test.tsx
git commit -F - <<'EOF'
feat(ui): vendor shadcn chart primitives with recharts 3 compat check

Adds ui/chart.tsx (ChartContainer/ChartConfig/ChartTooltip[Content]/
ChartLegend[Content]) as our copy so we can patch it. A direct test renders
ChartTooltipContent against a Recharts-3-shaped tooltip payload to lock the
one compat risk before wiring it into ChartWidget.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `buildChartConfig` helper

Pure function mapping `pivotSeries`' `series` into shadcn's `ChartConfig`.

**Files:**

- Create: `src/components/dashboards/widgets/chart-config.ts`
- Test: `src/components/dashboards/widgets/chart-config.test.ts`

**Interfaces:**

- Consumes: `series: { key: string; color: string }[]` (the `series` field of `PivotedSeries` from `@/lib/dashboards/series`); `ChartConfig` type from `@/components/ui/chart`.
- Produces: `buildChartConfig(series: { key: string; color: string }[]): ChartConfig` — returns `{ [key]: { label: key, color } }` for each series entry; `{}` for empty input.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/dashboards/widgets/chart-config.test.ts
import { describe, expect, it } from "vitest";

import { buildChartConfig } from "@/components/dashboards/widgets/chart-config";

describe("buildChartConfig", () => {
  it("maps each series to a label + color entry", () => {
    const config = buildChartConfig([
      { key: "Ada", color: "#34d399" },
      { key: "Lin", color: "#6366f1" },
    ]);
    expect(config).toEqual({
      Ada: { label: "Ada", color: "#34d399" },
      Lin: { label: "Lin", color: "#6366f1" },
    });
  });

  it("maps the single synthetic Value series (preserving SOLO_COLOR)", () => {
    const config = buildChartConfig([{ key: "Value", color: "#818cf8" }]);
    expect(config).toEqual({ Value: { label: "Value", color: "#818cf8" } });
  });

  it("returns an empty config for no series", () => {
    expect(buildChartConfig([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/dashboards/widgets/chart-config.test.ts`
Expected: FAIL — `buildChartConfig` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/dashboards/widgets/chart-config.ts
import type { ChartConfig } from "@/components/ui/chart";

/**
 * Map pivoted series ({ key, color }) into shadcn's ChartConfig so
 * ChartTooltipContent / ChartLegendContent resolve per-series --color-<key>.
 * Labels default to the series key (matches the current Legend/Tooltip text).
 */
export function buildChartConfig(
  series: { key: string; color: string }[],
): ChartConfig {
  return Object.fromEntries(
    series.map((s) => [s.key, { label: s.key, color: s.color }]),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/dashboards/widgets/chart-config.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/widgets/chart-config.ts src/components/dashboards/widgets/chart-config.test.ts
git commit -F - <<'EOF'
feat(dashboards): add buildChartConfig helper for shadcn charts

Pure mapping from pivotSeries' { key, color }[] to shadcn's ChartConfig so
the tooltip/legend resolve per-series colors via --color-<key>. Labels
default to the series key, matching the current legend/tooltip text.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Migrate `ChartWidget` to shadcn primitives

Replace the wrappers in every chart branch; keep all marks and per-cell coloring. Remove `TOOLTIP_STYLE` if it ends up unused.

**Files:**

- Modify: `src/components/dashboards/widgets/ChartWidget.tsx`
- Modify: `src/components/dashboards/widgets/ChartWidget.test.tsx`
- Modify (only if `TOOLTIP_STYLE` becomes unused): `src/components/dashboards/widgets/chart-theme.ts`

**Interfaces:**

- Consumes: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent` from `@/components/ui/chart` (Task 1); `buildChartConfig` from `@/components/dashboards/widgets/chart-config` (Task 2); existing `pivotSeries` (`series`, `rows`), `AXIS_PROPS`, `GRID_STROKE`.
- Produces: nothing new (internal refactor of `ChartWidget`).

- [ ] **Step 1: Write the failing tests**

Extend `ChartWidget.test.tsx`. First, add an assertion that a **multi-series** chart makes `ChartContainer` inject the per-series `--color-*` CSS vars (proves `buildChartConfig` is wired). Second, keep a smoke render per chart type. Replace the file body's `describe` with:

```tsx
describe("ChartWidget", () => {
  it("renders a bar chart without crashing", () => {
    const { container } = render(
      <ChartWidget
        widget={
          {
            id: "w1",
            source_board_id: "b1",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c1" },
            },
          } as never
        }
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("wires series colors into the ChartContainer style block", () => {
    const { container } = render(
      <ChartWidget
        widget={
          {
            id: "w2",
            source_board_id: "b1",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c1" },
            },
          } as never
        }
      />,
    );
    // ChartContainer injects a <style> setting --color-<key> from the config.
    // Single-series -> the synthetic "Value" series carries SOLO_COLOR.
    expect(container.innerHTML).toContain("--color-Value");
    expect(container.innerHTML).toContain("#818cf8");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: the new "wires series colors" test FAILS (no `--color-Value` in output — `ChartContainer` not used yet). The smoke test may still pass.

- [ ] **Step 3: Migrate the component**

In `src/components/dashboards/widgets/ChartWidget.tsx`:

Update the imports — drop `Legend`, `ResponsiveContainer`, `Tooltip` from the `recharts` import; add the shadcn primitives, `buildChartConfig`, and drop `TOOLTIP_STYLE`:

```tsx
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { buildChartConfig } from "@/components/dashboards/widgets/chart-config";
import { useWidgetSeries } from "@/lib/dashboards/use-widget-series";
import { pivotSeries } from "@/lib/dashboards/series";
import {
  AXIS_PROPS,
  GRID_STROKE,
} from "@/components/dashboards/widgets/chart-theme";
import type { CacheWidget } from "@/lib/dashboards/cache";
```

Right after `const { rows, series } = pivotSeries(data);` add:

```tsx
const chartConfig = buildChartConfig(series);
```

Then, in **every** chart branch, replace the wrapper. `ChartContainer` renders its own responsive container, so drop `ResponsiveContainer`. Crucial: `ChartContainer` defaults to `aspect-video`; neutralize it so charts fill the widget height as they do today — pass `className="h-full w-full [&>div]:!aspect-auto"`.

- Wrapper pattern (apply to each branch):
  - `<ResponsiveContainer width="100%" height="100%">` → `<ChartContainer config={chartConfig} className="h-full w-full [&>div]:!aspect-auto">`
  - `<Tooltip {...TOOLTIP_STYLE} />` → `<ChartTooltip content={<ChartTooltipContent />} />`
  - `<Legend wrapperStyle={{ fontSize: 11 }} />` → `<ChartLegend content={<ChartLegendContent />} />`

Concretely, the pie branch becomes:

```tsx
if (ct === "pie" || ct === "donut") {
  return (
    <ChartContainer
      config={chartConfig}
      className="h-full w-full [&>div]:!aspect-auto"
    >
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
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
    </ChartContainer>
  );
}
```

The radial branch: same wrapper swap; `<ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />`; keep `RadialBarChart`/`RadialBar`/`Cell` as-is.

The line/area branch — keep `CartesianGrid`, `XAxis`, `YAxis` with `AXIS_PROPS`/`GRID_STROKE`; wrapper swap; tooltip swap; and:

```tsx
{
  series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;
}
```

The combo and bar-family branches: identical treatment — wrapper swap, `<ChartTooltip content={<ChartTooltipContent />} />`, and the `series.length > 1` legend guard now renders `<ChartLegend content={<ChartLegendContent />} />`. Keep every `<Bar>`/`<Line>`/`<Cell>`/`stackId`/`radius`/`comboMap` detail exactly as before.

- [ ] **Step 4: Run the ChartWidget tests**

Run: `pnpm test src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: PASS — both the smoke test and the `--color-Value` / `#818cf8` assertion.

Note: the existing `recharts` mock (stubs `ResponsiveContainer`) still applies because `ChartContainer` renders `ResponsiveContainer` internally. If jsdom errors on chart sizing, keep that mock as-is; do not add new mocks.

- [ ] **Step 5: Remove dead `TOOLTIP_STYLE` if unused**

Run: `pnpm exec grep -rn "TOOLTIP_STYLE" src` (or the Grep tool).
If the only remaining reference is its definition in `chart-theme.ts`, delete the `TOOLTIP_STYLE` export from `src/components/dashboards/widgets/chart-theme.ts` and update the file's doc comment. If it is referenced elsewhere, leave it.

- [ ] **Step 6: Full green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (Cold typecheck may transiently complain about `cacheLife` types until `build` generates `.next/types` — a known non-break; the combined chain resolves it.)

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboards/widgets/ChartWidget.tsx src/components/dashboards/widgets/ChartWidget.test.tsx src/components/dashboards/widgets/chart-theme.ts
git commit -F - <<'EOF'
refactor(dashboards): render ChartWidget with shadcn chart primitives

Swaps ResponsiveContainer/Tooltip/Legend for ChartContainer/ChartTooltip/
ChartLegend across every chart type, wiring per-series colors through
buildChartConfig. Marks, per-cell coloring, axis/grid tokens and the
single-series-only legend guard are unchanged, so the look is preserved.
ChartContainer's aspect-video default is neutralized so charts still fill
the widget height. Drops the now-unused TOOLTIP_STYLE.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Manual acceptance (for the finish-task handoff)

1. Pull `develop` after merge; `pnpm dev -p 3001`.
2. Open a dashboard that has each chart type (bar, stacked/grouped bar, line, area, combo, pie, donut, radial).
3. Hover each chart → confirm the shadcn tooltip appears (color swatch + label + value, aligned).
4. On multi-series charts confirm the legend renders and colors match the tooltip and marks.
5. Confirm charts fill their widget tiles (no aspect-ratio letterboxing) and colors match the pre-migration look.

## Self-review notes

- **Spec coverage:** vendor `ui/chart.tsx` (Task 1) ✓; `buildChartConfig` + preserve `#818cf8` (Task 2) ✓; wrapper swap across all 9 types, keep marks/theme, legend guard (Task 3) ✓; Recharts-3 risk as first TDD step (Task 1) ✓; lazy-chunk constraint (Global Constraints + only `ChartWidget` imports `ui/chart.tsx`) ✓; Health/Completion untouched (Global Constraints) ✓; tests + full gate (Task 3) ✓.
- **Type consistency:** `buildChartConfig(series: { key; color }[]): ChartConfig` used identically in Task 2 and Task 3; `ChartConfig`/primitive names match Task 1 exports.
