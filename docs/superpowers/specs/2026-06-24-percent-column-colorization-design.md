# Percent Column — Value-Based Colorization

**Date:** 2026-06-24
**Status:** Approved (design)

## Summary

The percent column already exists end-to-end: it stores a `0–100` value per item,
renders a `PercentBar`, shows the **average of children when a group/parent is
collapsed** (rollup), and supports footer aggregations (avg/min/max). The bar's fill
is currently a single flat color (`bg-primary`, muted for rollups).

This change adds **value-based colorization** to the bar's fill: red near `0`,
walking through orange/amber/lime to green near `100`, so completion level is legible
at a glance. Applied **always** (no opt-in toggle), to **both** leaf cells and the
collapsed-average (rollup) bar, colored identically.

This is the only change. Average-on-collapse already works and is untouched.

## Color scale — 5 even bands + a distinct "complete" step

| Value   | Band                 | Intent                |
| ------- | -------------------- | --------------------- |
| `0–19`  | red                  | behind / not started  |
| `20–39` | orange               |                       |
| `40–59` | amber                | mid                   |
| `60–79` | lime                 |                       |
| `80–99` | green                | on track              |
| `100`   | deep/saturated green | **complete** (reward) |

- **Fill only** carries the band color.
- **Track** stays `bg-muted` (neutral) so the bar still reads as a gauge.
- **Numeric `%` label** stays `text-muted-foreground` — colored small text hurts
  legibility, and the number already conveys the exact value.

## Design-system fit

Monolith is deliberately monochromatic + single-accent, so a red→green scale is an
intentional, calibrated data-viz signal — not a decorative rainbow. To stay inside
the system:

- Band colors are defined as **OKLCH design tokens in `globals.css`**
  (e.g. `--progress-band-red` … `--progress-band-complete`) with **light + dark
  variants**, not inline color literals. Dark mode tunes lightness/chroma so the bands
  read on the dark `--muted` track.
- Exact OKLCH values are dialed in at build time with the `pulse-ui` and
  `frontend-design` skills so the ramp is restrained and the steps are perceptually
  even.

## Implementation

1. **Helper — `src/lib/boards/percent-color.ts` (new).** Pure function
   `percentBandColor(percent: number): string` that clamps `0–100` and returns the
   Tailwind class wired to the band's CSS variable (e.g. an arbitrary-value utility backed by `--progress-<band>`).
   No side effects, no data access.
2. **Tokens — `src/app/globals.css`.** Add the six band variables under both the
   light and dark blocks.
3. **`PercentBar` — `src/components/boards/cells/index.tsx`.** Replace the fill's
   `bg-primary` / `bg-muted-foreground/50` with `percentBandColor(clamped)`. Both leaf
   cells (`PercentCell`) and rollups (`RollupCell`) already render through `PercentBar`,
   so both get colored automatically.
4. **`RollupCell` — `src/components/boards/RollupCell.tsx`.** Drop the now-unused
   `muted` prop on the percent case (the value's color is the distinction; rollup
   context comes from the collapsed parent row).

## Performance & data-fetching budget

- **First paint:** no change — same `PercentBar` render path, one extra pure function
  call per cell.
- **Interactions:** none introduced. No new server round-trips, no Server Actions, no
  refetch. Colorization is a pure client render derived from data already loaded.
- **Reads:** unchanged — no new queries, no schema change, no migration, no
  `database.types.ts` regen.

## Accessibility

Color is **redundant** with the always-visible numeric `%` label and the existing
`role="progressbar"` / `aria-valuenow`. Color-blind users still get the exact number;
the color is an enhancement, never the sole signal.

## Testing

- **Unit — `percent-color.test.ts`:** assert the correct band at every boundary
  (`0, 19, 20, 39, 40, 59, 60, 79, 80, 99, 100`) and that out-of-range input clamps.
- **Existing rollup/aggregation tests** already cover average-on-collapse and footer
  aggregation; behavior is unchanged, so they must stay green.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Files touched

- `src/lib/boards/percent-color.ts` (new) + `percent-color.test.ts` (new)
- `src/app/globals.css` (band tokens, light + dark)
- `src/components/boards/cells/index.tsx` (`PercentBar` fill)
- `src/components/boards/RollupCell.tsx` (remove `muted` on percent case)

## Out of scope

- Per-column opt-in toggle / settings field (always-on by decision → no migration).
- Changing thresholds per-column or custom palettes.
- Any change to how the collapsed average is computed.

## How to test (manual, after merge)

1. Pull `develop`. Open a board with a **percent** column (or add one via the
   column menu).
2. Set items to a spread of values — e.g. `10`, `35`, `55`, `70`, `95`, `100`.
   Each bar's fill should shift red → orange → amber → lime → green, with `100`
   a visibly deeper green.
3. Group the board and **collapse** a group (chevron): the parent's percent cell
   shows the **average**, colored by that average's band.
4. Toggle dark mode and confirm the bands still read clearly on the dark track.
