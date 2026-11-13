# Visual Refresh — theme reach, gradient presets, charts, delight

**Date:** 2026-11-12
**Status:** Approved by owner 2026-11-12; built on `task/visual-refresh`
**Prototype:** https://claude.ai/artifact/25JaM6mKUJWoy8KWAJh8qF (theme lab, now/proposed tiles, delight demo)
**Earlier structural review:** https://claude.ai/artifact/JgTmDjhP8gTGhbQWZRb1rn

## 1. Problem

A review of the live deployment on 2026-11-12 (14+ screens, all six presets, dark and light)
found three things:

1. **Theme presets only repaint the frame.** A preset changes `--app-wash`, `--app-bloom` and
   `--brand`. The content card, where all work happens, is visually identical in every preset
   (`--content-surface` is `#0e110f` in Forest and `#12100e` in Ember). Picking a theme feels like
   it does nothing.
2. **The app has no personality.** The landing page has the block sculpture, the Mono mascot and
   motion. The app has five keyframes and no mascot, illustration or celebration.
3. **Several small surfaces are unfinished.** Pie, donut and radial dashboard widgets render as a
   clipped wedge with no total or legend. Bar legends have no colour keys. Page titles are about
   16 px, so nothing anchors a page. Empty states are one sentence on a blank screen.

## 2. Decisions (owner, 2026-11-12)

| #   | Decision                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- |
| 1   | Theme reach defaults to **Tinted**. Subtle and Vivid are selectable in Preferences.               |
| 2   | **Gradient presets** (Aurora, Sunset, Nebula) ship as opt-in presets. Keystone stays the default. |
| 3   | **Mono appears inside the app**, limited to empty states and the Ask page.                        |
| 4   | **Done celebration is on by default**, with an off switch in Preferences.                         |

Decisions 1 and 2 deliberately change two rules in the `pulse-ui` skill: "chrome is strictly
monochrome" and "one accent". Section 9 covers the rule update.

## 3. Scope

In scope, as nine independent units (section 7):

- Reach tokens and the Reach preference
- Three gradient presets
- Chart colours that follow the preset
- Pie/donut/radial rendering fix and legends
- Larger page titles
- Mono component and richer empty states on four pages
- Done celebration and status pill pop

Out of scope, each for a later spec:

- **Custom accent colour.** An arbitrary hex cannot be pre-verified by
  `globals.contrast.test.ts`. It needs a runtime contrast clamp, like `softPillText()` does for
  option colours. Shown in the prototype, not built here.
- **Daily ring.** It needs a "due today / done today" read, which belongs with the My Work rebuild.
- **Component polish**: item panel header, board group spine, needs-attention rows, list pages, ⌘K.
- **Structural work** from the first review: Home page, My Work rebuild, sidebar regroup.

## 4. Design

### 4.1 Reach

Reach is a third theme axis next to mode (light/dark) and preset. It is stamped on `<html>` as
`data-theme-reach="subtle" | "tinted" | "vivid"`.

- `subtle` is exactly today's look. No token differs from current production.
- `tinted` is the new default. An absent attribute means `tinted`.
- `vivid` is `tinted` plus a header glow and tinted group headers.

Reach never touches a preset's seed tokens. It adds a derived layer in `:root` / `.dark` only, so
every preset follows without new per-preset CSS:

| Derived token                                                              | Subtle | Tinted | Vivid |
| -------------------------------------------------------------------------- | ------ | ------ | ----- |
| `--reach-content`, dark (brand mixed into the content surface)             | 0%     | 5%     | 9%    |
| `--reach-content`, light                                                   | 0%     | 2.5%   | 2.5%  |
| `--reach-surface` (brand mixed into `surface`, `surface-muted`, `popover`) | 0%     | 4%     | 5%    |
| `--reach-hover` (brand mixed into `--state-hover`)                         | 0%     | 8%     | 8%    |
| `--reach-glow` (opacity of the content-card header glow)                   | 0      | 0      | 1     |

These are the shipped values. The first draft (content 5% / 9% in both modes, surface 7% and
hover 13% at Vivid) failed two guards and was lowered: muted-text AA on a hovered row inside a
raised surface, and the light chrome/card separation floor of 1.15:1. See decision-42.

The Tailwind colour aliases (`--color-content-surface`, `--color-surface`, …) are repointed at
`color-mix(in oklab, var(--brand) var(--reach-…), <seed>)`. Component code does not change: it
keeps using `bg-content-surface`, `bg-surface`, `hover:bg-accent`.

The binding constraint is that every check in `globals.contrast.test.ts` passes for every
preset × mode × reach. Mixes are written `color-mix(in srgb, <seed>, var(--brand) <pct>)` so the
test can reproduce them.

The header glow is one `::before` on the app-shell content card (`app-shell.tsx` and
`ask/layout.tsx`), two radial gradients from `--brand` and `--brand-2`, multiplied by
`--reach-glow`. It is decorative, `pointer-events: none`, and excluded from print styles.

Status and option pills are unaffected at every reach. Their colours carry meaning.

### 4.2 Gradient presets

A new seed token, `--brand-2`, joins the preset seed set. Single-accent presets declare it equal
to `--brand`. `--brand-gradient` is derived once: `linear-gradient(90deg, var(--brand), var(--brand-2))`.

| Preset | `--brand` (dark) | `--brand-2` (dark) |
| ------ | ---------------- | ------------------ |
| Aurora | `#5fd6c4`        | `#9d8df7`          |
| Sunset | `#f7a45c`        | `#ee6fa3`          |
| Nebula | `#b79cf7`        | `#6fa8ee`          |

Light-mode values are the same hues deepened until `--brand-foreground` clears AA on both stops.

The gradient is used in four places only: the primary button fill, the active sidebar indicator,
progress bars, and the chart spectrum. `--ring` and text links stay on `--brand`, because a focus
ring must be one predictable colour.

Adding these three follows the existing rule for presets: a `THEME_PRESETS` entry, both CSS
blocks, and a green contrast test. The contrast test gains one check: `--brand-foreground` on
`--brand-2`.

### 4.3 Chart colours

Current state: `--chart-1..5` are five greys. `--chart-cat-1..6` are six fixed hues that do not
follow the preset. `--chart-spectrum-1..3` already derive from `--brand`.

Change:

- `--chart-1..5` become a five-step ramp mixed from `--brand` and `--brand-2` toward the content
  surface, at `tinted` and `vivid`. At `subtle` they stay grey.
- `--chart-cat-1` becomes `var(--brand)` and `--chart-cat-2` becomes a `--brand-2` mix, so the
  first two series of any categorical chart match the theme. `cat-3..6` keep their fixed hues,
  because categorical series need distinct hues to be told apart.
- Charts whose series are statuses keep status colours.

### 4.4 Chart widget fixes

- **Pie, donut, radial** currently draw a clipped wedge in the dashboard widget
  (`ChartWidget.tsx`, `<Pie outerRadius="80%">` and `<RadialBarChart outerRadius="95%">`). The
  cause has not been investigated. The build task starts with `systematic-debugging`.
  Acceptance: a full circle renders at the smallest widget size the grid allows.
- **Donut** shows the total in the centre.
- **Legends** on pie, donut, radial and stacked bar show a colour key, the series name and its
  value.

### 4.5 Page titles

Page, board and dashboard titles move from about 16 px semibold to `text-xl` (20 px) bold with
`-0.02em` tracking, at the shared page-header primitive and `BoardHeader.tsx`. Kickers above them
are unchanged.

### 4.6 Mono and empty states

- A `<Mono mood="idle" | "happy" />` component in `src/components/brand/`: a static inline SVG,
  drawn from the landing mascot's geometry (`src/components/landing/assembly-mono/avatar.js`),
  filled with semantic tokens so it follows every preset. Server-renderable, no client JS.
- `<EmptyState>` gains optional `mascot`, `title` and `actions` props. Existing call sites are
  unchanged.
- Four pages adopt it: Goals, Portfolios, My Time, Ask. Each states what will appear and offers
  one or two actions that already exist on that page (for example "New goal", "Add row").

Mono never appears in tables, toolbars or dialogs.

### 4.7 Done celebration and pill pop

- **Done burst.** When an optimistic status edit moves an item from not-done to done, the row's
  status cell plays a 500 ms burst: at most 12 small squares in `--brand`, `--brand-2` and two
  status colours, animated with the Web Animations API and removed on finish. No new dependency.
  "Done" is decided by the same classifier the Command Center uses for its Complete metric. The
  plan's first task for this unit locates that classifier and reuses it; it does not define a
  second one.
- **Pill pop.** Any status pill whose value changes plays a 380 ms scale keyframe (`pill-pop`,
  `--ease-keystone`), declared in `globals.css` beside the existing keyframes.
- Both are skipped under `prefers-reduced-motion` and when the preference is off.

## 5. Data and persistence

One additive migration on `profiles`, minted with `scripts/new-migration.sh`:

- `theme_reach text not null default 'tinted'`, with a check constraint on the three values.
- `celebrate_done boolean not null default true`.

Both are per-user preferences next to the existing `theme_preset` column, covered by the existing
`profiles` RLS policies. No new policy, function or index. The DEV database serves live users, so
the migration is additive only, and existing users see Tinted on their next load.

Reach follows the preset's existing path end to end:

- Zod enum at the boundary (`src/lib/validations/profile.ts`), ids exported from
  `src/lib/theme/presets.ts`.
- The cached profile read (`src/lib/profile/queries-cached.ts`) returns reach and
  `celebrate_done` in the same select as the preset. No extra query.
- The inline no-flash script (`theme-preset-script.ts`) stamps reach from localStorage before
  hydration. `ThemePresetSync` reconciles with the account value.
- A Server Action persists a change, using `ActionResult` / `fail` from
  `src/lib/actions/result.ts`.

## 6. Performance and data-fetching budget

- **First paint:** no new requests. Reach and `celebrate_done` ride the existing cached profile
  read. The no-flash script reads localStorage synchronously, as it does for the preset today.
- **Switching preset or reach:** 0 round trips to repaint (attribute plus localStorage), then one
  Server Action to persist. No RSC re-run and no data refetch.
- **Hot-path reads:** none added. Nothing in this spec reads a growing table.
- **Runtime cost:** reach is `color-mix` in CSS custom properties. The done burst creates at most
  12 nodes for 500 ms. Mono is static SVG.

## 7. Independent units and execution DAG

| Task | Unit                                                             | Consumes | Produces                                              |
| ---- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| T1   | Profile prefs: migration, types, Zod, cached read, Server Action | —        | `theme_reach`, `celebrate_done` readable and writable |
| T2   | Reach tokens in `globals.css` + contrast test matrix             | —        | `[data-theme-reach]` CSS, `--reach-*`                 |
| T3   | Gradient presets: `--brand-2`, three presets, registry, tests    | T2       | `--brand-2`, `--brand-gradient`                       |
| T4   | Reach plumbing: script, sync, hook, Preferences UI               | T1, T2   | Working Reach control                                 |
| T5   | Chart ramp tokens                                                | T3       | Theme-following `--chart-*`                           |
| T6   | Chart widget fix and legends                                     | —        | Correct pie/donut/radial, keyed legends               |
| T7   | Page title scale                                                 | —        | Larger titles                                         |
| T8   | `<Mono>`, `<EmptyState>` props, four pages                       | —        | Mascot empty states                                   |
| T9   | Done burst, pill pop, celebrate toggle                           | T1, T5   | Celebration                                           |

**Dependency graph:** T3 ← T2. T4 ← T1, T2. T5 ← T3. T9 ← T1, T5. T6, T7, T8 depend on nothing.

**Parallel batches:**

- Batch 1: T1, T2, T6, T7, T8
- Batch 2: T3, T4
- Batch 3: T5
- Batch 4: T9

**Critical path:** T2 → T3 → T5 → T9. These four all edit `globals.css`, which is why they are
serial. Parallel tasks each get their own worktree off the task branch, and the orchestrator
merges them one at a time.

## 8. Testing

- `globals.contrast.test.ts` iterates preset × mode × reach, and adds the `--brand-2` foreground
  check.
- `presets.test.ts` accepts the new seed token and the three new presets.
- `globals.tokens.test.ts` asserts that `subtle` resolves every derived token to today's value.
- `globals.motion.test.ts` covers `pill-pop`.
- Unit tests for the reach script, hook and Zod schema. Component tests for the Preferences
  controls, `<Mono>`, `<EmptyState>` and the chart legend.
- Chart geometry and the tinted surfaces are verified in a real browser, because jsdom renders
  nothing: a static harness with the built CSS in Chromium, each preset × reach × mode,
  screenshots attached to the session note.
- All four gates pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 9. Rule and documentation updates

- `pulse-ui` skill: the core principle becomes "chrome is neutral at Subtle and takes a low brand
  tint at Tinted and Vivid; colour is still earned for actions and status". Add the reach axis,
  `--brand-2`, the four sanctioned gradient uses, and `<Mono>` to the primitives list.
- An ADR in `vault/decisions/` records the change to the monochrome and single-accent rules and
  the owner's four decisions.

## 10. Risks

- **Contrast at Vivid in light mode.** Tinted surfaces lower text contrast. The test matrix is the
  guard; Vivid values drop until it is green.
- **Existing users see a changed default.** Tinted becomes the look for everyone on next load.
  Subtle restores the old look in one click.
- **Gradient on the primary button.** Text must clear AA on both stops. Covered by the new check.
- **Unknown cause of the clipped charts.** T6 may be larger than it looks. It is independent, so
  it cannot block the rest.
