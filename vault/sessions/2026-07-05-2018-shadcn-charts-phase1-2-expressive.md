---
type: session
date: 2026-07-05-2018
branch: develop
trigger: wrapup
status: complete
tags: [session, dashboards, charts]
related: []
---

# shadcn charts: primitives swap (P1) + expressive restyle (P2)

## What changed

- **Phase 1 (merged `c9d16c0`):** swapped `ChartWidget` onto shadcn chart primitives
  (`ui/chart.tsx` = Recharts wrappers) — `ChartContainer`/`ChartTooltipContent`/`ChartLegendContent`
  - `buildChartConfig`. Look preserved; Recharts 3.8 unchanged (CLI shipped the v3-aware file).
- **Phase 2 (merged `66cc2f1`):** expressive "Direction C" restyle. New: `chart-colors.ts` (color
  resolver), `ChartDefs.tsx` (gradient + glow defs), `use-reduced-motion.ts`, `--chart-cat-1..6`
  tokens, spectrum + categorical palettes, Signature motion (staggered rise, glow active dot).
- **Data-layer change:** `widget-resolve.ts` + `series.ts` stop inventing color — `seriesColor`
  is now `string | null` (people/date/colorless → null); deleted `PALETTE`/`SOLO_COLOR`.
- Executed P2 via subagent-driven development (5 tasks, per-task review + fix loops + whole-branch
  review "ready to merge"). All gates green; visuals confirmed live in browser by the user.

## Why

User wanted "nicer, more polished" charts. Key realization: shadcn Charts are just Recharts wrappers,
so P1 was cheap. P2's governing principle (chosen over the monochrome house style, for charts only):
**color must encode meaning, never decoration** — so single metrics render as one spectrum (no
per-bucket rainbow), configured status colors are preserved, and only genuine multi-series get a
categorical palette.

## How to test (for the user)

1. Pull `develop`; open a dashboard (dev env) with chart widgets.
2. A single-series "count over time" chart → one uniform indigo→magenta spectrum (no rainbow bars).
3. A status/dropdown chart → your configured colors preserved (now with a gradient sheen).
4. An uncolored multi-series split → distinct categorical hues + legend.
5. Hover any chart → glowing active dot + shadcn tooltip. Reload → staggered rise animation.
6. OS "Reduce motion" on → charts render static.

## Open threads

- **Follow-up (perf, non-blocking):** `WidgetConfigSheet.tsx:19` statically imports `ChartWidget`,
  and `DashboardWidget.tsx:19` statically imports `WidgetConfigSheet` → the chart bundle (recharts +
  new modules) sits in the first-paint static graph despite `DashboardWidget`'s `dynamic()`. The
  `DashboardWidget.test.tsx:156` guard only greps its own source → false confidence. Fix: dynamic-
  import the preview in `WidgetConfigSheet` + extend the guard to the transitive path.
- **Minor:** `collectGradients` ignores `chartType` → over-generates a few unused `<defs>` (harmless).
- **Deferred (Phase 3 candidate):** interactive legend (click-to-toggle series).

## Next session entry point

Charts P1+P2 are on `develop`. Pick up the `WidgetConfigSheet` lazy-load follow-up (small, restores
the "no recharts in first paint" guarantee), or start the interactive-legend Phase 3.
