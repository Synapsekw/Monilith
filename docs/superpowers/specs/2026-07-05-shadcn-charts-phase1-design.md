# shadcn Charts — Phase 1: adopt shadcn chart primitives in `ChartWidget`

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Scope:** Phase 1 of 2. Phase 2 (visual restyle) is a separate, later brainstorm.

## Problem / motivation

Dashboards render charts via Recharts. shadcn/ui "Charts" look more polished and
refined — but they are **not a different charting engine**: they are a thin set
of wrapper primitives (`ChartContainer`, `ChartConfig`, `ChartTooltipContent`,
`ChartLegendContent`) that sit on top of Recharts, which we already ship
(`recharts@^3.8.1`). The refined feel comes almost entirely from shadcn's
tooltip, legend, and color-token conventions.

This spec covers **Phase 1 only**: a mechanical swap to shadcn's primitives that
**preserves the current visual look**, gets us the refined tooltip/legend, and
lands as one tight, mergeable unit. A genuine visual restyle (gridlines, fills,
hover affordances, typography, interactive legend) is deferred to **Phase 2**,
which is much easier to design well against live charts than to guess now.

## Goal

Replace `ChartWidget`'s hand-rolled Recharts scaffolding (`ResponsiveContainer` +
raw `Tooltip`/`Legend`) with shadcn's chart primitives, keeping every chart type
looking the same or better, with no behavior change and no bundle regression.

## Non-goals (explicitly out of scope)

- **No visual restyle** — that is Phase 2 (its own brainstorm).
- **No new chart types** and no changes to which types exist.
- **No new dependency** — stays on Recharts 3.8.
- **`HealthWidget` and `CompletionWidget` are untouched.** They are deliberately
  plain-DOM (progress bars), statically imported specifically to stay _out_ of
  the lazy chart chunk. Migrating them to Recharts/shadcn would regress that
  decision. They are not "charts" for this work.
- No token-ification of the single-series accent color (see below) — that is a
  Phase-2 call.

## Current state

- `src/components/dashboards/widgets/ChartWidget.tsx` — the **only** true Recharts
  consumer. `"use client"`. Renders all chart types: `pie`, `donut`, `radial`,
  `line`, `area`, `combo`, `bar`, `stackedBar`, `groupedBar`. Uses
  `ResponsiveContainer`, raw `Tooltip {...TOOLTIP_STYLE}`, raw `Legend`.
- `src/components/dashboards/widgets/chart-theme.ts` — shared `AXIS_PROPS`,
  `TOOLTIP_STYLE`, `GRID_STROKE`, all reading Monolith CSS tokens.
- `src/lib/dashboards/series.ts` — `pivotSeries(data)` returns
  `{ rows, series: { key, color }[] }`. Multi-series: one numeric field per
  series label, each with a `color`. Single-series: a `Value` field plus a
  per-row `__color_<label>` for individual bar/slice coloring. Single-series
  accent falls back to `SOLO_COLOR = "#818cf8"`.
- `src/components/dashboards/DashboardWidget.tsx` — imports `ChartWidget` via
  `next/dynamic` (lazy chunk). Recharts lives in that chunk, not first paint.
- shadcn is configured (`components.json`, style `radix-nova`). `ui/chart.tsx`
  is **not** yet installed.

## Approach

### 1. Add `src/components/ui/chart.tsx`

The shadcn chart primitives — `ChartContainer`, `ChartConfig` (type),
`ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`.
Add via `npx shadcn@latest add chart` (or vendor manually to match our
`radix-nova` / import-alias setup). This file is **our copy** — we may patch it.

Because `ChartWidget` is the only importer and it is already `dynamic()`-loaded,
`ui/chart.tsx` and its Recharts usage stay inside the existing lazy chunk — **no
first-paint / bundle regression.** This is a hard constraint: `ui/chart.tsx` must
not be imported from any statically-loaded (first-paint) module.

### 2. `buildChartConfig(series)` helper

A small pure function mapping `pivotSeries`' `series: { key, color }[]` into
shadcn's `ChartConfig` shape (`Record<key, { label, color }>`). This is where
per-series colors flow into shadcn's `--color-<key>` CSS-var system that
`ChartTooltipContent` / `ChartLegendContent` read.

- Multi-series: one config entry per series key, `label = key`, `color = color`.
- Single-series: one entry for `Value`, `color = SOLO_COLOR` (`#818cf8`) — the
  **exact current color**, so the look is unchanged. (Token-ifying to
  `var(--brand)` is a Phase-2 decision.)
- Per-cell `__color_<label>` coloring (single-series bars/pie slices) is
  **unchanged** — those `<Cell fill=…>` values are set directly, independent of
  `ChartConfig`.

Location: a small module (e.g. `chart-config.ts` next to `chart-theme.ts`) so it
is unit-testable in isolation.

### 3. Rewrite `ChartWidget` render paths

For each chart type, keep the Recharts marks (`<Bar>`, `<Line>`, `<Area>`,
`<Pie>`, `<Cell>`, `<RadialBar>`, per-cell color logic, `stackId`, combo map,
etc.) exactly as they are. Change only the wrappers:

- `<ResponsiveContainer>` → `<ChartContainer config={buildChartConfig(series)}>`
  (shadcn's `ChartContainer` provides the responsive container internally).
- `<Tooltip {...TOOLTIP_STYLE} />` → `<ChartTooltip content={<ChartTooltipContent />} />`.
- `<Legend wrapperStyle={…} />` → `<ChartLegend content={<ChartLegendContent />} />`.

`chart-theme.ts` axis/grid tokens (`AXIS_PROPS`, `GRID_STROKE`) remain in use on
`<XAxis>`/`<YAxis>`/`<CartesianGrid>`. `TOOLTIP_STYLE` is superseded by
`ChartTooltipContent` and may be removed if no longer referenced.

## Primary risk & fallback

shadcn's `chart.tsx` was originally authored against **Recharts 2.x**; Recharts 3
changed some internal tooltip/legend payload shapes. Recent shadcn revisions
support v3, but we treat this as the **first thing to verify**, in the TDD red
step:

> Render one representative multi-series chart and assert `ChartTooltipContent`
> renders against our real `recharts@3.8` payload/data shape.

If the stock content component mismatches, the fix is a **small local patch to
our vendored `ui/chart.tsx`** — not a blocker, and **not** a Recharts downgrade.

## Testing

- **`buildChartConfig` unit tests** (new): colors and labels map correctly;
  single-series vs multi-series; empty series is safe.
- **`ChartWidget.test.tsx` (extend):** each chart type still renders its marks;
  `ChartTooltip` / `ChartLegend` present where expected (legend only when
  `series.length > 1`, matching current behavior); tooltip renders against the
  3.8 data shape (the risk check above).
- **Green gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Manual acceptance** (in the "How to test" handoff): open a dashboard with
  each chart type, hover to see the new tooltip, confirm legend + colors match
  the pre-migration look.

## Success criteria

1. Every chart type renders at least as well as today, with shadcn's tooltip and
   legend in place.
2. The look is preserved (no intentional visual change; Phase 2 owns restyle).
3. No bundle / first-paint regression — primitives stay in the lazy chart chunk;
   `HealthWidget` / `CompletionWidget` remain plain-DOM and untouched.
4. All gates green; behavior verified manually.

## Follow-up: Phase 2 (deferred)

A separate brainstorm, done **after Phase 1 merges**, iterating visually against
live charts (visual companion + `pulse-ui` skill): gridline/axis typography,
rounded/gradient fills, active-dot hovers, interactive legend (click to toggle
series), and token-ifying `SOLO_COLOR` to a Monolith accent.
