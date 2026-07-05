# shadcn Charts — Phase 2: Expressive restyle

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Depends on:** Phase 1 (shadcn chart primitives) — merged to `develop` (`c9d16c0`).
**Scope:** Visual restyle of `ChartWidget` only.

## Motivation

Phase 1 swapped `ChartWidget` onto shadcn's chart primitives while preserving the
old look. Phase 2 delivers the actual visual upgrade the user asked for — a
**bold, "expressive"** chart aesthetic — chosen deliberately over the codebase's
default monochromatic/Linear-restraint house style **for charts specifically**
(the user was shown that tension and picked the expressive direction).

Direction, palette, and motion were validated live in the brainstorm visual
companion. This spec encodes those decisions.

## Locked decisions (from the visual companion)

- **Aesthetic: "Direction C — bold spectrum", dark-first.** A confident
  indigo → violet → magenta gradient language.
- **Two palette modes:**
  - **Sequential / hero** — the spectrum gradient (`#4f46e5 → #7c3aed → #db2777`),
    used for a single generic series over ordered/date buckets. Applies as: a
    horizontal stroke gradient (line), an area fill gradient (area), and a
    vertical per-bar gradient (bar).
  - **Categorical** — a curated, distinct-but-cohesive palette assigned by series
    index: `['#6366f1' indigo (brand), '#22d3ee' cyan, '#a855f7' violet,
'#f59e0b' amber, '#fb7185' rose, '#34d399' emerald]`. Cycles if >6 series.
- **Motion: "Signature" (level 2).** Staggered bar/line rise with a soft
  overshoot, gradient draw-in, and a gently glowing active dot on hover. Plays
  **once on load** and on **hover** — never looping. Disabled under
  `prefers-reduced-motion`.

## Color-precedence rule (critical — never overwrite configured meaning)

Per series and per cell, color resolves in this strict order:

1. **Per-cell configured color** — `__color_<label>` on a pivot row (e.g. a
   status column's per-category red/green). **Keep it.**
2. **Per-series configured color** — a series' `seriesColor` that came from a
   status/dropdown/people column. **Keep it.**
3. **No configured color** — assign from our palette:
   - multiple series → **categorical** palette by index;
   - a single generic series with no per-cell colors → **spectrum hero** gradient.

Consequences by chart family:

- **Pie / donut / radial** — inherently categorical. Slices keep their per-cell
  configured color (rule 1); uncolored slices draw from the categorical palette.
  No spectrum hero here.
- **Line / area / bar (single generic series, no per-cell colors)** — spectrum
  hero gradient.
- **Bar grouped by a colored dimension (per-cell colors present)** — those colors
  win (rule 1); no gradient override.
- **Multi-series line/area/bar/combo** — categorical palette by index unless the
  series carries its own configured color (rule 2).

**How "configured vs fallback" is known:** today `pivotSeries` sets a single
series' color to the hardcoded `SOLO_COLOR` and multi-series colors to the
point's `seriesColor`. The resolver treats `SOLO_COLOR` (and the absence of a
`__color_<label>`) as "no configured color". Per-cell `__color_<label>` presence
means rule 1 applies. (If a future data path yields uncolored multi-series, the
resolver already handles it via the index-based categorical assignment.)

## Non-goals

- **No behavior/data changes.** Same chart types, same queries, same 0-refetch
  interaction model. Purely presentational + motion.
- **`HealthWidget` / `CompletionWidget` untouched** — plain-DOM progress bars,
  out of the lazy chart chunk; not Recharts. (Their percent bars could adopt the
  spectrum later — explicitly out of scope here.)
- **No interactive legend / series toggling** — deferred (was a Phase-2
  candidate; dropped to keep this focused on the visual language). Can be a
  Phase 3.
- **No new charting dependency**; stays on Recharts 3.8 + shadcn primitives.
- **No first-paint/bundle regression** — everything stays inside the existing
  `dynamic()` chart chunk (`ChartWidget` is the only importer).

## Architecture

Small, focused units so `ChartWidget` stays readable:

- **`chart-theme.ts` (modify)** — add `CATEGORICAL_PALETTE: string[]`,
  `SPECTRUM_STOPS` (ordered stops for the hero gradient), and any refined
  gridline/axis constants. Existing `AXIS_PROPS` / `GRID_STROKE` stay.
- **`chart-colors.ts` (new)** — the precedence resolver. Pure function:
  given `pivotSeries` output (`rows`, `series`) + chart type, returns a
  `ChartPaint` describing, per series and per cell, the resolved solid color or a
  gradient id, plus whether the spectrum hero applies. Unit-tested in isolation.
- **`ChartDefs.tsx` (new)** — renders the `<defs>` block a chart needs:
  per-series/per-cell `<linearGradient>`s (vertical for bars, area fill for
  areas, horizontal spectrum for lines) and the reusable glow `<filter>`.
  Gradient ids are deterministic (keyed by widget id + series key) so `fill` /
  `stroke` references resolve and multiple widgets on one dashboard don't collide.
- **`use-reduced-motion.ts` (new)** — `matchMedia('(prefers-reduced-motion:
reduce)')` hook (SSR-safe: defaults to "no reduce" until mounted). Gates
  `isAnimationActive`.
- **`ChartWidget.tsx` (modify)** — consume the resolver + `ChartDefs`; set
  gradient `fill`/`stroke`; add a custom `activeDot` (glow filter) on line/area;
  per-series `animationBegin` stagger, `animationDuration`, `animationEasing`;
  wrap the chart in the mount-overshoot CSS class (see Motion).
- **`chart-config.ts` (Phase 1, minor)** — `buildChartConfig` still feeds shadcn
  tooltip/legend labels+colors; it now receives resolved solid colors (for the
  legend/tooltip swatches) from the resolver so swatches match the marks. Where a
  series uses a gradient, its legend/tooltip swatch uses the gradient's mid/solid
  representative color.

## Motion — implementation and the one real risk

Recharts drives most of it natively, per series:
`isAnimationActive={!reducedMotion}`, `animationBegin` (stagger: `index * STEP`),
`animationDuration`, `animationEasing="ease-out"`. The hover glow is a custom
`activeDot` referencing the glow `<filter>`.

**Risk — overshoot easing.** Recharts' built-in easings (`ease`, `ease-in`,
`ease-out`, `ease-in-out`, `linear`) do **not** include a true overshoot/bounce.
Decision up front: keep the native rise on `ease-out`, and add the subtle
overshoot as a **CSS keyframe on the chart's mount wrapper** (the technique the
mockup used), guarded by reduced-motion. Verified in the TDD/verify step. If the
CSS overshoot visibly fights Recharts' own rise animation, we drop the overshoot
and ship the clean `ease-out` — still clearly "Signature". **Not a blocker.**

## Accessibility & performance

- **Reduce motion:** honored — static render, `isAnimationActive={false}`, mount
  CSS animation not applied.
- **Contrast / redundancy:** palette hues chosen for legibility on the dark
  surfaces; **color is never the only signal** — the shadcn legend + tooltip
  carry text labels (upholds the existing AA redundancy rule used across widgets).
- **Perf:** `<defs>`/gradients/filters are static and cheap; animation runs once
  (not looped); no extra data fetches; charts remain in the lazy chart chunk →
  no first-paint impact.

## Testing

- **`chart-colors.ts` unit tests** — all three precedence tiers; single generic
  series → spectrum hero; multi-series → categorical by index (and cycling >6);
  pie/donut/radial → categorical, never hero; per-cell colors preserved.
- **`use-reduced-motion.ts` unit test** — mocked `matchMedia` true/false.
- **`ChartWidget.test.tsx` (extend)** — per chart type: gradient `fill`/`stroke`
  ids present where expected; categorical colors applied to multi-series;
  configured per-cell colors preserved; glow `activeDot` present on line/area;
  `isAnimationActive` false when reduced-motion mocked true.
- **Full gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Manual / `verify` (for the finish handoff):** drive a real dashboard —
  spectrum hero on a single-series line/area; distinct categorical hues on a
  multi-series chart; status/people colors preserved; hover glow; the load
  animation; and `prefers-reduced-motion` renders static.

## Success criteria

1. Charts read as the bold "Direction C" language: spectrum hero for single/ordered
   series, distinct categorical hues for multi-series — with configured colors
   always preserved.
2. "Signature" motion on load + hover; static under reduce-motion.
3. No behavior/data change; no first-paint/bundle regression; Health/Completion
   widgets untouched.
4. All gates green; behavior verified in a real browser.

## Follow-ups (out of scope)

- Interactive legend (click-to-toggle series).
- Optionally extend the spectrum language to the Health/Completion percent bars.
