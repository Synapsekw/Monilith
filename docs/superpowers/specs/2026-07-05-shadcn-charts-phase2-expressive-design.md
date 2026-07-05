# shadcn Charts — Phase 2: Expressive restyle

**Date:** 2026-07-05
**Status:** Approved (brainstorm)
**Depends on:** Phase 1 (shadcn chart primitives) — merged to `develop` (`c9d16c0`).
**Scope:** `ChartWidget` visual restyle + a data-layer color-provenance change.

## Motivation

Phase 1 swapped `ChartWidget` onto shadcn's chart primitives while preserving the
old look. Phase 2 delivers the visual upgrade the user asked for — a **bold,
"expressive"** chart aesthetic — chosen deliberately over the codebase's default
monochromatic/Linear-restraint house style **for charts specifically**.

Direction, palette, and motion were validated live in the brainstorm visual
companion. A key principle emerged and governs this spec:

> **Color must encode meaning — never decoration.** A color only appears when it
> maps to something real: a value's configured semantic color, or (for a genuine
> multi-series split) which series is which. We do **not** fabricate distinct
> colors for a single metric.

## The problem this fixes (root cause in the data layer)

`widget-resolve.ts` currently **invents** a color for every series/bucket:

- `status` / `dropdown` → the option's **configured** color (`o.color`) — meaningful.
- `people` → `PALETTE[i % n]` — **invented** by index.
- `date` / anything uncolored → falls through to `?? PALETTE[i % n]` — **invented**.

So a single "count per month" bar chart gets each month a different fabricated
color — the textbook "color for nothing" (one metric, rainbow bars). We remove
the invention at the source and let the client apply color only where it means
something.

## Locked decisions (from the visual companion)

- **Aesthetic: "Direction C — bold spectrum", dark-first** — a confident
  indigo → violet → magenta gradient language.
- **Motion: "Signature" (level 2)** — staggered rise with a soft overshoot,
  gradient draw-in, gently glowing active dot on hover. Plays **once on load** and
  on **hover**, never loops, disabled under `prefers-reduced-motion`.

## Color model (the governing rule)

Colors resolve per mark as follows:

1. **Configured semantic color present** (a `status`/`dropdown` option you gave a
   color) → **use it**. Color carries that value's meaning.
2. **No configured color, single series** (e.g. count over time/`people`/`date`)
   → **one cohesive treatment**: the **spectrum-hero gradient**, identical for
   every bar / the whole line/area. No per-bucket variation — the axis already
   labels the buckets, so per-bar color would be pure decoration.
3. **No configured color, multiple series** (a real split whose dimension has no
   colors) → the **categorical palette by series index**. Here color _does_ encode
   information — which series is which — and the legend names them.

Per chart family:

- **Pie / donut / radial** — slices need distinct colors to be readable (no axis):
  configured slice colors win (rule 1); uncolored slices take the categorical
  palette by index (rule 3 semantics — differentiation is meaningful here).
- **Line / area / bar, single series** — configured per-cell colors win (rule 1);
  otherwise the spectrum hero (rule 2).
- **Line / area / bar / combo, multi series** — configured per-series colors win
  (rule 1); otherwise categorical palette by index (rule 3).

**How provenance is known:** the server stops inventing. `SeriesPoint.seriesColor`
becomes `string | null` — the configured color, or `null` when unconfigured
(`people`, `date`, colorless options). `null` flows through `pivotSeries`
unchanged (series color `null`; `__color_<label>` omitted/`null`). The client
resolver reads `null` as "no semantic color" and applies rule 2 or 3.

## Palette + gradient tokens

- **Categorical palette** — the approved hues as **theme-aware tokens**
  `--chart-cat-1…6` in `globals.css` (light + dark), assigned to the app's
  existing distinct hues: indigo (brand), cyan, violet, amber, rose, emerald.
  Cycles if a chart has >6 uncolored series.
- **Spectrum hero** — a fixed brand gradient (`#4f46e5 → #7c3aed → #db2777`)
  rendered as: horizontal stroke gradient (line), area fill gradient (area),
  vertical per-bar gradient (bar). Representative solid `#7c3aed` for the
  legend/tooltip swatch.
- **Gradient treatment applies on top of whatever solid color a mark resolves
  to** — configured colors are rendered as a top-lit vertical gradient (bars) /
  soft area fill (areas), not flattened away.

## Non-goals

- **No chart-type or query changes**; same 0-refetch interaction model. Only color
  provenance changes in the data layer.
- **`HealthWidget` / `CompletionWidget` untouched** — plain-DOM progress bars,
  out of the lazy chart chunk.
- **No interactive legend / series toggling** — deferred to a possible Phase 3.
- **No new charting dependency**; stays on Recharts 3.8 + shadcn primitives.
- **No first-paint/bundle regression** — client chart code stays inside the
  existing `dynamic()` chart chunk (`ChartWidget` is its only importer).
- **We do not auto-assign color to a single metric** — that's the whole point.

## Architecture

- **`widget-resolve.ts` (modify)** — `resolver()` returns `color: string | null`
  (`people` → `null`, no `PALETTE`); `seriesColor` drops the `?? PALETTE[i]`
  invention → `string | null`. Delete the now-unused `PALETTE` constant.
- **`series.ts` (modify)** — `SeriesPoint.seriesColor: string | null`;
  `PivotedSeries.series[].color: string | null`; `pivotSeries` carries `null`
  through and only writes `__color_<label>` when the color is non-null. The
  single-series synthetic series color becomes `null` (was `SOLO_COLOR`) — the
  "no semantic color" signal that triggers the hero. Remove `SOLO_COLOR`.
- **`globals.css` (modify)** — add `--chart-cat-1…6` (light + dark).
- **`chart-theme.ts` (modify)** — `CATEGORICAL_PALETTE` (the 6 token refs),
  `SPECTRUM_STOPS`, `SPECTRUM_SOLID`; keep `AXIS_PROPS`/`GRID_STROKE`.
- **`chart-colors.ts` (new)** — pure resolver. Given `pivotSeries` output +
  chart type + widget id, returns per-series/per-cell `{ solid, fillId, strokeId,
hero }` applying rules 1–3, plus deterministic gradient ids.
- **`ChartDefs.tsx` (new)** — renders the `<defs>` a chart needs: per-series/
  per-cell `<linearGradient>`s + the reusable glow `<filter>`; ids keyed by
  widget id + series key so multiple widgets don't collide.
- **`use-reduced-motion.ts` (new)** — SSR-safe `matchMedia` hook gating
  `isAnimationActive`.
- **`chart-config.ts` (modify)** — `buildChartConfig` consumes resolved solid
  colors so legend/tooltip swatches match the marks (gradient series use their
  representative solid).
- **`ChartWidget.tsx` (modify)** — consume the resolver + `ChartDefs`; gradient
  `fill`/`stroke`; glow `activeDot` on line/area; per-series `animationBegin`
  stagger + `animationDuration`/`animationEasing`; mount-overshoot wrapper.

## Motion — implementation and the one real risk

Native Recharts per series: `isAnimationActive={!reducedMotion}`,
`animationBegin` (stagger `index * STEP`), `animationDuration`,
`animationEasing="ease-out"`; custom `activeDot` referencing the glow filter.

**Risk — overshoot easing.** Recharts' built-in easings have no true
overshoot/bounce. Decision: keep the native rise on `ease-out` and add the subtle
overshoot as a **CSS keyframe on the chart's mount wrapper** (reduced-motion
guarded), verified in the TDD/verify step. If it fights Recharts' own rise, drop
the overshoot and ship clean `ease-out` — still clearly "Signature". Not a blocker.

## Accessibility & performance

- **Reduce motion** honored — static render, no animation, no mount keyframe.
- **Contrast / redundancy** — palette tokens legible on dark + light; color is
  never the only signal (legend + tooltip carry text labels — upholds the
  existing AA redundancy rule). Removing the single-metric rainbow _improves_
  clarity.
- **Perf** — `<defs>`/gradients/filters are static and cheap; animation runs once;
  no new fetches; charts stay in the lazy chart chunk → no first-paint impact.

## Testing

- **`widget-resolve` (extend/adjust)** — `people`/`date`/colorless → `null`
  seriesColor; configured `status`/`dropdown` → the option color. Update existing
  color assertions.
- **`series.test.ts` (adjust)** — single series → `series[].color === null`, no
  `__color_*` written for null; null carried through multi-series.
- **`chart-colors.ts` (new tests)** — rule 1/2/3 across families: configured wins;
  null single → hero; null multi → categorical by index (cycling >6);
  pie/donut/radial differentiate, never hero; configured per-cell preserved.
- **`use-reduced-motion.ts` (new test)** — mocked `matchMedia` true/false.
- **`ChartWidget.test.tsx` (extend)** — per type: gradient `fill`/`stroke` ids
  present; categorical applied to null multi-series; configured colors preserved;
  glow `activeDot` on line/area; `isAnimationActive` false when reduced-motion.
- **Full gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Manual / `verify`:** drive a real dashboard — single-series count-over-time is
  a uniform spectrum (no rainbow); status charts keep status colors; a colorless
  multi-series split gets distinct categorical hues; hover glow; load animation;
  `prefers-reduced-motion` static.

## Success criteria

1. Color encodes meaning everywhere: configured colors preserved; single metrics
   render as one cohesive spectrum (no fabricated rainbow); genuine multi-series
   differentiate via the categorical palette.
2. Bold "Direction C" gradient look + "Signature" motion on load/hover; static
   under reduce-motion.
3. No chart-type/query change; no first-paint/bundle regression; Health/Completion
   untouched.
4. All gates green; behavior verified in a real browser.

## Follow-ups (out of scope)

- Interactive legend (click-to-toggle series).
- Optionally let users assign colors to `people`/`date` dimensions if they want
  per-category color there.
