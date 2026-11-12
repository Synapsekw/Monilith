# Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make theme presets reach the whole app (Reach axis, gradient presets, theme-following
charts), fix chart widgets, enlarge page titles, and add Mono empty states and a done celebration.

**Architecture:** Reach is a third theme axis stamped on `<html>` as `data-theme-reach`, mirroring
the existing `data-theme-preset` plumbing end to end (inline no-flash script, localStorage, cached
profile read, sync component, hook, Server Action). All tinting is a derived CSS layer over the
existing preset seed tokens, so no component code changes to pick it up.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (`src/app/globals.css`), Supabase,
Vitest, recharts (dashboard widgets only).

**Spec:** `docs/superpowers/specs/2026-11-12-visual-refresh-design.md`

## Global Constraints

- Every task's implementer reads the target files before writing tests. Test code in this plan
  states intent and contracts; adapt selectors and fixtures to what the file actually contains.
- Implementers do NOT run `git add`, `git commit`, `git stash`, `git push`, `scripts/finish-task.sh`
  or any merge. The orchestrator commits by path after review.
- Run tests in the foreground with a 600000 ms timeout. Run only the test files your task touches
  plus `pnpm typecheck`; the orchestrator runs the full gates.
- Style with semantic tokens only. No raw Tailwind colours, no new dependencies.
- `src/types/database.types.ts` is generated. Never hand-edit it.
- User-facing copy says "Monolith", never "Pulse".
- Reach mixes use `color-mix(in srgb, …)` so `globals.contrast.test.ts` can reproduce them with a
  per-channel linear mix.
- `subtle` must resolve every derived token to today's production value.
- All motion is skipped under `prefers-reduced-motion` (handled globally in `globals.css`; new
  JS-driven motion checks `use-reduced-motion`).

## Shared contracts (names every task must use)

```ts
// src/lib/theme/presets.ts (T2 adds the reach block, T3 adds presets)
export const THEME_REACH_IDS = ["subtle", "tinted", "vivid"] as const;
export type ThemeReachId = (typeof THEME_REACH_IDS)[number];
export const DEFAULT_THEME_REACH: ThemeReachId = "tinted";
export const THEME_REACH_STORAGE_KEY = "monolith-theme-reach";
export const THEME_REACH_ATTR = "data-theme-reach";
export function isThemeReachId(v: unknown): v is ThemeReachId;
export function applyThemeReach(id: ThemeReachId): void; // removes the attr for the default
```

```css
/* globals.css — declared once in :root, never in a preset block */
--reach-content: 5%;  --reach-surface: 4%;  --reach-hover: 8%;  --reach-glow: 0;
[data-theme-reach="subtle"] { all four → 0 }
[data-theme-reach="vivid"]  { 9% / 7% / 13% / 1 }
--brand-2            /* SEED token: every preset block and :root/.dark declare it */
--brand-gradient: linear-gradient(90deg, var(--brand), var(--brand-2));
```

```ts
// DB (applied by the orchestrator before T1): profiles.theme_reach text, profiles.celebrate_done boolean
// src/lib/profile/queries-cached.ts
export async function getUserThemeReachCached(
  userId: string,
): Promise<ThemeReachId>;
export async function getUserCelebrateDoneCached(
  userId: string,
): Promise<boolean>;
// src/lib/profile/actions.ts
export async function updateProfileThemeReach(input: {
  themeReach: ThemeReachId;
}): Promise<ActionResult>;
export async function updateProfileCelebrateDone(input: {
  celebrateDone: boolean;
}): Promise<ActionResult>;
```

## File structure

| File                                                                                                                                                                                               | Task | Responsibility                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------- |
| `supabase/migrations/<minted>_profile_theme_reach.sql`                                                                                                                                             | T1   | Two additive columns              |
| `src/lib/validations/profile.ts`, `src/lib/profile/actions.ts`, `src/lib/profile/queries-cached.ts`                                                                                                | T1   | Boundary, write, cached read      |
| `src/lib/theme/presets.ts` (reach block), `src/app/globals.css` (reach layer), `src/app/globals.contrast.test.ts`, `src/app/globals.tokens.test.ts`                                                | T2   | Reach ids, CSS, AA matrix         |
| `src/app/globals.css` (preset blocks), `src/lib/theme/presets.ts` (entries), `src/lib/theme/presets.test.ts`                                                                                       | T3   | `--brand-2`, Aurora/Sunset/Nebula |
| `src/lib/theme/theme-preset-script.ts`, `src/components/theme-preset-sync.tsx`, `src/lib/theme/use-theme-reach.ts`, `src/components/settings/theme-reach-form.tsx`, preferences page, shell mounts | T4   | Reach plumbing and control        |
| `src/app/globals.css` (chart tokens), `chart-theme.ts` tests                                                                                                                                       | T5   | Chart ramp                        |
| `src/components/dashboards/widgets/ChartWidget.tsx` (+ legend)                                                                                                                                     | T6   | Pie/donut/radial fix, legends     |
| Shared page header + `BoardHeader.tsx`                                                                                                                                                             | T7   | Title scale                       |
| `src/components/brand/mono.tsx`, `src/components/ui/empty-state.tsx`, four pages                                                                                                                   | T8   | Mascot empty states               |
| `src/components/ui/done-burst.tsx`, `globals.css` (`pill-pop`), status cell, celebrate toggle                                                                                                      | T9   | Celebration                       |

## Execution DAG

- **Dependencies:** T3 ← T2. T4 ← T1, T2. T5 ← T3. T9 ← T1, T5. T6, T7, T8 ← none.
- **Batch 1 (parallel):** T1, T2, T6, T7, T8 — disjoint files.
- **Batch 2 (parallel):** T3, T4 — T3 owns `globals.css` + `presets.ts` preset entries; T4 must not edit either.
- **Batch 3:** T5.
- **Batch 4:** T9.
- **Critical path:** T2 → T3 → T5 → T9 (all edit `globals.css`).
- After each batch the orchestrator reviews, runs the four gates, and commits by path.

## Performance budget

First paint: 0 new requests (reach and celebrate ride cached profile reads; the inline script reads
localStorage). Switching reach: 0 round trips to repaint, 1 Server Action to persist. No hot-path
read added.

---

### Task 1: Profile preferences (boundary, write, cached read)

**Files:** Modify `src/lib/validations/profile.ts`, `src/lib/profile/actions.ts`,
`src/lib/profile/queries-cached.ts` and their existing test files.

**Interfaces:** Consumes the two columns (already applied and typed). Produces the four functions
in "Shared contracts" plus `updateProfileThemeReachSchema`, `updateProfileCelebrateDoneSchema`.
T1 declares `THEME_REACH_IDS` usage by importing from `@/lib/theme/presets`; because T2 adds that
export in the same batch, T1 defines the Zod enum from a local literal tuple
`["subtle","tinted","vivid"]` and leaves a one-line comment that it must equal `THEME_REACH_IDS`
(the orchestrator swaps the import after the batch).

- [ ] Read `updateProfileThemePreset` and `getUserThemePresetCached` and their tests; mirror them exactly (same auth, same `ActionResult`/`fail`, same `profileTag` invalidation).
- [ ] Write failing tests: schema rejects `"loud"` and accepts the three ids; action writes `theme_reach` and invalidates the profile tag; cached read narrows an unknown stored value to `"tinted"`; celebrate read defaults to `true` on a missing row.
- [ ] Run them, confirm they fail for the right reason, implement, confirm green, `pnpm typecheck`.

### Task 2: Reach tokens and contrast matrix

**Files:** Modify `src/lib/theme/presets.ts`, `src/app/globals.css`,
`src/app/globals.contrast.test.ts`, `src/app/globals.tokens.test.ts`, `src/lib/theme/presets.test.ts`.

**Interfaces:** Produces the reach ids block and the `--reach-*` CSS contract above.

- [ ] Add the reach exports to `presets.ts` (mirror `isThemePresetId` / `applyThemePreset`), with unit tests in `presets.test.ts`.
- [ ] In `globals.css` `:root`, declare the four `--reach-*` tokens at the Tinted values, then the `subtle` and `vivid` attribute blocks. Do not touch any preset block.
- [ ] Repoint the `@theme` aliases so utilities resolve through reach:
      `--color-content-surface: color-mix(in srgb, var(--brand) var(--reach-content), var(--content-surface))`;
      the same pattern with `--reach-surface` for `--color-surface`, `--color-surface-muted`, `--color-surface-sunken`, `--color-card`, `--color-popover`, `--color-muted`, `--color-accent`, `--color-secondary`;
      `--color-state-hover: color-mix(in srgb, var(--brand) var(--reach-hover), var(--state-hover))`.
      Grep for raw `var(--content-surface)` / `var(--surface` uses elsewhere in `globals.css` and route the visible ones through the same mix.
- [ ] Add the header glow: one `::before` on the content card class used by `app-shell.tsx` and `ask/layout.tsx`, `opacity: var(--reach-glow)`, two radial gradients from `--brand` and `var(--brand-2, var(--brand))`, `pointer-events:none`, hidden in the print block.
- [ ] Contrast test: add a `mixSrgb(a, b, pct)` helper and parameterize the existing text-on-surface checks over reach `[0, tinted, vivid]` for every selector. Write these FIRST and watch them fail (the mix helper does not exist). If any combination fails AA, lower that reach percentage until green and record the final numbers in a CSS comment.
- [ ] Token test: assert that with `data-theme-reach="subtle"` all four `--reach-*` values are `0`/`0%`.

### Task 3: Gradient presets

**Files:** Modify `src/app/globals.css` (preset blocks, `:root`, `.dark`), `src/lib/theme/presets.ts`
(`THEME_PRESET_IDS`, `THEME_PRESETS`, `ThemePreset.swatch` gains optional `accent2`),
`src/lib/theme/presets.test.ts` (`SEEDS`), `src/app/globals.contrast.test.ts`,
`src/components/settings/theme-preset-form.tsx` (swatch shows a gradient when `accent2` exists).

**Interfaces:** Consumes T2. Produces `--brand-2`, `--brand-gradient`, ids `aurora`, `sunset`, `nebula`.

- [ ] Add `--brand-2` to `SEEDS` in the test first; watch the "exactly the seed tokens" test fail for every block.
- [ ] Declare `--brand-2: var(--brand)`-equivalent literal in `:root`, `.dark` and all ten existing preset blocks (use each block's own brand hex), and derive `--brand-gradient` once in `:root`.
- [ ] Add the six new blocks. Dark seeds: Aurora `#5fd6c4`/`#9d8df7`, Sunset `#f7a45c`/`#ee6fa3`, Nebula `#b79cf7`/`#6fa8ee`. Copy the Forest block's recipe for surfaces/wash, re-tinted to each hue. Light brands are the same hues deepened until the contrast test passes.
- [ ] Contrast test: `--brand-foreground` clears 4.5:1 on `--brand-2` in every block.
- [ ] Apply the gradient in exactly four places: primary `Button` fill, active sidebar indicator, progress bars (`.bar`-style fills that use `bg-primary`), and `--chart-spectrum-*`. `--ring` stays `--brand`.
- [ ] `updateProfileThemePresetSchema` picks the new ids up automatically from `THEME_PRESET_IDS`; add a test asserting `"aurora"` parses.

### Task 4: Reach plumbing and Preferences control

**Files:** Modify `src/lib/theme/theme-preset-script.ts`, `src/components/theme-preset-sync.tsx`,
`src/components/shell/authenticated-shell.tsx`, `src/app/ask/layout.tsx`,
`src/app/(app)/settings/preferences/page.tsx`. Create `src/lib/theme/use-theme-reach.ts`,
`src/components/settings/theme-reach-form.tsx` and tests for each.

**Interfaces:** Consumes T1 functions and T2 exports. Must NOT edit `globals.css` or the preset
entries in `presets.ts`.

- [ ] Extend the inline script to also stamp `data-theme-reach` from `THEME_REACH_STORAGE_KEY`, whitelisted against `THEME_REACH_IDS`, writing no attribute for the default. Test by evaluating the script string in jsdom with each stored value, including an invalid one.
- [ ] `ThemePresetSync` takes a second promise prop `reach: Promise<ThemeReachId>` and applies + stores it; both shell mount points pass `getUserThemeReachCached(user.id)` unawaited.
- [ ] `useThemeReach(initial)` mirrors `useThemePreset`: synchronous attribute + localStorage write in the handler, then `updateProfileThemeReach`, rollback and error on failure.
- [ ] `ThemeReachForm`: a three-option radio group labelled "Subtle", "Tinted", "Vivid" with one-line descriptions, same fieldset/`aria-busy`/error pattern as `ThemePresetForm`. Add a `SettingRow` titled "Theme reach" under Theme.
- [ ] Add a second `SettingRow` "Celebrate completed items" with a `Switch` bound to `updateProfileCelebrateDone` (optimistic, rollback on failure).

### Task 5: Chart ramp

**Files:** Modify `src/app/globals.css` (chart tokens in `:root` and `.dark`), the chart colour tests.

- [ ] Test first: at Tinted, `--chart-1` contains `var(--brand)`; under `[data-theme-reach="subtle"]` the five greys are unchanged from today's literals.
- [ ] `--chart-1..5`: `--brand`, then mixes of `--brand-2` and `--brand` toward `--content-surface` at 72/50/32/18%. Keep today's greys inside the `subtle` block.
- [ ] `--chart-cat-1: var(--brand)`; `--chart-cat-2: color-mix(in srgb, var(--brand-2) 80%, var(--foreground))`; leave `cat-3..6`.

### Task 6: Chart widget fix and legends

**Files:** Modify `src/components/dashboards/widgets/ChartWidget.tsx` and its test; legend lives in
the same file or a sibling `ChartLegend.tsx`.

- [ ] Use `superpowers:systematic-debugging`. Reproduce the clipped wedge (pie, donut, radial render as a partial arc in the widget on the live dashboard "DAAS Launch Plan Overview"). Find the root cause before changing anything; record it in the task report.
- [ ] Failing test that encodes the cause, then the fix. Acceptance: full circle at the smallest grid size.
- [ ] Donut shows the total in the centre.
- [ ] Legend for pie, donut, radial and stacked bar: colour key, series name, value. Component test asserts each series renders a key with its colour and value.
- [ ] Keep `no-recharts-in-first-paint.test.ts` green.

### Task 7: Page title scale

**Files:** the shared page-header primitive (locate it: grep for the component that renders the
kicker + title on `/goals`, `/workload`, `/settings`), `src/components/boards/BoardHeader.tsx`,
dashboard and folder headers, and pages that hand-roll a title (`/my-work`, `/boards`, `/time`,
`/portfolios`, `/reports`).

- [ ] List every page title site in the task report before editing.
- [ ] Titles become `text-xl font-bold tracking-[-0.02em]`. Where a page hand-rolls its title, switch it to the shared primitive instead of restyling in place. Kickers unchanged.
- [ ] Update the header tests that assert classes; add one test on the primitive for the new scale.

### Task 8: Mono and empty states

**Files:** Create `src/components/brand/mono.tsx` (+ test). Modify `src/components/ui/empty-state.tsx`
(+ test) and the empty branches of Goals, Portfolios, My Time and Ask.

**Interfaces:** Produces `<Mono mood?: "idle" | "happy" size?: number className?: string />` and
`<EmptyState mascot? title? actions? />` (all optional; existing call sites unchanged).

- [ ] Read `src/components/landing/assembly-mono/avatar.js` for the mascot's geometry. `Mono` is a static inline SVG, server-renderable, `aria-hidden`, filled with `currentColor`/semantic tokens (`text-primary` eyes, `bg-surface-muted`-equivalent body via `fill-*` utilities).
- [ ] `EmptyState` with `mascot` lays out mascot left, title + children + actions right; without it, renders exactly as today (snapshot the existing output first).
- [ ] Each of the four pages: title states what will appear, one or two actions that ALREADY exist on that page. Do not add new features or queries.

### Task 9: Done celebration and pill pop

**Files:** Create `src/components/ui/done-burst.tsx` (+ test). Modify `globals.css` (`pill-pop`
keyframe + `--animate-pill-pop`), `src/app/globals.motion.test.ts`, the status cell renderer in
`src/components/boards/cells/`, and the shell provider that exposes `celebrateDone` to the client.

- [ ] Locate the existing "done" classifier used by the folder Command Center "Complete" metric. Reuse it. If it is server-only SQL, expose the same rule the client already has for the status option (report what you found before building).
- [ ] `fireDoneBurst(el: HTMLElement)`: at most 12 absolutely-positioned 7px squares, Web Animations API, 500 ms, removed on finish; no-op when reduced motion or `celebrateDone` is false. Test with a mocked `Element.prototype.animate`.
- [ ] Status cell: on an optimistic edit that moves not-done → done, call `fireDoneBurst`; on any status change add the `animate-pill-pop` class for one run.
- [ ] Motion test asserts the keyframe exists and only animates `transform`.

## Self-review

- Spec 4.1 → T2, T4. 4.2 → T3. 4.3 → T5. 4.4 → T6. 4.5 → T7. 4.6 → T8. 4.7 → T9. Section 5 → T1 + orchestrator migration. Section 9 (skill + ADR) → orchestrator at wrap-up.
- Names are consistent with "Shared contracts".
