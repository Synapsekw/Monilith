# Percent Column Colorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color the percent column's progress-bar fill by its value (red near 0 → green near 100), on both per-item cells and the collapsed-average rollup.

**Architecture:** A pure helper maps a 0–100 value to one of six band classes, each backed by an OKLCH design token defined in `globals.css` (light + dark). `PercentBar` swaps its flat `bg-primary`/muted fill for the band class. Both leaf cells and rollups already render through `PercentBar`, so both pick up color from one change.

**Tech Stack:** Next.js 16, React, Tailwind v4 (`@theme inline` + CSS custom properties), Vitest + @testing-library/react.

## Global Constraints

- **TypeScript strict; no `any`.** Validate at boundaries; this feature has no new boundaries.
- **Server Components by default**, client only when interactive. These are existing client components — no change to that boundary.
- **No new server round-trips.** Colorization is a pure client render over data already loaded — no Server Actions, no refetch, no schema/migration, no `database.types.ts` regen.
- **Design system:** band colors are **OKLCH tokens in `globals.css`** with light + dark variants — never inline color literals. The ramp is a calibrated data-viz signal, harmonized with the existing `--status-*` palette.
- **Accessibility:** color stays **redundant** with the always-visible numeric `%` label and `aria-valuenow` — never the sole signal.
- **Commit identity:** author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>` (set by `start-task.sh`). Subjects lowercase after `type(scope):`; every commit gets a descriptive body + a `Co-Authored-By` trailer. Stage explicitly by path — never `git add -A`/`.`.
- **Done = all gates green** (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) AND branch merged to `develop` AND worktree removed (`scripts/finish-task.sh`).

## Setup (before Task 1)

This is non-trivial, multi-file work that touches `globals.css` — which has unrelated in-flight edits in the main checkout. Build in an isolated worktree off the latest `origin/develop`:

```bash
scripts/start-task.sh percent-color
```

Then re-root the session into it (subagent-driven work): `EnterWorktree({ path: ".claude/worktrees/percent-color" })`. All paths below are relative to the repo root inside that worktree.

## File Structure

- `src/lib/boards/percent-color.ts` — **new.** Pure `percentBandColor(percent)` helper. One responsibility: value → band class.
- `src/lib/boards/percent-color.test.ts` — **new.** Boundary + clamp unit tests.
- `src/app/globals.css` — **modify.** Add six `--progress-*` tokens under `:root` and `.dark`.
- `src/components/boards/cells/index.tsx` — **modify.** `PercentBar` (lines ~160–188): use the helper for fill; drop the `muted` prop.
- `src/components/boards/RollupCell.tsx` — **modify.** Percent case (line 42): drop the `muted` prop.

## Execution DAG

- **Task 1** (helper + tests) — no dependencies.
- **Task 2** (CSS tokens) — no dependencies.
- **Task 3** (wire `PercentBar` + `RollupCell`) — depends on **Task 1** (imports the helper) and **Task 2** (the classes reference its tokens; bars render correctly only once both exist).

**Parallel batches:**

- **Batch 1 (concurrent):** Task 1, Task 2 — independent, no shared files. Dispatch together.
- **Batch 2:** Task 3 — after Batch 1 merges.

**Critical path:** Task 1 (or 2) → Task 3.

---

### Task 1: `percentBandColor` helper

**Files:**

- Create: `src/lib/boards/percent-color.ts`
- Test: `src/lib/boards/percent-color.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `percentBandColor(percent: number): string` — returns a complete, literal Tailwind class string (e.g. `"bg-[var(--progress-red)]"`) selecting the fill band. Clamps input to `[0, 100]`. Bands: `0–19` red, `20–39` orange, `40–59` amber, `60–79` lime, `80–99` green, `100` complete. The returned strings MUST be full literals (so Tailwind's JIT scanner sees them) — never built by interpolation.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/percent-color.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { percentBandColor } from "./percent-color";

describe("percentBandColor", () => {
  it.each([
    [0, "bg-[var(--progress-red)]"],
    [19, "bg-[var(--progress-red)]"],
    [20, "bg-[var(--progress-orange)]"],
    [39, "bg-[var(--progress-orange)]"],
    [40, "bg-[var(--progress-amber)]"],
    [59, "bg-[var(--progress-amber)]"],
    [60, "bg-[var(--progress-lime)]"],
    [79, "bg-[var(--progress-lime)]"],
    [80, "bg-[var(--progress-green)]"],
    [99, "bg-[var(--progress-green)]"],
    [100, "bg-[var(--progress-complete)]"],
  ])("maps %i%% to its band", (value, expected) => {
    expect(percentBandColor(value)).toBe(expected);
  });

  it("clamps below 0 to the red band", () => {
    expect(percentBandColor(-10)).toBe("bg-[var(--progress-red)]");
  });

  it("clamps above 100 to the complete band", () => {
    expect(percentBandColor(150)).toBe("bg-[var(--progress-complete)]");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/boards/percent-color.test.ts`
Expected: FAIL — cannot resolve `./percent-color` / `percentBandColor` not defined.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/boards/percent-color.ts`:

```ts
/**
 * Map a 0–100 percent to its progress-bar fill band class.
 *
 * Six bands walk red → green so completion reads at a glance: 0–19 red,
 * 20–39 orange, 40–59 amber, 60–79 lime, 80–99 green, 100 a deeper
 * "complete" green. Each class is a full literal (Tailwind JIT must see it)
 * backed by an OKLCH token defined in globals.css (light + dark). Color is
 * redundant with the numeric label — never the sole signal.
 */
export function percentBandColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  if (p >= 100) return "bg-[var(--progress-complete)]";
  if (p >= 80) return "bg-[var(--progress-green)]";
  if (p >= 60) return "bg-[var(--progress-lime)]";
  if (p >= 40) return "bg-[var(--progress-amber)]";
  if (p >= 20) return "bg-[var(--progress-orange)]";
  return "bg-[var(--progress-red)]";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/boards/percent-color.test.ts`
Expected: PASS (13 assertions across the cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/percent-color.ts src/lib/boards/percent-color.test.ts
git commit -m "feat(boards): percent band color helper

Pure percentBandColor() mapping 0–100 to one of six fill-band classes
(red → green, with a distinct complete band at 100). Clamps out-of-range
input. Returns full literal Tailwind classes so the JIT scanner picks
them up. Tests cover every band boundary plus clamping.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: progress band OKLCH tokens

**Files:**

- Modify: `src/app/globals.css` (`:root` block ~lines 110–170; `.dark` block ~lines 172–246)

**Interfaces:**

- Consumes: nothing.
- Produces: six CSS custom properties — `--progress-red`, `--progress-orange`, `--progress-amber`, `--progress-lime`, `--progress-green`, `--progress-complete` — defined in both `:root` and `.dark`. Consumed by Task 3 via an arbitrary-value utility backed by `--progress-<band>`. No `@theme inline` entry is needed (arbitrary-value utilities resolve the vars directly).

There is no unit test for raw CSS variables; this task is verified by `pnpm build` (Step 3) and visually in Task 3's manual check. The values harmonize with the existing `--status-*` palette (same lightness/chroma family) and are perceptually-even across the red→green hue arc; the "complete" band is a deeper, more saturated green than the `80–99` green.

- [ ] **Step 1: Add the light-mode tokens**

In `src/app/globals.css`, inside the `:root` block, immediately after the `--status-*` block (after the `--status-teal` line, ~line 151), add:

```css
/* Progress band ramp — value-based percent-column fill (red → green).
     Harmonized with --status-* (same L/C family); --progress-complete is a
     deeper, more saturated green than --progress-green for the 100% reward. */
--progress-red: oklch(0.63 0.23 25);
--progress-orange: oklch(0.7 0.18 50);
--progress-amber: oklch(0.8 0.16 85);
--progress-lime: oklch(0.78 0.17 125);
--progress-green: oklch(0.72 0.17 150);
--progress-complete: oklch(0.62 0.19 152);
```

- [ ] **Step 2: Add the dark-mode tokens**

In the `.dark` block, immediately after the `--status-teal` line (~line 217), add (slightly lighter for contrast on the dark `--muted` track):

```css
/* Progress band ramp (dark) — lifted lightness to read on the dark track */
--progress-red: oklch(0.68 0.2 25);
--progress-orange: oklch(0.73 0.16 50);
--progress-amber: oklch(0.82 0.15 85);
--progress-lime: oklch(0.8 0.16 125);
--progress-green: oklch(0.76 0.16 150);
--progress-complete: oklch(0.68 0.18 152);
```

- [ ] **Step 3: Verify the build compiles the CSS**

Run: `pnpm build`
Expected: build succeeds (Tailwind parses `globals.css` without error). The tokens aren't referenced yet, so there's no visual change — this only confirms valid CSS.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(boards): progress band oklch tokens

Add --progress-red/orange/amber/lime/green/complete to :root and .dark,
harmonized with the --status-* palette. Dark variants lifted for contrast
on the dark track. Consumed by the percent-column fill in a follow-up.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: wire `PercentBar` and `RollupCell` to the band colors

**Files:**

- Modify: `src/components/boards/cells/index.tsx` (`PercentBar`, ~lines 154–188)
- Modify: `src/components/boards/RollupCell.tsx` (percent case, line 42)
- Test: `src/components/boards/cells/percent-bar.test.tsx` — **new**

**Interfaces:**

- Consumes: `percentBandColor` from `@/lib/boards/percent-color` (Task 1); `--progress-*` tokens (Task 2).
- Produces: `PercentBar` now takes only `{ percent: number }` (the `muted` prop is removed). Fill className is `` `absolute inset-y-0 left-0 rounded-full ${percentBandColor(clamped)}` ``.

- [ ] **Step 1: Confirm `PercentBar`'s only callers are `PercentCell` and `RollupCell`**

Run: `pnpm exec grep -rn "PercentBar" src` (or use the editor's search)
Expected: definition + export in `cells/index.tsx`, used in `PercentCell` (same file) and imported/used in `RollupCell.tsx`. If any other caller passes `muted`, update it too. (Per current code, only `RollupCell` passes `muted`.)

- [ ] **Step 2: Write the failing test**

Create `src/components/boards/cells/percent-bar.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PercentBar } from "./index";

function fill(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('[role="progressbar"]');
  const el = bar?.firstElementChild as HTMLElement | null;
  if (!el) throw new Error("fill element not found");
  return el;
}

describe("PercentBar", () => {
  it("colors a low value with the red band", () => {
    const { container } = render(<PercentBar percent={10} />);
    expect(fill(container).className).toContain("bg-[var(--progress-red)]");
  });

  it("colors a full value with the complete band", () => {
    const { container } = render(<PercentBar percent={100} />);
    expect(fill(container).className).toContain(
      "bg-[var(--progress-complete)]",
    );
  });

  it("sets the fill width to the clamped percent", () => {
    const { container } = render(<PercentBar percent={73} />);
    expect(fill(container).style.width).toBe("73%");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/boards/cells/percent-bar.test.tsx`
Expected: FAIL — the fill still uses `bg-primary`, so the band-class assertions fail.

- [ ] **Step 4: Update `PercentBar`**

In `src/components/boards/cells/index.tsx`:

Add the import near the other `@/lib/boards` imports at the top of the file:

```ts
import { percentBandColor } from "@/lib/boards/percent-color";
```

Replace the JSDoc sentence that mentions `muted` and the component. Change the doc line:

```
 * value and an averaged rollup read identically. Monochrome track; the brand
 * accent (`bg-primary`) earns the fill. `muted` dims it for the rollup variant.
```

to:

```
 * value and an averaged rollup read identically. Monochrome track; the fill
 * color comes from percentBandColor(value) — red near 0, green near 100.
```

Replace the component signature:

```tsx
export function PercentBar({
  percent,
  muted = false,
}: {
  percent: number;
  muted?: boolean;
}) {
```

with:

```tsx
export function PercentBar({ percent }: { percent: number }) {
```

Replace the fill span's className:

```tsx
<span
  className={`absolute inset-y-0 left-0 rounded-full ${muted ? "bg-muted-foreground/50" : "bg-primary"}`}
  style={{ width: `${clamped}%` }}
/>
```

with:

```tsx
<span
  className={`absolute inset-y-0 left-0 rounded-full ${percentBandColor(clamped)}`}
  style={{ width: `${clamped}%` }}
/>
```

- [ ] **Step 5: Update `RollupCell`**

In `src/components/boards/RollupCell.tsx`, change the percent case (line 42) from:

```tsx
    case "percent":
      return <PercentBar percent={result.average} muted />;
```

to:

```tsx
    case "percent":
      return <PercentBar percent={result.average} />;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/boards/cells/percent-bar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass. `typecheck` confirms no remaining `muted` references; the full `test` run confirms existing rollup/cells tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/RollupCell.tsx src/components/boards/cells/percent-bar.test.tsx
git commit -m "feat(boards): color percent bar by value

PercentBar fill now uses percentBandColor(value) instead of the flat
brand accent, so leaf cells and the collapsed-average rollup both read
red → green by completion. Drop the now-unused muted prop. Render tests
assert the band class and fill width.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Closeout

- [ ] Run `scripts/finish-task.sh` from inside the worktree (rebases onto latest `develop`, runs all gates against the merged state, merges `task/percent-color` → `develop`, pushes, removes the worktree, deletes the branch).
- [ ] Hand the user the "How to test this" walkthrough (from the spec's manual-test section): open a board with a percent column, set items to a spread (`10, 35, 55, 70, 95, 100`), confirm the fill walks red → green with a deeper green at 100; collapse a group and confirm the averaged parent cell is colored by its average; toggle dark mode and confirm legibility.

## Self-Review

- **Spec coverage:** 5 even bands + distinct 100 (Task 1 + Task 2 tokens) ✓; always-on, no toggle/migration (no settings task) ✓; leaf + rollup colored identically (Task 3, `muted` removed) ✓; OKLCH tokens light + dark (Task 2) ✓; fill-only, neutral track, muted label (Task 3 leaves track/label untouched) ✓; redundant-with-number a11y (label/aria untouched) ✓; helper boundary tests (Task 1) ✓; no schema/migration/refetch (Global Constraints) ✓.
- **Placeholder scan:** none — every code/CSS step is concrete.
- **Type consistency:** `percentBandColor(percent: number): string` is defined in Task 1 and consumed with that exact signature in Task 3; the six class literals match the six tokens added in Task 2; `PercentBar`'s post-change `{ percent: number }` signature is consistent across `PercentCell` (already passes only `percent`) and `RollupCell` (Task 3 Step 5 removes `muted`).
