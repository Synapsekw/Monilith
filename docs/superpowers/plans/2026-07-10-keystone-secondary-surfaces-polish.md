# Keystone Secondary-Surface Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the bespoke Keystone layer (`<Kicker>` eyebrows, translucent `soft` chips, elevation-step surfaces with brightening hairlines, `card-lift` motion, accent-on-states) to the app's secondary surfaces, at the same depth the core surfaces got.

**Architecture:** Two thin shared primitives land first (Wave 0), then each surface cluster is built in its own worktree by parallel subagents (disjoint files) and shipped incrementally (Approach B). This plan covers **Wave 0 (Foundation)** and **Wave 1 (Board views)** in full detail; clusters 2–6 each get their own same-structured plan written just before their worktree starts, because their line-anchors shift as earlier clusters merge and each is an independently shippable subsystem.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (`@theme inline` tokens), shadcn primitives, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-keystone-secondary-surfaces-polish-design.md`

---

## Conventions for every task

- **TDD:** write the failing test first, watch it fail, implement the minimum, watch it pass, commit.
- **Assert semantics, not hex.** Tests assert token/utility classes (`text-kicker`, `bg-surface`, `rounded-sm`, `card-lift`) and behavior/roles — never raw color hex (brittle vs. token retunes). Rationale: spec §6 / reskin spec §9.
- **Commit identity** is pinned by `start-task.sh` (`Danijel Jovanovic <info@synapse-solutions.ai>`). Commit subjects are **lowercase** (commitlint `subject-case`).
- **Stage by path** — never `git add -A`.
- **Run in the worktree.** Each cluster runs `scripts/start-task.sh <name>` then builds inside `.claude/worktrees/<name>`; `EnterWorktree({ path: ".claude/worktrees/<name>" })` for subagent-driven work.
- **Gates before finish:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green, then `scripts/finish-task.sh`.

---

## File Structure

**Wave 0 (Foundation) — new files, no surface edits:**

- `src/components/ui/meta-chip.tsx` — mono `LABEL value` meta chip. One responsibility: render a static labelled value.
- `src/components/ui/meta-chip.test.tsx` — unit test.
- `src/components/ui/color-chip.tsx` — soft translucent chip for an **arbitrary hex**, wrapping `softPillText` (extracted from `boards/cells/index.tsx` `OptionPill`). One responsibility: render one arbitrary-color soft chip, AA-safe in both themes.
- `src/components/ui/color-chip.test.tsx` — unit test.
- `src/app/globals.css` — token-export audit only (add a missing `@theme` export **iff** one is missing; otherwise no change).

**Wave 1 (Board views) — modified surface files:**

- `src/components/boards/calendar/CalendarMonth.tsx`, `CalendarWeek.tsx`, `CalendarAgenda.tsx`, `EventBar.tsx` (+ existing tests)
- `src/components/boards/GanttBoard.tsx` (+ existing test)
- `src/components/boards/KanbanBoard.tsx` (+ existing test)

---

# Wave 0 — Foundation

**Worktree:** `scripts/start-task.sh keystone-foundation` → build in `.claude/worktrees/keystone-foundation`.

This wave is small and serial (two primitives + an audit). No surface files change.

### Task 0.1: `<MetaChip>` primitive

**Files:**

- Create: `src/components/ui/meta-chip.tsx`
- Test: `src/components/ui/meta-chip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/meta-chip.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaChip } from "./meta-chip";

describe("MetaChip", () => {
  it("renders an uppercased mono label and its value", () => {
    render(<MetaChip label="Due">Jul 14</MetaChip>);
    const label = screen.getByText("Due");
    // label carries the kicker recipe (mono + kicker color + uppercase)
    expect(label).toHaveClass("font-mono", "text-kicker", "uppercase");
    // value is rendered and readable
    expect(screen.getByText("Jul 14")).toBeInTheDocument();
  });

  it("applies the accent tone to the value when tone='accent'", () => {
    render(
      <MetaChip label="Status" tone="accent">
        Working
      </MetaChip>,
    );
    expect(screen.getByText("Working")).toHaveClass("text-primary");
  });

  it("merges a passed className onto the root", () => {
    const { container } = render(
      <MetaChip label="Owner" className="test-hook">
        Synapse
      </MetaChip>,
    );
    expect(container.firstChild).toHaveClass("test-hook");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/ui/meta-chip.test.tsx`
Expected: FAIL — `Failed to resolve import "./meta-chip"`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// src/components/ui/meta-chip.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Keystone meta chip — a mono `LABEL value` pair (e.g. `DUE Jul 14`,
 * `STATUS Working`). The label uses the shared kicker recipe (mono, uppercase,
 * `--kicker`); the value is foreground, or accent when `tone="accent"`. Static
 * and decorative — for panel/card metadata, not interactive controls.
 */
export function MetaChip({
  label,
  tone = "default",
  className,
  children,
}: {
  label: string;
  tone?: "default" | "accent";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 text-xs", className)}>
      <span className="text-kicker font-mono text-[10px] font-medium tracking-[0.1em] uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-medium",
          tone === "accent" ? "text-primary" : "text-foreground",
        )}
      >
        {children}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/ui/meta-chip.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/meta-chip.tsx src/components/ui/meta-chip.test.tsx
git commit -m "feat(ui): add MetaChip keystone meta-label primitive"
```

### Task 0.2: `<ColorChip>` primitive

Extracts the `OptionPill` pattern (`src/components/boards/cells/index.tsx:38–53`) into a reusable primitive: a soft translucent chip for an **arbitrary hex**, AA-safe in both themes via `softPillText`. Static base (no self-hover) — interactive call sites add `hover:-translate-y-px hover:brightness-110` themselves, matching `StatusPill`.

**Files:**

- Create: `src/components/ui/color-chip.tsx`
- Test: `src/components/ui/color-chip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/color-chip.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ColorChip } from "./color-chip";

describe("ColorChip", () => {
  it("renders children at the sanctioned chip geometry", () => {
    render(<ColorChip color="#8ea2eb">Sprint 24</ColorChip>);
    const chip = screen.getByText("Sprint 24");
    expect(chip).toHaveClass("rounded-sm", "text-xs");
  });

  it("carries per-theme AA-derived text colors as CSS custom properties", () => {
    render(<ColorChip color="#8ea2eb">Label</ColorChip>);
    const chip = screen.getByText("Label");
    // both --pill-fg-light and --pill-fg-dark are set from softPillText()
    expect(chip.style.getPropertyValue("--pill-fg-light")).toMatch(/^#/);
    expect(chip.style.getPropertyValue("--pill-fg-dark")).toMatch(/^#/);
    expect(chip.style.getPropertyValue("--pill")).toBe("#8ea2eb");
  });

  it("merges a passed className (so callers can opt into hover motion)", () => {
    render(
      <ColorChip color="#8ea2eb" className="hover:-translate-y-px">
        L
      </ColorChip>,
    );
    expect(screen.getByText("L")).toHaveClass("hover:-translate-y-px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/ui/color-chip.test.tsx`
Expected: FAIL — `Failed to resolve import "./color-chip"`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// src/components/ui/color-chip.tsx
import type { CSSProperties, ReactNode } from "react";
import { softPillText } from "@/components/boards/cells/soft-pill-color";
import { cn } from "@/lib/utils";

/**
 * Soft translucent chip for an arbitrary user hex — a 15% tint of `color` over
 * the surface, with text derived from that same color but contrast-clamped per
 * theme (see {@link softPillText}) so any hue clears WCAG AA in both modes. The
 * `--pill*` custom properties carry the fill + per-theme text; the `dark:`
 * variant picks the right text. Static base — interactive call sites add
 * `hover:-translate-y-px hover:brightness-110` via `className` (matches
 * `StatusPill`). This is the one sanctioned rendering of arbitrary option color.
 */
export function ColorChip({
  color,
  className,
  children,
}: {
  color: string;
  className?: string;
  children: ReactNode;
}) {
  const fg = softPillText(color);
  return (
    <span
      style={
        {
          "--pill": color,
          "--pill-fg-light": fg.light,
          "--pill-fg-dark": fg.dark,
        } as CSSProperties
      }
      className={cn(
        "ease-keystone inline-flex max-w-full items-center truncate rounded-sm bg-[color-mix(in_oklab,var(--pill)_15%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--pill-fg-light)] transition-[transform,filter] duration-300 dark:text-[color:var(--pill-fg-dark)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/ui/color-chip.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/color-chip.tsx src/components/ui/color-chip.test.tsx
git commit -m "feat(ui): add ColorChip arbitrary-hue soft-pill primitive"
```

> **Deferred cleanup (non-blocking, note for a later wave):** DRY `OptionPill` in
> `src/components/boards/cells/index.tsx` onto `<ColorChip>`. Not done in Wave 0 because the spec keeps
> Foundation to zero surface edits (clean rebase under every cluster). Do it in the cluster that next
> touches board cells, or as a standalone trivial edit.

### Task 0.3: Token-export audit

**Files:**

- Read: `src/app/globals.css`
- Modify (only if a needed export is missing): `src/app/globals.css`

- [ ] **Step 1: Verify the utility exports exist**

Run:

```bash
grep -nE -- "--color-kicker|--shadow-card|--shadow-panel|--color-border-hover|--color-border-bright|--radius-sm|--ease-keystone|\.card-lift" src/app/globals.css
```

Expected: every one of `text-kicker`, `shadow-card`, `shadow-panel`, `border-border-hover`, `border-border-bright`, `rounded-sm`, `ease-keystone`, and the `.card-lift` utility resolves to a definition. (Recon confirmed these are present — this step is a guard, not a change.)

- [ ] **Step 2: Build the per-surface fix-list (recon grep)**

Run:

```bash
grep -rnE "rounded-full|rounded-\[|shadow-sm|shadow-md|backgroundColor|uppercase tracking-wide" \
  src/components/boards/calendar src/components/boards/GanttBoard.tsx src/components/boards/KanbanBoard.tsx
```

Record hits — these are the concrete conversion sites for Wave 1. (No file change in this step.)

- [ ] **Step 3: Add a missing export only if Step 1 found a gap**

If (and only if) Step 1 showed a utility is consumed by the plan but not exported, add the `@theme inline` export line next to its siblings. If Step 1 was clean, **skip** — no commit.

- [ ] **Step 4: Commit (only if Step 3 changed a file)**

```bash
git add src/app/globals.css
git commit -m "chore(theme): export <utility> for keystone secondary surfaces"
```

### Task 0.4: Gate & finish Wave 0

- [ ] **Step 1: Run all gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Finish the task (merge to develop, remove worktree)**

Run: `scripts/finish-task.sh`
Expected: rebased onto latest `develop`, gates re-run on merged state, merged, branch + worktree removed.

---

# Wave 1 — Board views

**Depends on:** Wave 0 merged to `develop`.
**Worktree:** `scripts/start-task.sh keystone-board-views` (cut from the updated `develop`, so `<MetaChip>`/`<ColorChip>` are present) → `.claude/worktrees/keystone-board-views`.
**Concurrency:** Calendar, Gantt, Kanban touch disjoint files → build as **3 parallel subagents** (`superpowers:dispatching-parallel-agents`) inside the one worktree, then integrate + gate + finish serially.

Each surface applies the four cross-cutting moves (spec §4.1) plus its recon specifics. Below, each task gives a concrete TDD anchor test + an itemized implementation checklist keyed to recon line-refs. Line numbers are the pre-Wave-1 positions — re-grep if they've drifted.

### Task 1.1: Calendar

**Files:**

- Modify: `src/components/boards/calendar/CalendarMonth.tsx` (label ~`:59`), `CalendarWeek.tsx` (~`:57`), `CalendarAgenda.tsx` (~`:78`), `EventBar.tsx` (event chips ~`:112`, `:131–145`)
- Test: the calendar test file(s) under `src/components/boards/calendar/` (locate with `ls src/components/boards/calendar/*.test.tsx`); if none asserts the label/chip contract, add `EventBar.test.tsx`.

- [ ] **Step 1: Write the failing test** — assert the event chip renders via the soft `ColorChip` contract and day-of-week labels use the kicker recipe.

```tsx
// src/components/boards/calendar/EventBar.test.tsx  (create if absent)
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventBar } from "./EventBar";

// Use the minimal props EventBar needs — mirror an existing render in a sibling
// calendar test; the assertion is the chip geometry/vars, not exact layout.
describe("EventBar", () => {
  it("renders a soft translucent chip (not an inline solid fill)", () => {
    render(<EventBar /* …minimal event props with color="#8ea2eb"… */ />);
    const chip = screen.getByText(/* the event title */);
    // ColorChip contract: soft tint via --pill, sanctioned geometry
    expect(chip).toHaveClass("rounded-sm");
    expect(chip.style.getPropertyValue("--pill")).toBe("#8ea2eb");
    // no opaque inline background
    expect(chip.style.backgroundColor).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/calendar/EventBar.test.tsx`
Expected: FAIL — current `EventBar` sets `style={{ backgroundColor }}` (opaque), so `--pill` is unset and `backgroundColor` is non-empty.

- [ ] **Step 3: Implement the four moves in Calendar**

  1. **Labels → `<Kicker>`:** replace the hand-rolled `text-[10px] font-semibold uppercase` day/section labels at `CalendarMonth.tsx:59`, `CalendarWeek.tsx:57`, `CalendarAgenda.tsx:78` with `<Kicker>…</Kicker>` (import from `@/components/ui/kicker`).
  2. **Event chips → `<ColorChip>`:** in `EventBar.tsx`, replace the multi-day/solid branches (`~:112`, `:131–145`) that use `style={{ backgroundColor: color }}` with `<ColorChip color={color}>{title}</ColorChip>`. For the neutral (no-color) branch, keep `bg-surface-muted` but move to `rounded-sm` and add `border-border`.
  3. **Interactive states:** event chips are click-to-open → add `hover:-translate-y-px hover:brightness-110` via `ColorChip`'s `className`. Day cells get `hover:bg-surface-muted` + `border-border` → `hover:border-border-hover`.
  4. **Radius/shadow:** swap any `rounded-md` on chips/cells for `rounded-sm` (chips) / keep cells at the card radius; no `shadow-sm/md` on chips.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/boards/calendar/`
Expected: PASS (new + existing calendar tests green).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/calendar/
git commit -m "feat(ui): keystone-polish the calendar view (kicker labels + soft event chips)"
```

### Task 1.2: Gantt / Timeline

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (section headers ~`:611`, `:967`; task bars ~`:1050`)
- Test: existing `src/components/boards/GanttBoard.test.tsx` (or add an assertion for the header/bar contract).

- [ ] **Step 1: Write the failing test** — assert a section/column header uses the kicker recipe and task bars carry a keystone shadow token, not the generic `shadow-sm`.

```tsx
// add to src/components/boards/GanttBoard.test.tsx
it("renders section headers with the kicker recipe", () => {
  // render GanttBoard with a minimal board fixture (reuse the file's existing setup)
  // query a known section/column header label
  const header = screen.getByText(/* a column header label */);
  expect(header).toHaveClass("font-mono", "text-kicker", "uppercase");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/GanttBoard.test.tsx`
Expected: FAIL — headers are `text-[11px] font-semibold tracking-wide uppercase` (sans, no `text-kicker`).

- [ ] **Step 3: Implement the four moves in Gantt**

  1. **Labels → `<Kicker>`:** headers at `:611` and `:967`.
  2. **Task bars → soft status treatment:** at `~:1050`, where a bar carries an arbitrary option color use `<ColorChip>`-style vars (or `<ColorChip>` if the bar can host children); where it carries a status token use `statusToneClasses(color, "soft")`. Replace `rounded-md shadow-sm` → `rounded-sm shadow-card`.
  3. **Interactive states:** sticky-header hairlines `border`/`border-r` → add `hover:border-border-hover` where the header is a hover target; task bars are draggable → keep DnD handlers untouched, add `hover:brightness-110`.
  4. **Radius/shadow:** no generic `shadow-sm/md`; use `shadow-card`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/boards/GanttBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx
git commit -m "feat(ui): keystone-polish the gantt view (kicker headers + soft task bars)"
```

### Task 1.3: Kanban

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx` (label pill ~`:427`, count chip ~`:443`, column headers, cards)
- Test: existing `src/components/boards/KanbanBoard.test.tsx`.

- [ ] **Step 1: Write the failing test** — assert the count chip uses the sanctioned `rounded-sm` chip geometry (not `rounded-full`) and column headers use the kicker recipe.

```tsx
// add to src/components/boards/KanbanBoard.test.tsx
it("renders the column count chip at the sanctioned chip geometry", () => {
  // render KanbanBoard with a minimal fixture (reuse existing setup)
  const count = screen.getByText(/* the column item count, e.g. "3" */);
  expect(count).toHaveClass("rounded-sm");
  expect(count).not.toHaveClass("rounded-full");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/boards/KanbanBoard.test.tsx`
Expected: FAIL — count chip is `rounded-full px-2 py-0.5`.

- [ ] **Step 3: Implement the four moves in Kanban**

  1. **Labels → `<Kicker>`:** column headers.
  2. **Chips → primitives:** label/status row at `:427` (`pillTextColor(column.color)` + inline solid bg) → `<ColorChip color={column.color}>`; count chip at `:443` `rounded-full` → `rounded-sm` (keep `bg-accent`).
  3. **Cards → `card-lift`:** replace the ad-hoc `transition` on cards with the `.card-lift` utility + `border-border` → `hover:border-border-hover`. Keep all DnD sensors/handlers untouched.
  4. **Radius/shadow:** cards keep `shadow-card`; no `rounded-full` on chips.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/boards/KanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/KanbanBoard.tsx src/components/boards/KanbanBoard.test.tsx
git commit -m "feat(ui): keystone-polish the kanban view (kicker headers + soft label chips + card-lift)"
```

### Task 1.4: Integrate, smoke-check, finish Wave 1

- [ ] **Step 1: Run all gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Visual smoke-check both themes**

Open the running app on a board, switch to **Calendar**, **Timeline/Gantt**, **Kanban** in **dark** then **light**. Confirm: mono kicker labels, soft translucent event/label chips (no opaque solids), `card-lift` on kanban cards, `rounded-sm` count chip, no layout breakage.

- [ ] **Step 3: Finish the task**

Run: `scripts/finish-task.sh`
Expected: rebased onto latest `develop`, gates green on merged state, merged, worktree + branch removed.

- [ ] **Step 4: Hand the user a "How to test this" walkthrough** (AGENTS.md working agreement #1) — numbered, per-view, both themes.

---

# Wave 2 — Dashboards

**Depends on:** Wave 0 + Wave 1 merged to `develop`.
**Worktree:** `scripts/start-task.sh keystone-dashboards` → `.claude/worktrees/keystone-dashboards`.
**Recon (2026-07-10, against post-Wave-1 `develop`):** reshaped the wave. Of the three named surfaces, **dashboards-nav has zero valid Keystone chrome** (its section title is delegated to the shared `<NavSection>` — shell scope; spec §4.2's "`DashboardsNav.tsx:139` avatar tiles" is a single-initial **avatar glyph**, a decorative preserve, not a Kicker). **Canvas** reduces to one skeleton line that must mirror the widget card. All real work is in **widgets**. Two file-disjoint parallel subagents; nav is a documented no-op.

**Preserve (data, not chrome — do NOT touch):** every `chart-*` fill/stroke/gradient (`ChartWidget`, `ChartDefs`, `chart-colors/config/theme`), the `NumberWidget` gauge `<circle>` metric arc, `BatteryWidget`/`CompletionWidget`/`HealthWidget` meter bars + `percentBandColor` fills, all `size-1.5/2/2.5 rounded-*` decorative/option-color dots (incl. `DashboardWidget:58` brand dot, `WidgetConfigForm:622` option swatch). Never touch RGL drag/resize config, `onMouseDown`-stopPropagation handlers, or any mutation/data flow.

### Task 2.1: Widget card + canvas skeleton (coupled pair)

**Files:** Modify `src/components/dashboards/DashboardWidget.tsx`, `src/components/dashboards/DashboardCanvasSkeleton.tsx`. Tests: extend `DashboardWidget.test.tsx` (behavioral — keep green), `DashboardCanvasSkeleton.test.tsx` (keep `data-testid="widget-skeleton"`).

- [ ] **Step 1 (TDD):** add an assertion that the widget card root carries the keystone card treatment (`rounded-[14px]` + `card-lift`) and no longer `rounded-xl`.
- [ ] **Step 2:** watch it fail (card is `rounded-xl`, no `card-lift`).
- [ ] **Step 3 — the moves:**
  1. `DashboardWidget.tsx:55` — `rounded-xl` → `rounded-[14px]`; add `.card-lift` + `hover:border-border-hover` (move 3/4). Keep the brand-wash radial-gradient background exactly. **RGL-drag-safe:** `.card-lift` is a hover transform; RGL sets an inline `transform` during active drag which wins, so the lift only shows on idle hover — verify no visual fight in edit mode.
  2. `DashboardWidget.tsx:56` — header `border-b` → add `group-hover:border-border-hover` (needs `group` on the L55 root) so the hairline brightens with the card. Layout untouched.
  3. `DashboardCanvasSkeleton.tsx:12` (+ doc comment L5) — mirror the widget card radius: `rounded-xl` → `rounded-[14px]`. (Skeleton is static → no card-lift.)
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/dashboards/DashboardWidget.test.tsx src/components/dashboards/DashboardCanvasSkeleton.test.tsx` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish dashboard widget card + canvas skeleton`.

### Task 2.2: Widget contents (Kickers · preview card · list chip)

**Files:** Modify `src/components/dashboards/widgets/NumberWidget.tsx`, `src/components/dashboards/WidgetConfigSheet.tsx`, `src/components/dashboards/widgets/ListWidget.tsx`. Tests: `WidgetConfigSheet.test.tsx` behavioral (keep green); add a `ListWidget.test.tsx` anchor for the ColorChip contract (no existing test).

- [ ] **Step 1 (TDD):** new `ListWidget.test.tsx` — a colored cell renders a soft `ColorChip` (`rounded-sm`, `--pill` set, no opaque inline `backgroundColor`).
- [ ] **Step 2:** watch it fail (current pill is opaque `style={{ backgroundColor }}`).
- [ ] **Step 3 — the moves:**
  1. `NumberWidget.tsx:74` — the `text-xs tracking-wide uppercase` agg-unit label `<span>` → `<Kicker>{agg === "count" ? "items" : agg}</Kicker>` (import `@/components/ui/kicker`). Keep `mt-1`; drop the redundant hand-rolled classes.
  2. `WidgetConfigSheet.tsx:143` — the "Live preview" `text-xs tracking-wide uppercase` `<span>` → `<Kicker>Live preview</Kicker>`.
  3. `WidgetConfigSheet.tsx:146` — preview card `rounded-xl` → `rounded-[14px]` (radius consistency; not interactive → no card-lift).
  4. `ListWidget.tsx:49–58` — replace the opaque `<span style={{ backgroundColor: cell.color, color: pillTextColor(cell.color) }}>` with `<ColorChip color={cell.color}>{cell.text}</ColorChip>` (import `@/components/ui/color-chip`). Remove the now-unused `pillTextColor` import (L5) if nothing else uses it (nothing does).
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/dashboards/widgets/ListWidget.test.tsx src/components/dashboards/WidgetConfigSheet.test.tsx` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish dashboard widget contents (kickers + soft list chips)`.

### Task 2.3: dashboards-nav — no-op (documented)

Recon confirmed no valid Keystone chrome (avatar glyph is a preserve; section title is shell-owned `<NavSection>`). **No file change.** Recorded here so the wave's coverage of spec §4.2 is explicit: nav's only spec callout (`:139`) is intentionally left as a decorative avatar glyph.

### Task 2.4: Integrate, smoke-check, finish Wave 2

- [ ] **Step 1:** gates `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
- [ ] **Step 2:** visual smoke-check both themes — open a dashboard: widget cards show 14px radius + hover card-lift + brightening hairline (brand-wash intact), NumberWidget unit label is a mono kicker, list-widget colored cells are soft translucent chips (no opaque solids), skeleton→live transition has no radius jump. Confirm charts/gauges/meters unchanged.
- [ ] **Step 3:** `scripts/finish-task.sh`.
- [ ] **Step 4:** hand the user a numbered "How to test this" walkthrough (both themes).

---

# Wave 3 — Admin & entry

**Depends on:** Waves 0–2 merged to `develop`.
**Worktree:** `scripts/start-task.sh keystone-admin-entry` → `.claude/worktrees/keystone-admin-entry`.
**Recon (2026-07-10, against post-Wave-2 `develop`):** three file-disjoint surfaces → 3 parallel implementers. Key correction to spec §4.2: **Auth pages live under `src/app/(auth)/*`**, not `src/app/auth/*` (which holds only server `actions.ts` + `callback/route.ts` — DO NOT TOUCH). All cards are the shared shadcn `<Card>` (`rounded-xl bg-card ring-1 ring-foreground/10`, no shadow) — never edit `card.tsx`; apply per-call-site `className` overrides. There are **zero** hand-rolled uppercase labels and **zero** inline-bg/`rounded-full` status chips in these surfaces, so Kicker eyebrows are net-new and the only chip conversion is one members-table status badge.

**Shared entry-surface treatment (Auth + Onboarding cards):** brand-wash bg + `shadow-panel` on the `<Card>`, a `<Kicker>` eyebrow above `<CardTitle>`, and the submit CTA gets `shadow-glow-primary`. Exact brand-wash string (from `DashboardWidget`): `[background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)]`. Utilities verified: `shadow-panel` (globals.css L89), `shadow-glow-primary` (maps `--glow-primary` L148). Cards are static form containers → **no `.card-lift`**.

**Preserve (all surfaces):** every `useActionState`/`useForm`/`zodResolver`/`startTransition`/`formAction`/`action` wiring, `noValidate`+FormData construction, redirect/callback flows, `aria-invalid`/`aria-describedby`, all `text-destructive`/`text-status-*` semantic error/warn text, tested button/description copy, and `src/app/auth/*` server files. Avatar `rounded-full` stays. Visual classes / element wrapping only.

### Task 3.1: Auth (roughest — bespoke §4.2 pass)

**Files:** `src/components/auth/auth-form.tsx`, `change-password-form.tsx`, `forgot-password-form.tsx`. Tests: extend the three existing `*.test.tsx` (role/text-based — keep button text + description copy + forgot-password link intact).

- [ ] **Step 1 (TDD):** in `auth-form.test.tsx`, add an assertion that the form card carries the entry-surface treatment (query the card container; assert it has `shadow-panel` and a Kicker eyebrow is present, e.g. `getByText("WELCOME")`/`"GET STARTED"`). Assert semantic classes, not the gradient string.
- [ ] **Step 2:** watch it fail (stock `<Card>`, no eyebrow).
- [ ] **Step 3 — moves:**
  1. `auth-form.tsx` — main `<Card>` (L80) and check-email `<Card>` (L66): add `className="[background:radial-gradient(120%_80%_at_100%_0%,color-mix(in_oklab,var(--brand)_8%,transparent),transparent_55%),var(--card)] shadow-panel"`. Add a `<Kicker>` above `<CardTitle>` (L82): `isSignup ? "GET STARTED" : "WELCOME"`. CTA (L178): add `shadow-glow-primary` to the Button `className`.
  2. `change-password-form.tsx` — `<Card>` (L37) same brand-wash+`shadow-panel`; `<Kicker>SECURITY</Kicker>` above title (L42); CTA (L73) `shadow-glow-primary`. Keep both variant copy strings + the KeyRound tile.
  3. `forgot-password-form.tsx` — both `<Card>`s (main L52, sent L38) brand-wash+`shadow-panel`; `<Kicker>RESET</Kicker>` above title (L54); CTA (L99) `shadow-glow-primary`.
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/auth/` green (all three files).
- [ ] **Step 5:** commit `feat(ui): keystone-polish auth (brand-washed cards + kicker eyebrows + glow cta)`.

### Task 3.2: Onboarding (entry-surface consistency)

**Files:** `src/components/onboarding/onboarding-form.tsx`. Test: extend `onboarding-form.test.tsx`.

- [ ] **Step 1 (TDD):** assert the onboarding card has `shadow-panel` + a Kicker eyebrow (`getByText("GET STARTED")`).
- [ ] **Step 2:** watch it fail.
- [ ] **Step 3 — moves:** `<Card>` (L40) brand-wash+`shadow-panel`; `<Kicker>GET STARTED</Kicker>` above `<CardTitle>` (L42); CTA (L103) `shadow-glow-primary`. Same brand-wash string as auth.
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/onboarding/onboarding-form.test.tsx` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish onboarding entry card (kicker + glow cta)`.

### Task 3.3: Settings (StatusPill + Kicker + input hairlines)

**Files:** `src/components/settings/members-table.tsx`, `src/components/settings/invite-panel.tsx`, `src/components/settings/org-admin-console.tsx`, `src/app/(app)/settings/page.tsx`. Tests: extend `members-table.test.tsx` (keep `<tr>` structure + "Remove" button); the others are behavioral — keep green. `loading.test.tsx` asserts `max-w-3xl`+`mx-auto` — untouched (not in scope).

- [ ] **Step 1 (TDD):** in `members-table.test.tsx`, assert the member status renders via the soft `StatusPill` contract — `rounded-sm` (not the old `rounded-md`) and the tone class for active(green)/deactivated(gray).
- [ ] **Step 2:** watch it fail (current badge is hand-rolled `rounded-md` + `statusToneClasses(..., "solid")`).
- [ ] **Step 3 — moves:**
  1. `members-table.tsx` (L123–133) — replace the hand-rolled `<span>` status badge with `<StatusPill color={deactivated ? "gray" : "green"} variant="soft">{deactivated ? "Deactivated" : "Active"}</StatusPill>` (import `@/components/ui/status-pill`; drop the now-unused `statusToneClasses`/`cn` import iff nothing else uses them — verify). Role `<select>` (L109): add `hover:border-border-hover` (keep `onChange`/`disabled`/`aria-label`).
  2. `settings/page.tsx` (L74) — add a `<Kicker>ADMIN</Kicker>` eyebrow above the `<h1>Settings` (import `@/components/ui/kicker`).
  3. `org-admin-console.tsx` tab buttons (L50–66) — add `hover:border-border-hover` to inactive tabs; keep `role="tab"`/`aria-selected`/`onClick`/`capitalize`.
  4. `invite-panel.tsx` role `<select>` (L68) — add `hover:border-border-hover`; keep handlers.
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/settings/` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish settings (soft status pill + kicker + input hairlines)`.

### Task 3.4: Integrate, smoke-check, finish Wave 3

- [ ] **Step 1:** gates `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
- [ ] **Step 2:** visual smoke-check both themes — /login, /signup, /forgot-password, /change-password, /onboarding show a brand-washed elevated card with a mono Kicker eyebrow + glowing primary CTA; Settings members table shows soft status pills, page has an ADMIN kicker, inputs/tabs brighten on hover. No layout breakage; forms still submit.
- [ ] **Step 3:** `scripts/finish-task.sh`.
- [ ] **Step 4:** hand the user a numbered "How to test this" walkthrough (both themes).

---

# Wave 4 — Planning

**Depends on:** Waves 0–3 merged to `develop`.
**Worktree:** `scripts/start-task.sh keystone-planning` → `.claude/worktrees/keystone-planning`.
**Recon (2026-07-10, against post-Wave-3 `develop`):** a **lighter cluster** — these three surfaces are table/grid-based and already largely on-primitive. Findings: (1) **zero** hand-rolled uppercase labels (Kicker is additive on page headers, matching the Wave 3 `ADMIN / Settings` precedent → use `PLANNING`); (2) status chips mostly already migrated (`GoalStatusPill`/`HealthPill` are already soft `<StatusPill>`) — the one un-migrated chip is Portfolios' `PriorityPill` (plain text span); (3) the only interactive-card candidate is the portfolios index list (a `<ul>`, not real cards) → surface polish, not `.card-lift` on rows; (4) no `shadow-sm/md` anywhere; the substance is the progress/capacity bars → **accent-progress treatment = keystone easing on the fill, geometry/track only, data colors + width untouched**. 3 file-disjoint implementers.

**Preserve (all surfaces):** progress/capacity bar **fill colors + width calcs encode data** (goal %, portfolio %, workload under/at/over capacity via `bg-foreground/40`/`bg-primary`/`bg-destructive`) — keep them; only add keystone easing/track chrome. Small `size-2.5 rounded-full` status dots (`DoneMappingFields`), avatar `rounded-full` (`MemberRowHeader`), table-row `hover:bg-accent/*` (asserted by tests), all Server Actions / `onChange` / `pushState` / filter logic — untouched.

### Task 4.1: Goals

**Files:** `src/components/goals/ProgressBar.tsx`, `src/app/(app)/goals/page.tsx`. Test: add `src/components/goals/ProgressBar.test.tsx` (none exists). Keep `GoalTree.test.tsx` green (asserts row `hover:bg-accent/30`+`transition-colors` — untouched).

- [ ] **Step 1 (TDD):** `ProgressBar.test.tsx` — render `<ProgressBar progress={0.5} />`; assert the fill div has `bg-primary`, `ease-keystone`, and `style width: 50%`.
- [ ] **Step 2:** watch it fail (fill has no `ease-keystone`).
- [ ] **Step 3 — moves:**
  1. `ProgressBar.tsx:9` fill — `className="bg-primary h-full rounded-full"` → add `transition-[width] duration-500 ease-keystone`. Keep `bg-primary`, `rounded-full`, and the `width: ${pct}%` style. Track (L8) untouched.
  2. `app/(app)/goals/page.tsx` (~L30, the `<div>` wrapping `<h1>Goals`) — add `<Kicker>PLANNING</Kicker>` above the `<h1>` (import `@/components/ui/kicker`). Don't disturb the flex layout / subtitle / `NewGoalDialog`.
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/goals/` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish goals (planning kicker + eased progress bar)`.

### Task 4.2: Portfolios

**Files:** `src/components/portfolios/PriorityPill.tsx`, `src/components/portfolios/ProgressBar.tsx`, `src/app/(app)/portfolios/page.tsx`, `src/app/(app)/portfolios/[portfolioId]/page.tsx`. Test: add `src/components/portfolios/PriorityPill.test.tsx` (none exists). Keep skeleton/loading tests green (untouched).

- [ ] **Step 1 (TDD):** `PriorityPill.test.tsx` — `<PriorityPill priority="critical" />` renders "Critical" in a soft StatusPill (`rounded-sm`, red tone class); `priority={null}` renders "—".
- [ ] **Step 2:** watch it fail (currently a plain `text-xs font-medium` span, no `rounded-sm`).
- [ ] **Step 3 — moves:**
  1. `PriorityPill.tsx:17` — replace `<span className="text-xs font-medium">{LABEL[priority]}</span>` with `<StatusPill variant="soft" color={PRIORITY_COLOR[priority]}>{LABEL[priority]}</StatusPill>`. Add a `const PRIORITY_COLOR: Record<PortfolioPriority, StatusColor> = { critical: "red", high: "orange", medium: "yellow", low: "gray" }`. Import `StatusPill`, `StatusColor` from `@/components/ui/status-pill`. Keep the `null → <span>—</span>` branch (L15-16) exactly.
  2. `portfolios/ProgressBar.tsx:8` fill — same keystone easing as Goals (`transition-[width] duration-500 ease-keystone`; keep `bg-primary`/`rounded-full`/width).
  3. `app/(app)/portfolios/page.tsx` — the index `<ul className="divide-y rounded-md border">` (~L20) → `divide-y overflow-hidden rounded-[14px] border shadow-card` (keystone surface; keep the `<Link>` rows + `hover:bg-accent/40`). Above `<h1>Portfolios` (~L12) add `<Kicker>PLANNING</Kicker>` (wrap the h1 as needed; keep the flex row + `NewPortfolioDialog`).
  4. `app/(app)/portfolios/[portfolioId]/page.tsx` (~L30) — add `<Kicker>PLANNING</Kicker>` above `<h1>{portfolio.name}`.
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/portfolios/` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish portfolios (soft priority pill + planning kicker + surface)`.

### Task 4.3: Workload

**Files:** `src/components/workload/CapacityCell.tsx`, `src/components/workload/WorkloadGrid.tsx`. Test: extend `CapacityCell.test.tsx` (keep the `18h/40h/…` readout assertions).

- [ ] **Step 1 (TDD):** in `CapacityCell.test.tsx`, assert the fill inside `[data-testid="capacity-bar"]` carries `ease-keystone` for an at-capacity cell, and still carries its state color (`bg-primary`).
- [ ] **Step 2:** watch it fail (fill has `transition-[width]` but no `ease-keystone`).
- [ ] **Step 3 — moves:**
  1. `CapacityCell.tsx:126` fill className — `"h-full rounded-full transition-[width]"` → `"h-full rounded-full transition-[width] duration-500 ease-keystone"`. **Keep the three state colors (L127-129) and the width calc (L131-138) EXACTLY** (data). Track (L122) untouched.
  2. `WorkloadGrid.tsx` (~L245, the `<div>` wrapping `<h1>Workload`) — add `<Kicker>PLANNING</Kicker>` above the `<h1>` (import `@/components/ui/kicker`). Keep the subtitle + toolbar.
- [ ] **Step 4:** `pnpm exec vitest run --project unit src/components/workload/` green.
- [ ] **Step 5:** commit `feat(ui): keystone-polish workload (planning kicker + eased capacity bar)`.

### Task 4.4: Integrate, smoke-check, finish Wave 4

- [ ] **Step 1:** gates `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
- [ ] **Step 2:** visual smoke-check both themes — /goals, /portfolios, /portfolios/[id], /workload each show a `PLANNING` mono kicker above the heading; portfolio priority renders as a soft colored pill; the portfolios index list is a 14px elevated surface; progress + capacity bars animate width with keystone easing (colors unchanged). No layout breakage.
- [ ] **Step 3:** `scripts/finish-task.sh`.
- [ ] **Step 4:** hand the user a numbered "How to test this" walkthrough (both themes).

---

## Clusters 5–6 (planned just-in-time)

Each is its own worktree → `develop`, verified before the next (Approach B). Written as a same-structured plan (four moves + recon specifics + TDD anchor per surface) immediately before its worktree starts, against the then-current `develop`:

- **Wave 5 · Personal & chrome** — My Work · Time · Notifications · Command palette.
- **Wave 6 · Core touch-ups** — sidebar wordmark mark · item-panel meta-chips (`<MetaChip>`) + tab counts · `@mention` accent-highlighting · sidebar easing consistency.

---

## Self-review

- **Spec coverage:** Wave 0 implements spec §3 (both primitives + token audit). Wave 1 implements spec §4.2 Calendar/Gantt/Kanban via §4.1's four moves. Clusters 2–6 map 1:1 to spec §5.1 waves 2–6 and are scheduled (just-in-time plans). Perf budget (spec §7) holds — no server round-trips added. ✅
- **Placeholder scan:** the TDD anchor tests intentionally leave `/* minimal fixture */` markers where the surface's existing test setup must be reused (the fixture shape lives in each surface's current test file); these are pointers to existing code, not unwritten logic. Every new-file task (0.1, 0.2) has complete code. ✅
- **Type consistency:** `MetaChip` props (`label`, `tone`, `className`, `children`), `ColorChip` props (`color`, `className`, `children`), `softPillText(bg) → { light, dark }`, `statusToneClasses(color, "soft")` all match their source definitions. ✅
