# shadcn Charts — Phase 2 (Expressive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ChartWidget` a bold "Direction C" spectrum look with Signature motion, while making color encode meaning — configured colors preserved, single metrics rendered as one cohesive spectrum, genuine multi-series differentiated by a categorical palette.

**Architecture:** Stop the data layer inventing colors (`seriesColor: string | null`); carry `null` through `pivotSeries`; a pure client resolver applies the color rules and hands `ChartWidget` gradient/solid paint + a `<ChartDefs>` gradient/filter block; Recharts drives Signature motion, gated by a reduced-motion hook.

**Tech Stack:** Next.js 16, React, TypeScript (strict), Recharts 3.8, shadcn/ui, Vitest + Testing Library, Tailwind v4, Supabase.

## Global Constraints

- Stay on `recharts@^3.8.1`; no new charting dependency.
- Client chart code (`chart-colors`, `ChartDefs`, `use-reduced-motion`, `ChartWidget`) must only be imported by `ChartWidget` (or already-lazy consumers) — stays in the existing `dynamic()` chart chunk. No first-paint regression.
- `HealthWidget` / `CompletionWidget` untouched.
- **Color encodes meaning:** configured `status`/`dropdown` colors always win; a single uncolored metric → one cohesive spectrum hero (no per-bucket rainbow); an uncolored multi-series split → categorical palette by series index.
- Categorical palette values: indigo `#6366f1`, cyan `#22d3ee`, violet `#a855f7`, amber `#f59e0b`, rose `#fb7185`, emerald `#34d399` (as `--chart-cat-1…6` tokens). Spectrum hero: `#4f46e5 → #7c3aed → #db2777`, representative solid `#7c3aed`.
- Motion "Signature": staggered native rise (`animationBegin = i * 90ms`, `animationDuration = 700ms`, `animationEasing="ease-out"`), glow active dot on hover, disabled under `prefers-reduced-motion`.
- Commit identity pinned by `start-task.sh`. Subjects lowercase after `type(scope):`; body + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Stage by path; never `git add -A`.
- Done = `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## Execution DAG

- **Task 1** (data layer: stop inventing color) — no deps.
- **Task 2** (`use-reduced-motion` hook) — no deps.
- **Task 3** (tokens + theme constants + `chart-colors` resolver) — depends on Task 1 (nullable series type).
- **Task 4** (`ChartDefs` gradient/filter component) — depends on Task 3 (gradient-id scheme).
- **Task 5** (integrate into `ChartWidget` + `chart-config` + motion) — depends on 1, 2, 3, 4.

Parallel batches: **A = {Task 1, Task 2}**, **B = {Task 3}**, **C = {Task 4}**, **D = {Task 5}**. Critical path: 1 → 3 → 4 → 5.

---

### Task 1: Data layer — stop inventing color

Make color provenance explicit: `seriesColor` is the configured color or `null`. Keep all consumers green with a temporary neutral fallback (`var(--brand)`); the expressive treatment lands in Task 5.

**Files:**

- Modify: `src/lib/dashboards/widget-resolve.ts`
- Modify: `src/lib/dashboards/series.ts`
- Modify: `src/components/dashboards/widgets/chart-config.ts`
- Modify: `src/components/dashboards/widgets/ChartWidget.tsx` (temporary null-safety only)
- Test: `src/lib/dashboards/series.test.ts` (adjust)

**Interfaces:**

- Produces: `SeriesPoint.seriesColor: string | null`; `PivotedSeries.series[].color: string | null`; `pivotSeries` writes `__color_<label>` only when the resolved color is non-null; single-series synthetic series color is `null` (no more `SOLO_COLOR`).

- [ ] **Step 1: Adjust `series.test.ts` to the null model**

Replace the single-series assertion block (currently expects `Value: 5`, `__color_Done`, and `color: "#818cf8"`). New expectations — an uncolored single series carries `null` and writes no `__color_*`; a colored one still does:

```ts
it("uses a null-colored single synthetic series when there is no split", () => {
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
        seriesColor: null,
        value: 5,
      },
    ],
  });
  expect(out.rows).toEqual([{ __label: "Done", Value: 5 }]);
  expect(out.series).toEqual([{ key: "Value", color: null }]);
});

it("keeps a configured per-cell color on a single series", () => {
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
  expect(out.series).toEqual([{ key: "Value", color: null }]);
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test src/lib/dashboards/series.test.ts`
Expected: FAIL (current code sets `#818cf8` and always writes `__color_*`).

- [ ] **Step 3: Update `series.ts`**

`SeriesPoint.seriesColor` → `string | null`. `PivotedSeries.series[].color` → `string | null`. Remove `SOLO_COLOR`. `pivotSeries`: only write `__color_<label>` when `p.seriesColor` is non-null; single-series synthetic series color is `null`.

```ts
export type SeriesPoint = {
  primaryKey: string | null;
  primaryLabel: string;
  seriesKey: string | null;
  seriesLabel: string | null;
  seriesColor: string | null;
  value: number;
};
// ... SeriesData unchanged ...

export type PivotRow = Record<string, string | number>;

export type PivotedSeries = {
  rows: PivotRow[];
  series: { key: string; color: string | null }[];
};

export function pivotSeries(data: SeriesData): PivotedSeries {
  const rowByPrimary = new Map<string, PivotRow>();
  const order: string[] = [];
  const seriesColor = new Map<string, string | null>();
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
      if (p.seriesColor != null)
        row[`__color_${p.primaryLabel}`] = p.seriesColor;
    }
  }

  const series = data.seriesKind
    ? seriesOrder.map((key) => ({ key, color: seriesColor.get(key) ?? null }))
    : [{ key: "Value", color: null }];

  return { rows: order.map((k) => rowByPrimary.get(k)!), series };
}
```

- [ ] **Step 4: Update `widget-resolve.ts` — stop inventing**

`resolver()`'s map value color becomes `string | null`; `people` entries get `color: null` (drop `PALETTE[i]`). The `seriesColor` line drops the `?? PALETTE[i % PALETTE.length]`. Delete the now-unused `PALETTE` constant.

- In `resolver()`, change the map type to `Map<string, { label: string; color: string | null }>` and the people branch to `color: null`:

```ts
(profiles ?? []).forEach((p) =>
  map.set(p.id, { label: p.full_name ?? "Member", color: null }),
);
```

- Replace the `seriesColor` assignment:

```ts
const seriesColor: string | null =
  (sk !== null ? seriesMap.get(sk!)?.color : primaryMap.get(pk ?? "")?.color) ??
  null;
```

- Delete the `const PALETTE = [ ... ];` block (lines defining `PALETTE`). Confirm no other reference remains:
  Run: `pnpm exec grep -rn "PALETTE" src/lib/dashboards/widget-resolve.ts` → only absence expected.

- [ ] **Step 5: Keep chart consumers green (temporary neutral)**

`chart-config.ts` — `buildChartConfig` now receives `color: string | null`; fall back to `var(--brand)` for the swatch:

```ts
export function buildChartConfig(
  series: { key: string; color: string | null }[],
): ChartConfig {
  return Object.fromEntries(
    series.map((s) => [
      s.key,
      { label: s.key, color: s.color ?? "var(--brand)" },
    ]),
  );
}
```

`ChartWidget.tsx` — everywhere a series/cell color feeds a `fill`/`stroke`, add `?? "var(--brand)"`. Concretely: the bar-family single-series `Cell` (`?? s.color` → `?? s.color ?? "var(--brand)"`), and each `<Line>/<Area>/<Bar>` `stroke={s.color}` / `fill={s.color}` → `{s.color ?? "var(--brand)"}`. (Pie/radial already use `?? "var(--brand)"`.) This is throwaway null-safety replaced in Task 5.

- [ ] **Step 6: Run the suite for touched areas**

Run: `pnpm test src/lib/dashboards/series.test.ts src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: PASS. Then `pnpm typecheck` → PASS (nullable threaded through).

If any other test asserts an invented color (people/date), update it to expect `null`. Find them:
Run (Grep tool): pattern `seriesColor` across `src/**/*.test.ts` and reconcile.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboards/widget-resolve.ts src/lib/dashboards/series.ts src/lib/dashboards/series.test.ts src/components/dashboards/widgets/chart-config.ts src/components/dashboards/widgets/ChartWidget.tsx
git commit -F - <<'EOF'
feat(dashboards): stop inventing chart colors (seriesColor nullable)

widget-resolve no longer fabricates a fallback color for people/date/colorless
dimensions — seriesColor is the configured color or null. pivotSeries carries
null through and omits __color_<label> when there is no color; the single-series
synthetic series is null (drops SOLO_COLOR). Consumers use a temporary var(--brand)
fallback; the expressive treatment (hero gradient / categorical palette) lands in
Phase 2's later tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: `use-reduced-motion` hook

**Files:**

- Create: `src/components/dashboards/widgets/use-reduced-motion.ts`
- Test: `src/components/dashboards/widgets/use-reduced-motion.test.tsx`

**Interfaces:**

- Produces: `useReducedMotion(): boolean` — `true` when the user prefers reduced motion. SSR-safe: returns `false` until mounted.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useReducedMotion } from "@/components/dashboards/widgets/use-reduced-motion";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("useReducedMotion", () => {
  it("returns true when the user prefers reduced motion", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when the user does not", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test src/components/dashboards/widgets/use-reduced-motion.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the user prefers reduced motion. SSR-safe: false until mounted. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm test src/components/dashboards/widgets/use-reduced-motion.test.tsx`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/widgets/use-reduced-motion.ts src/components/dashboards/widgets/use-reduced-motion.test.tsx
git commit -F - <<'EOF'
feat(dashboards): add useReducedMotion hook for chart animation gating

SSR-safe prefers-reduced-motion hook (false until mounted) used to disable the
Phase 2 chart animations when the OS requests reduced motion.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Tokens + theme constants + color resolver

**Files:**

- Modify: `src/app/globals.css` (add `--chart-cat-1…6`, light + dark)
- Modify: `src/components/dashboards/widgets/chart-theme.ts`
- Create: `src/components/dashboards/widgets/chart-colors.ts`
- Test: `src/components/dashboards/widgets/chart-colors.test.ts`

**Interfaces:**

- Consumes: `PivotedSeries` (`rows`, `series: { key; color: string | null }[]`) from Task 1.
- Produces:
  - `CATEGORICAL_PALETTE: readonly string[]`, `SPECTRUM_STOPS: readonly string[]`, `SPECTRUM_SOLID: string`, `CHART_MOTION` in `chart-theme.ts`.
  - `type Paint = { kind: "solid"; color: string } | { kind: "hero" }`
  - `type ChartColors = { series: { key: string; paint: Paint }[]; cells: { label: string; paint: Paint }[] | null }`
  - `resolveChartColors(args: { chartType: string; rows: PivotRow[]; series: { key: string; color: string | null }[] }): ChartColors`
  - `gradientId(widgetId: string, role: "bar" | "area" | "stroke", token: string): string`
  - `paintFill(widgetId, paint, role: "bar" | "area"): string` (returns `url(#id)`)
  - `paintStroke(widgetId, paint): string` (hero → `url(#…stroke)`, solid → the color)
  - `solidOf(paint): string` (representative solid; hero → `SPECTRUM_SOLID`)
  - `collectGradients(widgetId, colors, chartType): GradientSpec[]` for `ChartDefs`
  - `type GradientSpec = { id: string } & ({ kind: "bar" | "area"; color: string } | { kind: "hero-bar" | "hero-area" | "hero-stroke" })`

- [ ] **Step 1: Add palette tokens to `globals.css`**

In the light `:root` block (near the `--chart-1…5` group ~line 163) and again in the `.dark` block (~line 237), add:

```css
--chart-cat-1: #6366f1;
--chart-cat-2: #22d3ee;
--chart-cat-3: #a855f7;
--chart-cat-4: #f59e0b;
--chart-cat-5: #fb7185;
--chart-cat-6: #34d399;
```

(Same hues both themes — the approved values read on near-black and on white; dark-first, tune later if needed.) Optionally also register `--color-chart-cat-*` in the `@theme` map for Tailwind parity, mirroring the existing `--color-chart-*` lines — not required since we reference the raw vars in SVG.

- [ ] **Step 2: Add constants to `chart-theme.ts`**

Append:

```ts
/** Distinct-but-cohesive hues for genuinely uncolored multi-series (meaningful
 * differentiation — color encodes which series). Theme-aware tokens. */
export const CATEGORICAL_PALETTE = [
  "var(--chart-cat-1)",
  "var(--chart-cat-2)",
  "var(--chart-cat-3)",
  "var(--chart-cat-4)",
  "var(--chart-cat-5)",
  "var(--chart-cat-6)",
] as const;

/** Spectrum hero gradient for a single uncolored metric. */
export const SPECTRUM_STOPS = ["#4f46e5", "#7c3aed", "#db2777"] as const;
export const SPECTRUM_SOLID = "#7c3aed";

/** Signature motion. */
export const CHART_MOTION = { durationMs: 700, staggerMs: 90 } as const;
```

- [ ] **Step 3: Write the failing resolver test**

```ts
import { describe, expect, it } from "vitest";

import {
  resolveChartColors,
  gradientId,
  solidOf,
} from "@/components/dashboards/widgets/chart-colors";
import {
  CATEGORICAL_PALETTE,
  SPECTRUM_SOLID,
} from "@/components/dashboards/widgets/chart-theme";

describe("resolveChartColors", () => {
  it("single uncolored series → hero, no per-cell coloring", () => {
    const c = resolveChartColors({
      chartType: "line",
      rows: [{ __label: "Jan", Value: 3 }],
      series: [{ key: "Value", color: null }],
    });
    expect(c.series).toEqual([{ key: "Value", paint: { kind: "hero" } }]);
    expect(c.cells).toBeNull();
  });

  it("uncolored multi-series → categorical palette by index", () => {
    const c = resolveChartColors({
      chartType: "line",
      rows: [{ __label: "Jan", A: 1, B: 2 }],
      series: [
        { key: "A", color: null },
        { key: "B", color: null },
      ],
    });
    expect(c.series).toEqual([
      { key: "A", paint: { kind: "solid", color: CATEGORICAL_PALETTE[0] } },
      { key: "B", paint: { kind: "solid", color: CATEGORICAL_PALETTE[1] } },
    ]);
  });

  it("configured series colors win over the palette", () => {
    const c = resolveChartColors({
      chartType: "bar",
      rows: [{ __label: "x", A: 1, B: 2 }],
      series: [
        { key: "A", color: "#111111" },
        { key: "B", color: null },
      ],
    });
    expect(c.series[0].paint).toEqual({ kind: "solid", color: "#111111" });
    expect(c.series[1].paint).toEqual({
      kind: "solid",
      color: CATEGORICAL_PALETTE[1],
    });
  });

  it("single bar with per-cell colors → per-cell solids (no hero)", () => {
    const c = resolveChartColors({
      chartType: "bar",
      rows: [
        { __label: "Done", Value: 3, __color_Done: "#34d399" },
        { __label: "WIP", Value: 1, __color_WIP: "#f59e0b" },
      ],
      series: [{ key: "Value", color: null }],
    });
    expect(c.cells).toEqual([
      { label: "Done", paint: { kind: "solid", color: "#34d399" } },
      { label: "WIP", paint: { kind: "solid", color: "#f59e0b" } },
    ]);
  });

  it("single bar with NO per-cell colors → hero, cells null", () => {
    const c = resolveChartColors({
      chartType: "bar",
      rows: [
        { __label: "Jan", Value: 3 },
        { __label: "Feb", Value: 5 },
      ],
      series: [{ key: "Value", color: null }],
    });
    expect(c.cells).toBeNull();
    expect(c.series[0].paint).toEqual({ kind: "hero" });
  });

  it("pie always colors per-cell (categorical fallback), never hero", () => {
    const c = resolveChartColors({
      chartType: "pie",
      rows: [
        { __label: "A", Value: 1 },
        { __label: "B", Value: 2 },
      ],
      series: [{ key: "Value", color: null }],
    });
    expect(c.cells).toEqual([
      { label: "A", paint: { kind: "solid", color: CATEGORICAL_PALETTE[0] } },
      { label: "B", paint: { kind: "solid", color: CATEGORICAL_PALETTE[1] } },
    ]);
  });

  it("helpers: solidOf(hero) is the spectrum solid; gradientId is deterministic & id-safe", () => {
    expect(solidOf({ kind: "hero" })).toBe(SPECTRUM_SOLID);
    expect(solidOf({ kind: "solid", color: "#abc" })).toBe("#abc");
    const id = gradientId("w1", "bar", "var(--chart-cat-1)");
    expect(id).toBe(gradientId("w1", "bar", "var(--chart-cat-1)"));
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
```

- [ ] **Step 4: Run — expect fail**

Run: `pnpm test src/components/dashboards/widgets/chart-colors.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `chart-colors.ts`**

```ts
import type { PivotRow } from "@/lib/dashboards/series";
import {
  CATEGORICAL_PALETTE,
  SPECTRUM_SOLID,
} from "@/components/dashboards/widgets/chart-theme";

export type Paint = { kind: "solid"; color: string } | { kind: "hero" };

export type ChartColors = {
  series: { key: string; paint: Paint }[];
  cells: { label: string; paint: Paint }[] | null;
};

const CIRCULAR = new Set(["pie", "donut", "radial"]);

function cat(i: number): Paint {
  return {
    kind: "solid",
    color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length],
  };
}

export function resolveChartColors(args: {
  chartType: string;
  rows: PivotRow[];
  series: { key: string; color: string | null }[];
}): ChartColors {
  const { chartType, rows, series } = args;
  const multi = series.length > 1;

  const resolvedSeries = series.map((s, i) => ({
    key: s.key,
    paint: (s.color != null
      ? { kind: "solid", color: s.color }
      : multi
        ? cat(i)
        : { kind: "hero" }) as Paint,
  }));

  const cellColor = (label: string, row: PivotRow): string | undefined => {
    const v = row[`__color_${label}`];
    return typeof v === "string" ? v : undefined;
  };

  // Circular charts always color per slice (differentiation is meaningful).
  if (CIRCULAR.has(chartType)) {
    const cells = rows.map((r, i) => {
      const label = String(r.__label);
      const c = cellColor(label, r);
      return {
        label,
        paint: (c ? { kind: "solid", color: c } : cat(i)) as Paint,
      };
    });
    return { series: resolvedSeries, cells };
  }

  // Single-series bar: per-cell solids IF any configured color exists, else hero.
  if (!multi) {
    const anyCell = rows.some((r) => cellColor(String(r.__label), r) != null);
    if (anyCell) {
      const cells = rows.map((r) => {
        const label = String(r.__label);
        const c = cellColor(label, r);
        return {
          label,
          paint: (c ? { kind: "solid", color: c } : { kind: "hero" }) as Paint,
        };
      });
      return { series: resolvedSeries, cells };
    }
  }

  // Multi-series, or single-series with no per-cell colors → color by series.
  return { series: resolvedSeries, cells: null };
}

export function solidOf(paint: Paint): string {
  return paint.kind === "hero" ? SPECTRUM_SOLID : paint.color;
}

const slug = (s: string) =>
  s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export function gradientId(
  widgetId: string,
  role: "bar" | "area" | "stroke",
  token: string,
): string {
  return `g-${slug(widgetId)}-${role}-${slug(token)}`;
}

export function paintFill(
  widgetId: string,
  paint: Paint,
  role: "bar" | "area",
): string {
  const token = paint.kind === "hero" ? "hero" : paint.color;
  return `url(#${gradientId(widgetId, role, token)})`;
}

export function paintStroke(widgetId: string, paint: Paint): string {
  if (paint.kind === "hero")
    return `url(#${gradientId(widgetId, "stroke", "hero")})`;
  return paint.color;
}

export type GradientSpec = { id: string } & (
  | { kind: "bar" | "area"; color: string }
  | { kind: "hero-bar" | "hero-area" | "hero-stroke" }
);

/** Every gradient the chart's paints reference — deduped by id, for <ChartDefs>. */
export function collectGradients(
  widgetId: string,
  colors: ChartColors,
): GradientSpec[] {
  const byId = new Map<string, GradientSpec>();
  const add = (spec: GradientSpec) => {
    if (!byId.has(spec.id)) byId.set(spec.id, spec);
  };
  const paints: Paint[] = [
    ...colors.series.map((s) => s.paint),
    ...(colors.cells ?? []).map((c) => c.paint),
  ];
  for (const p of paints) {
    if (p.kind === "hero") {
      add({ id: gradientId(widgetId, "bar", "hero"), kind: "hero-bar" });
      add({ id: gradientId(widgetId, "area", "hero"), kind: "hero-area" });
      add({ id: gradientId(widgetId, "stroke", "hero"), kind: "hero-stroke" });
    } else {
      add({
        id: gradientId(widgetId, "bar", p.color),
        kind: "bar",
        color: p.color,
      });
      add({
        id: gradientId(widgetId, "area", p.color),
        kind: "area",
        color: p.color,
      });
    }
  }
  return [...byId.values()];
}
```

- [ ] **Step 6: Run — expect pass**

Run: `pnpm test src/components/dashboards/widgets/chart-colors.test.ts`
Expected: PASS (all cases). Then `pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/components/dashboards/widgets/chart-theme.ts src/components/dashboards/widgets/chart-colors.ts src/components/dashboards/widgets/chart-colors.test.ts
git commit -F - <<'EOF'
feat(dashboards): add chart color resolver + palette/spectrum tokens

Adds --chart-cat-1..6 theme tokens, CATEGORICAL_PALETTE/SPECTRUM constants, and
a pure resolveChartColors: configured colors win; a single uncolored metric →
hero; uncolored multi-series → categorical by index; circular charts always
differentiate per slice. Plus gradient-id + paint helpers for ChartDefs/marks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: `ChartDefs` gradient/filter component

**Files:**

- Create: `src/components/dashboards/widgets/ChartDefs.tsx`
- Test: `src/components/dashboards/widgets/ChartDefs.test.tsx`

**Interfaces:**

- Consumes: `GradientSpec[]` (Task 3), `SPECTRUM_STOPS` (Task 3).
- Produces: `<ChartDefs specs={…} glowId={…} />` — renders a `<defs>` containing every gradient plus one glow `<filter>`; `export const GLOW_ID = (widgetId) => \`glow-${…}\``.

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartDefs, glowId } from "@/components/dashboards/widgets/ChartDefs";

describe("ChartDefs", () => {
  it("renders a gradient per spec and a glow filter", () => {
    const { container } = render(
      <svg>
        <ChartDefs
          widgetId="w1"
          specs={[
            { id: "g-w1-bar-hero", kind: "hero-bar" },
            { id: "g-w1-bar-x", kind: "bar", color: "#34d399" },
          ]}
        />
      </svg>,
    );
    expect(container.querySelector("#g-w1-bar-hero")).not.toBeNull();
    expect(container.querySelector("#g-w1-bar-x")).not.toBeNull();
    expect(container.querySelector(`#${glowId("w1")}`)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test src/components/dashboards/widgets/ChartDefs.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ChartDefs.tsx`**

```tsx
import type { GradientSpec } from "@/components/dashboards/widgets/chart-colors";
import { SPECTRUM_STOPS } from "@/components/dashboards/widgets/chart-theme";

export const glowId = (widgetId: string) =>
  `glow-${widgetId.replace(/[^a-zA-Z0-9]+/g, "-")}`;

function SolidVertical({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.95} />
      <stop offset="100%" stopColor={color} stopOpacity={0.15} />
    </linearGradient>
  );
}

function SolidArea({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.5} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

function HeroVertical({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={SPECTRUM_STOPS[1]} stopOpacity={0.95} />
      <stop offset="100%" stopColor={SPECTRUM_STOPS[0]} stopOpacity={0.2} />
    </linearGradient>
  );
}

function HeroArea({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={SPECTRUM_STOPS[1]} stopOpacity={0.5} />
      <stop offset="100%" stopColor={SPECTRUM_STOPS[0]} stopOpacity={0} />
    </linearGradient>
  );
}

function HeroStroke({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stopColor={SPECTRUM_STOPS[0]} />
      <stop offset="50%" stopColor={SPECTRUM_STOPS[1]} />
      <stop offset="100%" stopColor={SPECTRUM_STOPS[2]} />
    </linearGradient>
  );
}

export function ChartDefs({
  widgetId,
  specs,
}: {
  widgetId: string;
  specs: GradientSpec[];
}) {
  return (
    <defs>
      {specs.map((s) => {
        if (s.kind === "bar")
          return <SolidVertical key={s.id} id={s.id} color={s.color} />;
        if (s.kind === "area")
          return <SolidArea key={s.id} id={s.id} color={s.color} />;
        if (s.kind === "hero-bar") return <HeroVertical key={s.id} id={s.id} />;
        if (s.kind === "hero-area") return <HeroArea key={s.id} id={s.id} />;
        return <HeroStroke key={s.id} id={s.id} />;
      })}
      <filter
        id={glowId(widgetId)}
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="2.5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm test src/components/dashboards/widgets/ChartDefs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/widgets/ChartDefs.tsx src/components/dashboards/widgets/ChartDefs.test.tsx
git commit -F - <<'EOF'
feat(dashboards): add ChartDefs gradient + glow-filter component

Renders the <defs> a chart needs — solid vertical/area gradients per resolved
color, the 3-stop spectrum hero gradients, and a reusable glow filter — from the
GradientSpec list produced by chart-colors. Ids are widget-scoped so multiple
widgets on a dashboard don't collide.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Integrate into `ChartWidget` (gradients, hero, categorical, glow, motion)

Replace Task 1's temporary fallbacks with the resolver, `ChartDefs`, gradient fills/strokes, glow active dot, and Signature motion. Ends with the full gate + a real-browser verify.

**Files:**

- Modify: `src/components/dashboards/widgets/ChartWidget.tsx`
- Modify: `src/components/dashboards/widgets/chart-config.ts`
- Modify: `src/components/dashboards/widgets/ChartWidget.test.tsx`

**Interfaces:**

- Consumes: `resolveChartColors`, `paintFill`, `paintStroke`, `solidOf`, `collectGradients` (Task 3); `ChartDefs`, `glowId` (Task 4); `useReducedMotion` (Task 2); `CHART_MOTION` (Task 3).

- [ ] **Step 1: Extend `ChartWidget.test.tsx`**

Add assertions (keep the existing smoke test). The single-series bar sample (`sample` in the test, `seriesColor` now must be `null` to model "uncolored") should render the hero gradient; assert the hero bar gradient id and glow filter appear. First update the sample's point to `seriesColor: null`, then:

```tsx
it("renders the spectrum hero gradient + glow defs for an uncolored single series", () => {
  const { container } = render(
    <ChartWidget
      widget={
        {
          id: "w9",
          source_board_id: "b1",
          config: {
            chartType: "bar",
            primary: { kind: "date", columnId: "c1" },
          },
        } as never
      }
    />,
  );
  // hero vertical bar gradient id (from chart-colors.gradientId) + glow filter
  expect(container.querySelector("#g-w9-bar-hero")).not.toBeNull();
  expect(container.querySelector("#glow-w9")).not.toBeNull();
});

it("disables animation under reduced motion", () => {
  // matchMedia stub returning matches:true (add alongside existing mocks)
  // then assert Recharts marks carry isAnimationActive=false via absence of the
  // animation class, OR spy — see note below.
});
```

Note on the reduced-motion assertion: rather than DOM-sniff Recharts internals, unit-cover the gating in `use-reduced-motion.test.tsx` (Task 2) and assert here only the defs/gradient wiring. Delete the placeholder `disables animation` test body and keep the gradient/glow assertions; reduced-motion behavior is verified in Task 2 + the manual verify. (This avoids asserting Recharts private DOM.)

The existing `sample` mock: change its single point `seriesColor: "#34d399"` → `seriesColor: null` so it models an uncolored single series (hero path). The Phase-1 "wires series colors into the ChartContainer style block" test asserted `--color-Value` / `#818cf8`; update it to assert the hero solid representative instead — `expect(container.innerHTML).toContain("#7c3aed")` (SPECTRUM_SOLID, via buildChartConfig swatch) — since `#818cf8` no longer exists.

- [ ] **Step 2: Run — expect fail**

Run: `pnpm test src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: FAIL on the new hero/glow assertions (and the updated style-block assertion) — gradients not wired yet.

- [ ] **Step 3: Rewrite `ChartWidget.tsx` to use the resolver**

Full replacement of the component body. Key points: compute `colors`, `gradients`, embed `<ChartDefs>` as the first child of each chart, use `paintFill`/`paintStroke`/`solidOf` for marks, custom `activeDot` glow on line/area, and per-series motion props gated by `useReducedMotion`.

```tsx
"use client";

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
import {
  collectGradients,
  paintFill,
  paintStroke,
  resolveChartColors,
  solidOf,
} from "@/components/dashboards/widgets/chart-colors";
import { ChartDefs, glowId } from "@/components/dashboards/widgets/ChartDefs";
import { useReducedMotion } from "@/components/dashboards/widgets/use-reduced-motion";
import { CHART_MOTION } from "@/components/dashboards/widgets/chart-theme";
import { useWidgetSeries } from "@/lib/dashboards/use-widget-series";
import { pivotSeries } from "@/lib/dashboards/series";
import {
  AXIS_PROPS,
  GRID_STROKE,
} from "@/components/dashboards/widgets/chart-theme";
import type { CacheWidget } from "@/lib/dashboards/cache";

const CHART_CLASS = "h-full w-full !aspect-auto";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
      {children}
    </div>
  );
}

export function ChartWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as Record<string, unknown>;
  const reduced = useReducedMotion();
  const { data, isLoading, isError } = useWidgetSeries(widget.id);

  if (!widget.source_board_id) return <Empty>Pick a source board</Empty>;
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data) return <Empty>Failed to load</Empty>;
  if (data.points.length === 0) return <Empty>No data yet</Empty>;

  const { rows, series } = pivotSeries(data);
  const ct = data.chartType;
  const wid = widget.id;
  const colors = resolveChartColors({ chartType: ct, rows, series });
  const gradients = collectGradients(wid, colors);
  const seriesPaint = new Map(colors.series.map((s) => [s.key, s.paint]));
  const chartConfig = buildChartConfig(
    colors.series.map((s) => ({ key: s.key, color: solidOf(s.paint) })),
  );
  const anim = {
    isAnimationActive: !reduced,
    animationDuration: CHART_MOTION.durationMs,
    animationEasing: "ease-out" as const,
  };
  const glow = { filter: `url(#${glowId(wid)})` };

  // ── circular charts ── (per-cell colors from resolver.cells)
  if (ct === "pie" || ct === "donut") {
    const cells = colors.cells ?? [];
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <PieChart>
          <ChartDefs widgetId={wid} specs={gradients} />
          <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
          <Pie
            data={rows}
            dataKey="Value"
            nameKey="__label"
            innerRadius={ct === "donut" ? "55%" : 0}
            outerRadius="80%"
            {...anim}
          >
            {cells.map((c) => (
              <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  if (ct === "radial") {
    const cells = colors.cells ?? [];
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <RadialBarChart data={rows} innerRadius="25%" outerRadius="95%">
          <ChartDefs widgetId={wid} specs={gradients} />
          <ChartTooltip content={<ChartTooltipContent nameKey="__label" />} />
          <RadialBar dataKey="Value" background {...anim}>
            {cells.map((c) => (
              <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
            ))}
          </RadialBar>
        </RadialBarChart>
      </ChartContainer>
    );
  }

  // ── line / area ──
  if (ct === "line" || ct === "area") {
    const Chart = ct === "line" ? LineChart : AreaChart;
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <Chart data={rows}>
          <ChartDefs widgetId={wid} specs={gradients} />
          <CartesianGrid
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? (
            <ChartLegend content={<ChartLegendContent />} />
          ) : null}
          {colors.series.map((s, i) => {
            const begin = i * CHART_MOTION.staggerMs;
            return ct === "line" ? (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={paintStroke(wid, s.paint)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, style: glow }}
                animationBegin={begin}
                {...anim}
              />
            ) : (
              <Area
                key={s.key}
                dataKey={s.key}
                stroke={paintStroke(wid, s.paint)}
                fill={paintFill(wid, s.paint, "area")}
                strokeWidth={2}
                activeDot={{ r: 4, style: glow }}
                animationBegin={begin}
                {...anim}
              />
            );
          })}
        </Chart>
      </ChartContainer>
    );
  }

  // ── combo (bar + line) ──
  if (ct === "combo") {
    const comboMap = (config.comboMap ?? {}) as Record<string, "bar" | "line">;
    return (
      <ChartContainer config={chartConfig} className={CHART_CLASS}>
        <ComposedChart data={rows}>
          <ChartDefs widgetId={wid} specs={gradients} />
          <CartesianGrid
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="__label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {series.length > 1 ? (
            <ChartLegend content={<ChartLegendContent />} />
          ) : null}
          {colors.series.map((s, i) => {
            const begin = i * CHART_MOTION.staggerMs;
            const asBar =
              (comboMap[s.key] ?? (i === 0 ? "bar" : "line")) === "bar";
            return asBar ? (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={paintFill(wid, s.paint, "bar")}
                radius={[4, 4, 0, 0]}
                animationBegin={begin}
                {...anim}
              />
            ) : (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={paintStroke(wid, s.paint)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, style: glow }}
                animationBegin={begin}
                {...anim}
              />
            );
          })}
        </ComposedChart>
      </ChartContainer>
    );
  }

  // ── bar family (bar / stackedBar / groupedBar) ──
  const stack = ct === "stackedBar";
  return (
    <ChartContainer config={chartConfig} className={CHART_CLASS}>
      <BarChart data={rows}>
        <ChartDefs widgetId={wid} specs={gradients} />
        <CartesianGrid
          stroke={GRID_STROKE}
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis dataKey="__label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={32} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 ? (
          <ChartLegend content={<ChartLegendContent />} />
        ) : null}
        {colors.series.map((s, i) => {
          const paint = seriesPaint.get(s.key)!;
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stack ? "a" : undefined}
              fill={paintFill(wid, paint, "bar")}
              radius={stack ? undefined : [4, 4, 0, 0]}
              animationBegin={i * CHART_MOTION.staggerMs}
              {...anim}
            >
              {colors.cells
                ? colors.cells.map((c) => (
                    <Cell key={c.label} fill={paintFill(wid, c.paint, "bar")} />
                  ))
                : null}
            </Bar>
          );
        })}
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 4: `chart-config.ts` — accept resolved solids (non-null)**

`buildChartConfig` now receives already-resolved solids (`solidOf` guarantees non-null), so simplify back to a `string` color (drop the `?? var(--brand)` from Task 1):

```ts
export function buildChartConfig(
  series: { key: string; color: string }[],
): ChartConfig {
  return Object.fromEntries(
    series.map((s) => [s.key, { label: s.key, color: s.color }]),
  );
}
```

- [ ] **Step 5: Run ChartWidget tests**

Run: `pnpm test src/components/dashboards/widgets/ChartWidget.test.tsx`
Expected: PASS (smoke, hero+glow defs, updated style-block assertion). Keep the existing `recharts` `ResponsiveContainer` mock.

- [ ] **Step 6: Full green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. (Cold typecheck `cacheLife` types resolve once `build` runs — known non-break.)

- [ ] **Step 7: Verify in a real browser (motion + fill can't be asserted in jsdom)**

Use the `verify` skill / dev server: open a dashboard and confirm — single-series count-over-time renders one uniform spectrum (no rainbow); a status chart keeps status colors; an uncolored multi-series split shows distinct categorical hues; hover shows the glow active dot + shadcn tooltip; the load animation plays and staggers; charts fill their tiles. Toggle OS "reduce motion" → static. If the mount overshoot is wanted and clean, add a guarded CSS keyframe on the `ChartContainer` wrapper; if it fights Recharts' rise, ship the ease-out rise as-is (spec-sanctioned).

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboards/widgets/ChartWidget.tsx src/components/dashboards/widgets/chart-config.ts src/components/dashboards/widgets/ChartWidget.test.tsx
git commit -F - <<'EOF'
feat(dashboards): expressive chart restyle — gradients, hero, motion

ChartWidget now paints via resolveChartColors + ChartDefs: gradient fills on
every mark, the spectrum hero for a single uncolored metric, the categorical
palette for uncolored multi-series, configured colors preserved, a glow active
dot on hover, and staggered Signature motion gated by prefers-reduced-motion.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Manual acceptance (finish-task handoff)

1. Pull `develop` after merge; `pnpm dev -p 3001`.
2. Open a dashboard with a **single-series count-over-time** chart → confirm it's one uniform spectrum gradient (no per-bar rainbow).
3. Open a **status/dropdown** chart → confirm your configured colors are preserved (now with a gradient sheen).
4. Open an **uncolored multi-series** split (e.g. group by a plain dropdown with no colors) → confirm distinct categorical hues + legend.
5. Hover any chart → glowing active dot + shadcn tooltip.
6. Reload → staggered rise/draw-in animation plays once.
7. Enable OS "Reduce motion" → charts render static.

## Self-review notes

- **Spec coverage:** stop-inventing data layer (T1) ✓; reduced-motion (T2) ✓; tokens+palette+spectrum+resolver rules 1–3 & families (T3) ✓; gradient/glow defs (T4) ✓; gradients+hero+categorical+glow+motion integration + gate + verify (T5) ✓; lazy-chunk + Health/Completion untouched (Global Constraints) ✓.
- **Type consistency:** `seriesColor: string | null` and `series[].color: string | null` threaded T1→T3; `Paint`/`ChartColors`/`gradientId`/`paintFill`/`paintStroke`/`solidOf`/`collectGradients` signatures identical across T3, T4, T5; `glowId` shared T4↔T5.
