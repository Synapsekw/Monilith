# Quiet Grid + Inter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Quiet Grid" board-table treatment (no vertical cell rules, 42px rows, 16px gutters, hover seam, cell-edit affordance, threaded subitems) and replace Nunito Sans with Inter as the application typeface everywhere except the MONOLITH wordmark.

**Architecture:** Presentation only. No schema change, no new queries, no Server Action touched. The font swap is one `next/font/google` declaration plus two CSS variables; the table work is geometry and class edits inside `src/components/boards/` that must not disturb the row-memoization invariants (`itemRowPropsEqual`, `cellControlsEqual`) that keep a single cell edit from re-rendering the grid.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, Tailwind v4 (`@theme inline` tokens in `src/app/globals.css`), shadcn/ui, `next/font/google`, Vitest + Testing Library, `@tanstack/react-virtual`.

**Spec:** `docs/superpowers/specs/2026-09-12-quiet-grid-inter-design.md`

## Global Constraints

- Style with semantic tokens only. Raw Tailwind colors (`bg-zinc-800`, `text-blue-500`) are forbidden in app code.
- Hairlines **brighten** on interaction (`--border` → `--border-hover` → `--border-bright`). Never thicken a border on hover or focus.
- Elevation is surface steps + hairlines. The only sanctioned shadows are `shadow-panel` (floating panels) and `shadow-drag` (row/card being dragged).
- The MONOLITH wordmark face (`src/lib/fonts.ts`, Nunito 800) does **not** change. It is a documented exception; every file that references it gets a comment saying so.
- Mono face stays JetBrains Mono (`--font-jetbrains-mono`). Kickers stay mono, uppercase, `tracking-[0.12em]`.
- Table type scale: item name `13.5px / 500 / -0.011em`; data cell value `13px`; column header kicker `10px / .12em` at 74% opacity; group name `13.5px / 600`; subitem name `13px / 400`. Tabular numerals stay on every numeric, currency and date cell.
- `ROW_HEIGHT = 42`, subitem rows `38px`, data-cell gutters `16px`.
- No task may thread a new per-render object through `controls` (`CellControls`), and no row-level code may read `controls.cache.cellValues` — a row's values come from `cellMap`. `src/components/boards/BoardTable.render-count.test.tsx` is the guard and must stay green.
- Coarse-pointer affordances (`pointer-coarse:size-11`, `pointer-coarse:opacity-100`) are preserved everywhere they exist today.
- Commits are authored as `Danijel Jovanovic <info@synapse-solutions.ai>`; stage explicitly by path, never `git add -A`.
- Gates for every task: `pnpm typecheck && pnpm lint && pnpm test`. The full `pnpm build` runs in Task 5.

---

## File Structure

**Task 1 — type system (global)**

| File                                                                            | Responsibility                                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`                                                            | Loads Inter as `--font-inter`; keeps JetBrains Mono                                     |
| `src/app/globals.css`                                                           | Maps `--font-sans` / `--font-heading` to Inter; heading tracking; `font-optical-sizing` |
| `src/app/globals.fonts.test.ts`                                                 | Guards the mapping (same file-parsing pattern as `globals.contrast.test.ts`)            |
| `src/components/landing/editorial-landing.module.css`                           | Two font-family references                                                              |
| `src/components/brand/brand.tsx`, `src/components/landing/landing-wordmark.tsx` | Comment: Nunito 800 is the wordmark face, deliberately not the UI font                  |
| `.claude/skills/pulse-ui/SKILL.md`                                              | Typography section rewritten so the next agent does not restore Nunito                  |

**Task 2 — cells, headers, footers**

| File                                                 | Responsibility                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/components/boards/table/EditableCell.tsx`       | 6 cell wrappers: drop `border-l`, gutters to `px-4`, cell-hover outline |
| `src/components/boards/ColumnHeader.tsx`             | Drop `border-l`, header padding, dimmed kicker                          |
| `src/components/boards/table/CreatedHeaderCell.tsx`  | Drop `border-l`, gutter                                                 |
| `src/components/boards/RollupValueCell.tsx`          | Shared `CELL_CLASS`, 13px text                                          |
| `src/components/boards/SummaryRow.tsx`               | Footer cell: drop `border-l`                                            |
| `src/components/boards/AddColumnMenu.tsx`            | Add-column track: drop `border-l`                                       |
| `src/components/boards/cells/index.tsx` and siblings | Renderer text size 14px → 13px                                          |

**Task 3 — rows and row states**

| File                                              | Responsibility                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `src/components/boards/table/shared.ts`           | `ROW_HEIGHT`, `SUBITEM_ROW_HEIGHT`, `CELL_TEXT`, `NAME_MEASURE_FONT` |
| `src/components/boards/table/ItemRow.tsx`         | Row hairline → inset line; height                                    |
| `src/components/boards/table/NameCell.tsx`        | Name scale, hover seam, seam-vs-selected precedence                  |
| `src/components/boards/table/BoardTableInner.tsx` | Canvas measurer reads `NAME_MEASURE_FONT`                            |

**Task 4 — subitems, add-rows, group header**

| File                                                                                | Responsibility                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `src/components/boards/table/SortableSubitemRow.tsx`                                | 38px rows, inset hairline, thread element     |
| `src/components/boards/table/NameCell.tsx` (indent branch only, after Task 3 lands) | 40px indent                                   |
| `src/components/boards/table/SubitemBlock.tsx`                                      | Band wrapper                                  |
| `src/components/boards/table/AddItemRow.tsx`, `AddSubitemRow.tsx`                   | Dashed-plus affordance                        |
| `src/components/boards/table/GroupHeaderRow.tsx`                                    | Group colour rail → 8px dot; group name scale |
| `src/components/boards/table/GroupRollupRow.tsx`                                    | Inherit geometry; rail → dot                  |

**Task 5 — integration**: browser verification, all four gates, manual-test walkthrough.

---

### Task 1: Inter everywhere (global type system)

**Files:**

- Modify: `src/app/layout.tsx:1-50`
- Modify: `src/app/globals.css:18-24` and the `@layer base` block at `:818`
- Create: `src/app/globals.fonts.test.ts`
- Modify: `src/components/landing/editorial-landing.module.css:17-19,55,91`
- Modify: `src/components/brand/brand.tsx:1-30`
- Modify: `src/components/landing/landing-wordmark.tsx:1-15`
- Modify: `.claude/skills/pulse-ui/SKILL.md:75-85,213-217`

**Interfaces:**

- Consumes: nothing.
- Produces: the CSS variable `--font-inter` on `<html>`; `--font-sans` and `--font-heading` both resolve to it. Every later task assumes `font-sans` is Inter. No exported TypeScript symbol.

- [ ] **Step 1: Write the failing test**

Create `src/app/globals.fonts.test.ts`. It parses the stylesheet the same way `globals.contrast.test.ts` already does, because a font-variable mistake fails no typecheck and no jsdom assertion:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("type system", () => {
  it("maps the sans + heading tokens to Inter", () => {
    expect(css).toContain("--font-sans: var(--font-inter)");
    expect(css).toContain("--font-heading: var(--font-inter)");
    expect(css).not.toContain("--font-nunito-sans");
  });

  it("keeps JetBrains Mono as the mono face", () => {
    expect(css).toContain("--font-mono: var(--font-jetbrains-mono)");
  });

  it("loads Inter in the root layout and exposes it as --font-inter", () => {
    expect(layout).toContain('from "next/font/google"');
    expect(layout).toMatch(/Inter\(\s*\{/);
    expect(layout).toContain('variable: "--font-inter"');
    expect(layout).not.toContain("Nunito_Sans");
  });

  it("keeps the wordmark on Nunito 800 (lib/fonts), deliberately", () => {
    const fonts = readFileSync(join(process.cwd(), "src/lib/fonts.ts"), "utf8");
    expect(fonts).toContain("Nunito");
    expect(fonts).toContain('weight: ["800"]');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/app/globals.fonts.test.ts`
Expected: FAIL — `--font-sans: var(--font-inter)` is not in `globals.css` (it currently reads `var(--font-nunito-sans)`).

- [ ] **Step 3: Swap the font in the root layout**

In `src/app/layout.tsx`, replace the import and the font declaration:

```tsx
import { Inter, JetBrains_Mono } from "next/font/google";

/**
 * Inter is the product typeface: a neutral, optically-sized grotesque that
 * stays crisp at the 13–13.5px sizes the board table uses and whose tabular
 * figures align hard in numeric columns. It deliberately does NOT cover the
 * MONOLITH wordmark — that stays Nunito 800 (src/lib/fonts.ts).
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
```

and update the `<html>` class:

```tsx
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
```

- [ ] **Step 4: Point the tokens at Inter and tune heading tracking**

In `src/app/globals.css`, inside `@theme inline`:

```css
--font-sans: var(--font-inter);
--font-mono: var(--font-jetbrains-mono);
--font-heading: var(--font-inter);
```

In the `@layer base` block, extend the existing `body` rule and add the heading rule directly after it:

```css
body {
  @apply bg-background text-foreground;
  font-optical-sizing: auto;
}
/* Inter runs wider than the Nunito Sans it replaced. Display sizes need
     negative tracking to hold the same optical rhythm; UI-sized text is tuned
     per surface (the board table sets its own in table/shared.ts). */
h1,
h2,
h3 {
  letter-spacing: -0.02em;
}
```

- [ ] **Step 5: Update the landing module CSS**

In `src/components/landing/editorial-landing.module.css`, replace both
`font-family: var(--font-nunito-sans), …` declarations (lines 55 and 91) with
`font-family: var(--font-inter), …`, keeping each existing fallback list, and update the file
header comment at lines 17–19 to read:

```css
 * Fonts come from the app's existing next/font assets: Inter
 * (`--font-inter`) for text, JetBrains Mono (`--font-jetbrains-mono`)
 * for kickers, and Nunito 800 (lib/fonts) for the wordmark — the same three
```

- [ ] **Step 6: Document the wordmark exception**

Add to the doc comment in `src/components/brand/brand.tsx` and
`src/components/landing/landing-wordmark.tsx`:

```
 * Nunito 800 here is the WORDMARK face, not the UI font: the product type is
 * Inter (see src/app/layout.tsx). This divergence is deliberate — the logotype
 * keeps its rounded ExtraBold identity. Do not "unify" it.
```

- [ ] **Step 7: Rewrite the skill's typography section**

In `.claude/skills/pulse-ui/SKILL.md`, replace the "UI + headings: Nunito Sans" bullet with:

```md
- **UI + headings: Inter** (`font-sans`, weights 400–800 loaded; headings lean
  600–800 with `-0.02em` tracking at display sizes). **Mono: JetBrains Mono**
  (`font-mono`, 400–600). Wired in `src/app/layout.tsx` as `--font-inter` /
  `--font-jetbrains-mono`. Nunito Sans is gone from the UI; Nunito 800 survives
  ONLY as the MONOLITH wordmark face in `src/lib/fonts.ts` — do not unify it.
```

and in the "Common mistakes" list, change the stale-system bullet to name `Nunito Sans` (not Geist) as the replaced face.

- [ ] **Step 8: Run the tests and make sure they pass**

Run: `pnpm vitest run src/app/globals.fonts.test.ts && pnpm vitest run src/app/globals.contrast.test.ts`
Expected: PASS on both. The contrast suite is unrelated to fonts but parses the same file — a malformed edit shows up there first.

- [ ] **Step 9: Gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Any snapshot mentioning `font-nunito-sans` is updated as part of this step.

- [ ] **Step 10: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css src/app/globals.fonts.test.ts \
  src/components/landing/editorial-landing.module.css \
  src/components/brand/brand.tsx src/components/landing/landing-wordmark.tsx \
  .claude/skills/pulse-ui/SKILL.md
git commit -m "feat(type): swap the product typeface to Inter

Nunito Sans is replaced by Inter as --font-sans/--font-heading across the
app. JetBrains Mono is unchanged. The MONOLITH wordmark keeps Nunito 800
(src/lib/fonts.ts) as a documented exception, and the pulse-ui skill is
rewritten so the next session does not restore the old face."
```

---

### Task 2: Cells, headers and footers — lose the cage

**Files:**

- Modify: `src/components/boards/table/EditableCell.tsx:83,103,122,152,187,203,242`
- Modify: `src/components/boards/ColumnHeader.tsx:104-115,138-141`
- Modify: `src/components/boards/table/CreatedHeaderCell.tsx:15`
- Modify: `src/components/boards/RollupValueCell.tsx:20,82,115,119`
- Modify: `src/components/boards/SummaryRow.tsx:167`
- Modify: `src/components/boards/AddColumnMenu.tsx:23`
- Modify: `src/components/boards/cells/index.tsx` (20 × `text-sm`), `cells/MirrorCell.tsx`, `cells/TimeTrackingCell.tsx`, `cells/RelationCell.tsx`, `cells/FilesCell.tsx`
- Test: `src/components/boards/ColumnHeader.test.tsx` (extend), `src/components/boards/cells/cells.test.tsx` (extend)

**Interfaces:**

- Consumes: Task 1's `font-sans` = Inter. Nothing else.
- Produces: no exported symbol. Later tasks rely on the fact that **no cell, header, rollup or footer element carries a `border-l` class** and that data cells pad `px-4`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/ColumnHeader.test.tsx`:

```tsx
describe("ColumnHeader — Quiet Grid", () => {
  it("paints no vertical rule and pads to 16px", () => {
    const { container } = render(
      <ColumnHeader
        column={col()}
        width={200}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    const header = container.firstElementChild as HTMLElement;
    expect(header.className).not.toMatch(/\bborder-l\b/);
    expect(header.className).toContain("px-4");
  });

  it("dims the column kicker", () => {
    render(
      <ColumnHeader
        column={col({ name: "Budget" })}
        width={200}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onResize={vi.fn()}
        onResizeEnd={vi.fn()}
      />,
    );
    expect(screen.getByText("Budget").className).toContain("opacity-[0.74]");
  });
});
```

Append to `src/components/boards/cells/cells.test.tsx`:

```tsx
describe("cell renderers — Quiet Grid scale", () => {
  it("renders text values at the 13px table scale, not text-sm", () => {
    render(
      <CellRenderer kind="text" value="Hello" settings={{}} members={[]} />,
    );
    const span = screen.getByText("Hello");
    expect(span.className).toContain("text-[13px]");
    expect(span.className).not.toMatch(/\btext-sm\b/);
  });
});
```

(If `cells.test.tsx` does not already import `CellRenderer` and `render`, add those imports — it renders cells today, so follow whatever factory it already uses for `settings`/`members`.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/components/boards/ColumnHeader.test.tsx src/components/boards/cells/cells.test.tsx`
Expected: FAIL — the header still matches `border-l` and the text cell still renders `text-sm`.

- [ ] **Step 3: Strip the vertical rules and re-gutter `EditableCell`**

In `src/components/boards/table/EditableCell.tsx`, every cell wrapper loses `border-l` and moves `px-3` → `px-4`. The six read-only / special wrappers become:

```tsx
// optimistic (temp-row) branch
className = "flex h-full items-center truncate px-4 opacity-50";
// files, time_tracking, relation, mirror branches
className = "flex h-full items-center px-4";
// isEditing branch
className = "relative flex items-center px-4";
```

The interactive branch swaps its full-bleed hover for the inset "editable" outline:

```tsx
className =
  "focus-visible:ring-ring relative flex h-full cursor-pointer items-center truncate px-4 transition-colors after:pointer-events-none after:absolute after:inset-1 after:rounded-md after:border after:border-transparent after:transition-colors hover:after:border-border-bright hover:after:bg-state-hover focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset";
```

Leave the `px-1` editor-hosting branch at line 152 alone — it hosts an editor that supplies its own padding.

- [ ] **Step 4: Strip the rules from the remaining surfaces**

- `src/components/boards/table/CreatedHeaderCell.tsx:15` →
  `className="text-kicker flex items-center gap-1.5 px-4"`
- `src/components/boards/RollupValueCell.tsx:20` →
  `const CELL_CLASS = "flex h-full items-center truncate px-4";`
  and its three `text-sm` spans → `text-[13px]`
- `src/components/boards/SummaryRow.tsx:167` →
  `className="flex min-w-0 items-center py-1.5"`
- `src/components/boards/AddColumnMenu.tsx:23` — drop the trailing `border-l` from the class string, keep everything else

- [ ] **Step 5: Re-gutter and dim the column header**

In `src/components/boards/ColumnHeader.tsx`, the wrapper:

```tsx
      className={cn(
        "group/col relative flex items-center gap-1 px-4 pt-3.5 pb-2.5",
        reorder?.isDragging && "bg-surface shadow-drag z-auto",
      )}
```

and the kicker:

```tsx
<Kicker
  size="xs"
  className="truncate opacity-[0.74] transition-opacity group-hover/col:opacity-100"
>
  {column.name}
</Kicker>
```

- [ ] **Step 6: Drop the renderers to the 13px table scale**

In `src/components/boards/cells/index.tsx`, replace every `text-sm` with `text-[13px]` (20 sites) and add this comment above the first renderer:

```tsx
/**
 * Board cells render at 13px — the Quiet Grid data scale (see the spec at
 * docs/superpowers/specs/2026-09-12-quiet-grid-inter-design.md). This is one
 * step below `text-sm`, which is the app-wide default everywhere else; the
 * table is denser than the rest of the product on purpose.
 */
```

Do the same `text-sm` → `text-[13px]` replacement in `cells/MirrorCell.tsx`,
`cells/TimeTrackingCell.tsx`, `cells/RelationCell.tsx` and `cells/FilesCell.tsx`.
**Do not** touch `cells/editors/*` — editors render inside popovers at the app's default size.

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `pnpm vitest run src/components/boards/ColumnHeader.test.tsx src/components/boards/cells/`
Expected: PASS.

- [ ] **Step 8: Prove no vertical rules survive**

Run: `grep -rn "border-l" src/components/boards --include="*.tsx" | grep -v "\.test\." | grep -v MarkdownPreview | grep -v GanttBoard`
Expected: no output. (`MarkdownPreview` is a blockquote rule and `GanttBoard` is a different view — both out of scope.)

- [ ] **Step 9: Gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green.

- [ ] **Step 10: Commit**

```bash
git add src/components/boards/table/EditableCell.tsx \
  src/components/boards/ColumnHeader.tsx src/components/boards/ColumnHeader.test.tsx \
  src/components/boards/table/CreatedHeaderCell.tsx \
  src/components/boards/RollupValueCell.tsx src/components/boards/SummaryRow.tsx \
  src/components/boards/AddColumnMenu.tsx src/components/boards/cells/
git commit -m "feat(boards): drop the table's vertical cell rules

Quiet Grid: no cell, header, rollup or footer paints a left hairline any
more — alignment and the frozen-column shadow carry the columns. Data
gutters move 12px to 16px, renderers drop to the 13px table scale, and the
cell hover wash becomes an inset outline that reads as editable."
```

---

### Task 3: Rows and row states

**Files:**

- Modify: `src/components/boards/table/shared.ts:174`
- Modify: `src/components/boards/table/ItemRow.tsx:255-275`
- Modify: `src/components/boards/table/NameCell.tsx:96-190`
- Modify: `src/components/boards/table/BoardTableInner.tsx:436-446`
- Test: `src/components/boards/table/shared.test.ts` (extend), `src/components/boards/table/NameCell.test.tsx` (create)

**Interfaces:**

- Consumes: Task 1's `font-sans` = Inter.
- Produces:
  - `export const ROW_HEIGHT = 42` (`table/shared.ts`)
  - `export const SUBITEM_ROW_HEIGHT = 38` (`table/shared.ts`) — Task 4 consumes it
  - `export const NAME_MEASURE_FONT = "500 13.5px Inter, ui-sans-serif, system-ui, sans-serif"` (`table/shared.ts`) — the single source of truth for both the rendered name cell and the canvas measurer
  - `export const ROW_HAIRLINE` (`table/shared.ts`) — the inset-hairline class string, consumed by Task 4

- [ ] **Step 1: Write the failing tests**

Append to `src/components/boards/table/shared.test.ts`:

```ts
import {
  ROW_HEIGHT,
  SUBITEM_ROW_HEIGHT,
  NAME_MEASURE_FONT,
  ROW_HAIRLINE,
} from "./shared";

describe("Quiet Grid geometry", () => {
  it("uses 42px item rows and 38px subitem rows", () => {
    expect(ROW_HEIGHT).toBe(42);
    expect(SUBITEM_ROW_HEIGHT).toBe(38);
  });

  it("measures the name column with the rendered name font", () => {
    // A drifted measurer silently mis-sizes the frozen column; typecheck and
    // jsdom both stay green, so this string is asserted explicitly.
    expect(NAME_MEASURE_FONT).toContain("13.5px");
    expect(NAME_MEASURE_FONT).toContain("Inter");
    expect(NAME_MEASURE_FONT).not.toContain("14px");
  });

  it("insets the row hairline so it starts at the name text", () => {
    expect(ROW_HAIRLINE).toContain("before:left-4");
    expect(ROW_HAIRLINE).not.toMatch(/\bborder-b\b/);
  });
});
```

Create `src/components/boards/table/NameCell.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NameCell } from "@/components/boards/table/NameCell";
import type { Item } from "@/lib/boards/queries";
import type { CellControls } from "@/components/boards/table/shared";

const item = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Draft the Q4 positioning brief",
  group_id: "g1",
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
} as Item;

const controls = {
  renameItemInCache: vi.fn(),
  members: [],
} as unknown as CellControls;

describe("NameCell — Quiet Grid", () => {
  it("renders the name at the 13.5px table scale", () => {
    render(<NameCell item={item} controls={controls} />);
    expect(screen.getByLabelText(`${item.name} name`).className).toContain(
      "text-[13.5px]",
    );
  });

  it("wipes in a hover seam when not selected", () => {
    const { container } = render(<NameCell item={item} controls={controls} />);
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain("after:bg-primary");
    expect(cell.className).toContain("group-hover/name:after:scale-y-100");
  });

  it("suppresses the hover seam while the row is selected", () => {
    const { container } = render(
      <NameCell item={item} controls={controls} selected />,
    );
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.className).toContain("before:bg-primary"); // the 3px selected bar
    expect(cell.className).toContain("after:hidden"); // seam yields to it
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/components/boards/table/shared.test.ts src/components/boards/table/NameCell.test.tsx`
Expected: FAIL — `SUBITEM_ROW_HEIGHT`, `NAME_MEASURE_FONT` and `ROW_HAIRLINE` do not exist; `ROW_HEIGHT` is 36.

- [ ] **Step 3: Add the geometry constants**

In `src/components/boards/table/shared.ts`, replace the `ROW_HEIGHT` line with:

```ts
/** Item-row height. Quiet Grid density (was 36 — "direction C"). */
export const ROW_HEIGHT = 42;

/** Subitem rows sit one step tighter than their parent. */
export const SUBITEM_ROW_HEIGHT = 38;

/**
 * The row separator. Quiet Grid has NO vertical rules, so the horizontal one
 * is inset to start at the name text (16px) rather than the frame edge, at 70%
 * alpha — a full-bleed `border-b` re-draws the cage this design removes.
 */
export const ROW_HAIRLINE =
  "relative before:pointer-events-none before:absolute before:top-0 before:right-0 before:left-4 before:h-px before:bg-border before:opacity-70 before:content-['']";

/**
 * Canvas font for the Name-column auto-fit measurement in BoardTableInner.
 * MUST stay in sync with what NameCell actually renders (13.5px / 500 Inter);
 * a drift here mis-sizes the frozen column on every board that has never had
 * its width set by hand, and nothing in typecheck or jsdom catches it.
 */
export const NAME_MEASURE_FONT =
  "500 13.5px Inter, ui-sans-serif, system-ui, sans-serif";
```

- [ ] **Step 4: Move the row separator onto the item row**

In `src/components/boards/table/ItemRow.tsx`, import `ROW_HAIRLINE` alongside `ROW_HEIGHT` and change the row wrapper's class list — `border-b` and the border-colour hover both go, because there is no longer a border to brighten:

```tsx
      className={cn(
        "ease-keystone grid w-full transition-colors",
        ROW_HAIRLINE,
        selected ? "bg-primary/[0.08]" : "hover:bg-state-hover",
        isDragging && "shadow-drag relative z-10",
        intelRowClasses(intelMatch),
      )}
```

- [ ] **Step 5: Scale the name and add the hover seam**

In `src/components/boards/table/NameCell.tsx`, the non-editing wrapper gains the seam and keeps the selected bar, with explicit precedence:

```tsx
      className={cn(
        "group/name ease-keystone relative sticky left-0 z-10 flex h-full items-center pr-2 transition-colors",
        // Hover seam: a 2px periwinkle rule that wipes in from the left edge.
        // `after:` is the seam, `before:` is the selected bar — a selected row
        // owns x=0, so the seam hides rather than stacking on top of it.
        "after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[2px] after:origin-center after:scale-y-0 after:bg-primary after:transition-transform after:duration-300 after:content-[''] group-hover/name:after:scale-y-100",
        selected
          ? cn(
              "before:bg-primary before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded",
              "after:hidden",
              intelMatch === true && "before:hidden",
            )
          : indented
            ? "bg-surface-sunken hover:bg-surface"
            : "bg-surface hover:bg-surface-muted",
        NAME_FREEZE_EDGE,
      )}
```

and the name text itself:

```tsx
        className={cn(
          "focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center truncate text-[13.5px] font-medium tracking-[-0.011em] focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
          pending ? "cursor-default opacity-60" : "cursor-pointer",
          indented ? "pl-8" : "px-4",
        )}
```

(The `pl-8` indent is Task 4's to change — leave it.)

- [ ] **Step 6: Point the measurer at the shared constant**

In `src/components/boards/table/BoardTableInner.tsx`, import `NAME_MEASURE_FONT` from `./shared` and replace line 444:

```tsx
if (ctx) ctx.font = NAME_MEASURE_FONT;
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `pnpm vitest run src/components/boards/table/ src/components/boards/BoardTable.render-count.test.tsx`
Expected: PASS, render-count included — if that suite fails, a change in this task re-created an object identity per render; fix it rather than updating the expectation.

- [ ] **Step 8: Gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add src/components/boards/table/shared.ts src/components/boards/table/shared.test.ts \
  src/components/boards/table/ItemRow.tsx src/components/boards/table/NameCell.tsx \
  src/components/boards/table/NameCell.test.tsx \
  src/components/boards/table/BoardTableInner.tsx
git commit -m "feat(boards): 42px rows, inset hairline and a hover seam

Rows grow to 42px and swap their full-bleed bottom border for a hairline
inset to the name text. The frozen name cell gains a 2px periwinkle seam
that wipes in on hover and yields to the selected bar. The name-column
canvas measurer now reads the same font constant the cell renders, so the
frozen column stops drifting when the type scale changes."
```

---

### Task 4: Subitems, add-rows and the group header

**Files:**

- Modify: `src/components/boards/table/SortableSubitemRow.tsx:140-160,205,211`
- Modify: `src/components/boards/table/NameCell.tsx` (the `indented` branch only)
- Modify: `src/components/boards/table/SubitemBlock.tsx:57-60`
- Modify: `src/components/boards/table/AddItemRow.tsx:62-66`
- Modify: `src/components/boards/table/AddSubitemRow.tsx:47-50`
- Modify: `src/components/boards/table/GroupHeaderRow.tsx:104-118`
- Modify: `src/components/boards/table/GroupRollupRow.tsx:33-45`
- Test: `src/components/boards/table/AddSubitemRow.test.tsx` (extend), `src/components/boards/table/SubitemThread.test.tsx` (create)

**Interfaces:**

- Consumes: `SUBITEM_ROW_HEIGHT` and `ROW_HAIRLINE` from Task 3's `table/shared.ts`; Task 2's rule-free cells.
- Produces: `data-testid="subitem-thread"` on the thread element (asserted by the test below). No exported symbol.

- [ ] **Step 1: Write the failing tests**

Create `src/components/boards/table/SubitemThread.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableSubitemRow } from "@/components/boards/table/SortableSubitemRow";
import { SUBITEM_ROW_HEIGHT } from "@/components/boards/table/shared";
import type { Item } from "@/lib/boards/queries";
import type { CellControls } from "@/components/boards/table/shared";

const sub = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Audit current copy",
  group_id: "g1",
  parent_item_id: "11111111-1111-4111-8111-111111111111",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
} as Item;

const controls = {
  members: [],
  deleteItem: vi.fn(),
  renameItemInCache: vi.fn(),
  dependentsByItem: new Map(),
  statusColumn: null,
  cache: { cellValues: [], attachments: [], columns: [] },
} as unknown as CellControls;

function renderSubitem() {
  return render(
    <DndContext>
      <SortableContext items={[sub.id]}>
        <SortableSubitemRow
          sub={sub}
          columns={[]}
          cellMap={new Map()}
          template="300px 1fr"
          controls={controls}
          renamingItemId={null}
          onRenameSettled={vi.fn()}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("subitem rows — Quiet Grid", () => {
  it("renders at the subitem height", () => {
    const { container } = renderSubitem();
    const row = container.querySelector(
      "[data-intel-rule='cell']",
    ) as HTMLElement;
    expect(row.style.height).toBe(`${SUBITEM_ROW_HEIGHT}px`);
  });

  it("draws a thread line so the parent link survives without vertical rules", () => {
    renderSubitem();
    expect(screen.getByTestId("subitem-thread")).toBeInTheDocument();
  });

  it("indents the subitem name to 40px", () => {
    renderSubitem();
    expect(screen.getByLabelText(`${sub.name} name`).className).toContain(
      "pl-10",
    );
  });
});
```

Append to `src/components/boards/table/AddSubitemRow.test.tsx`:

```tsx
it("renders the dashed add affordance", () => {
  const { container } = render(
    <AddSubitemRow parentId="p1" controls={controls} />,
  );
  const plus = container.querySelector("[data-testid='add-affordance']");
  expect(plus?.className).toContain("border-dashed");
});
```

(Reuse whatever `controls` stub the file already builds for its existing cases.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run src/components/boards/table/SubitemThread.test.tsx src/components/boards/table/AddSubitemRow.test.tsx`
Expected: FAIL — no thread element, row height still 42 (it reads `ROW_HEIGHT`), name indent is `pl-8`.

- [ ] **Step 3: Give subitem rows their own height and hairline**

In `src/components/boards/table/SortableSubitemRow.tsx`, import `SUBITEM_ROW_HEIGHT` and `ROW_HAIRLINE` instead of `ROW_HEIGHT`, then:

```tsx
        height: SUBITEM_ROW_HEIGHT,
```

```tsx
      className={cn(
        "ease-keystone hover:bg-state-hover grid w-full transition-colors",
        ROW_HAIRLINE,
        isDragging && "shadow-drag relative z-10",
        intelRowClasses(intelMatch),
      )}
```

and both created-by/created-at wrappers at lines 205 and 211 lose their rule:

```tsx
            <div className="flex h-full items-center px-4">
```

- [ ] **Step 4: Add the thread and deepen the indent**

Still in `SortableSubitemRow.tsx`, pass a thread element ahead of the drag handle by wrapping the existing `leading` value:

```tsx
const threadedLeading = (
  <>
    {/* Parent↔child link. Quiet Grid has no vertical rules, so the thread —
          a 1px line with a short elbow into the name — is what says "this row
          belongs to the one above". */}
    <span
      aria-hidden
      data-testid="subitem-thread"
      className="bg-border before:bg-border pointer-events-none absolute inset-y-0 left-[26px] w-px before:absolute before:top-1/2 before:left-0 before:h-px before:w-2 before:content-['']"
    />
    {dragHandle}
  </>
);
```

and hand it to `NameCell` (`leading={threadedLeading}`).

In `src/components/boards/table/NameCell.tsx`, the indented branch moves 32px → 40px:

```tsx
          indented ? "pl-10" : "px-4",
```

- [ ] **Step 5: Give the add-rows the dashed affordance**

In `src/components/boards/table/AddItemRow.tsx` and `AddSubitemRow.tsx`, replace the bare `<Plus …/>` with the affordance, and drop the now-orphaned `border-b` on each wrapper (there are no full-bleed row borders any more):

```tsx
<span
  data-testid="add-affordance"
  className="border-border-bright text-muted-foreground group-hover/add:border-primary group-hover/add:text-primary grid size-[18px] shrink-0 place-items-center rounded-md border border-dashed transition-colors"
>
  <Plus className="size-3" aria-hidden />
</span>
```

Add `group/add` to each wrapper's class list so the hover state has something to hang off, e.g. in `AddItemRow.tsx`:

```tsx
className = "group/add bg-surface sticky left-0 flex flex-col px-4 py-1.5";
```

and in `AddSubitemRow.tsx`:

```tsx
    <div className="group/add bg-surface-sunken sticky left-0 flex flex-col py-1.5 pr-4 pl-10">
```

- [ ] **Step 6: Group colour rail → dot**

In `src/components/boards/table/GroupHeaderRow.tsx`, delete the `style={{ boxShadow: … }}` inset rail from the frozen group cell, re-gutter it, and render a dot next to the name instead. The frozen cell becomes:

```tsx
      <div
        className={cn(
          "bg-surface text-foreground relative sticky left-0 z-10 flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-[13.5px] font-semibold",
          NAME_FREEZE_EDGE,
        )}
      >
        {selectAll}
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
        />
```

Keep every existing control (chevron button, rename input, count, `GroupMenu`, `NameResizeHandle`) exactly as it is — only the rail, the padding, the type scale and the new dot change.

Apply the same rail → dot swap in `src/components/boards/table/GroupRollupRow.tsx:33-45`, and re-gutter its label cell to `px-4`.

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `pnpm vitest run src/components/boards/table/`
Expected: PASS, including the existing `AddItemRow`, `AddSubitemRow`, `AddGroupRow` and temp-row suites.

- [ ] **Step 8: Gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add src/components/boards/table/SortableSubitemRow.tsx \
  src/components/boards/table/SubitemBlock.tsx \
  src/components/boards/table/SubitemThread.test.tsx \
  src/components/boards/table/NameCell.tsx \
  src/components/boards/table/AddItemRow.tsx src/components/boards/table/AddSubitemRow.tsx \
  src/components/boards/table/AddSubitemRow.test.tsx \
  src/components/boards/table/GroupHeaderRow.tsx src/components/boards/table/GroupRollupRow.tsx
git commit -m "feat(boards): thread subitems and turn the group rail into a dot

Subitem rows drop to 38px, indent to 40px and hang off a 1px thread with
an elbow, so the parent link survives the loss of vertical rules. Add-item
and add-subitem rows get a dashed-plus affordance, and the group colour
moves from a 3px inset rail on the frozen cell to an 8px dot beside the
group name."
```

---

### Task 5: Integration — browser verification and gates

**Files:**

- Modify: none expected. Any fix found here is committed against the file that owns the defect.
- Test: the four gates plus a real-browser pass.

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: the manual-test walkthrough that closes the branch.

- [ ] **Step 1: Run the full gate set**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four green. `pnpm build` is the one gate not run per-task; a Tailwind arbitrary value that no test exercised fails here, not earlier.

- [ ] **Step 2: Verify the geometry in a real browser**

jsdom renders no geometry, so the inset hairline, the seam wipe, the frozen-column shadow and the 13px scale are verified against the built CSS in Chromium — at 1440px and at a coarse-pointer emulation, in **both** themes:

```bash
pnpm dev
# then drive Chromium (Chrome MCP, or a Playwright script under
# node_modules/.cache/) against a board with: a group with subitems, a
# collapsed group, an empty group, and at least 8 columns so the frozen
# column actually scrolls.
```

Check, in order:

1. No vertical line anywhere between columns; the frozen-column shadow appears only once scrolled sideways.
2. Row hairline starts at the name text, not the frame edge.
3. Hovering a row wipes the 2px seam in; selecting it replaces the seam with the 3px bar.
4. Hovering a cell shows the inset outline; clicking opens the editor unchanged.
5. Expanding a parent shows the thread + elbow; collapsing restores the rollup values.
6. Light mode and at least two theme presets (`graphite`, `ember`) — the 74% kicker must still read.

- [ ] **Step 3: Confirm the kicker still clears AA**

Run: `pnpm vitest run src/app/globals.contrast.test.ts`
Expected: PASS. If the 74%-opacity column kicker fails AA in any preset, raise the opacity to the lowest value that passes and re-run — do not ship a failing contrast check.

- [ ] **Step 4: Whole-branch review**

Request a review of the entire branch diff, not the per-task diffs — cross-task defects (a constant changed in Task 3 that Task 4 duplicated, a class removed twice, a stale import) only show up at branch scope.

- [ ] **Step 5: Finish the task**

```bash
scripts/finish-task.sh
```

Then write the manual-test walkthrough: which board URL to open, what to hover / expand / collapse, and the expected result at each step, in both the closing message and the `/wrapup` session note.

---

## Self-Review

**Spec coverage**

| Spec requirement                                          | Task                                                 |
| --------------------------------------------------------- | ---------------------------------------------------- |
| Inter in `layout.tsx` / `globals.css`                     | 1                                                    |
| Heading tracking, `font-optical-sizing`                   | 1                                                    |
| Landing module CSS                                        | 1                                                    |
| Wordmark exception documented                             | 1                                                    |
| `pulse-ui` skill rewritten                                | 1                                                    |
| Canvas measurer                                           | 3                                                    |
| Table type scale (name / cell / kicker / group / subitem) | 2 (cell, kicker), 3 (name), 4 (group, subitem)       |
| `ROW_HEIGHT` 42                                           | 3                                                    |
| Vertical rules removed                                    | 2 (cells/headers/footers), 3 (row), 4 (subitem rows) |
| Inset row hairline                                        | 3 (`ROW_HAIRLINE`), consumed by 4                    |
| Gutters 16px                                              | 2, 3, 4                                              |
| Hover seam + selected precedence                          | 3                                                    |
| Cell hover outline                                        | 2                                                    |
| Subitem indent, thread, 38px                              | 4                                                    |
| Dashed add-rows                                           | 4                                                    |
| Group rail → dot                                          | 4                                                    |
| Collapsed rollups inherit geometry                        | 4                                                    |
| Perf budget (no new round-trips, memo invariants)         | Global constraints; guarded by render-count in 3     |
| AA contrast of the dimmed kicker                          | 5                                                    |
| Browser verification of pixel-level claims                | 5                                                    |

**Type consistency:** `ROW_HEIGHT`, `SUBITEM_ROW_HEIGHT`, `ROW_HAIRLINE` and `NAME_MEASURE_FONT` are all declared in Task 3 Step 3 and consumed under those exact names in Tasks 3 and 4. `data-testid="subitem-thread"` and `data-testid="add-affordance"` are asserted in Task 4 Step 1 and emitted in Steps 4 and 5.

**Execution:** Task 1 must land first (every later task assumes `font-sans` is Inter). Tasks 2, 3 and 4 have disjoint file sets **except** `NameCell.tsx`, which Task 3 owns and Task 4 edits in one line — if 3 and 4 run in parallel worktrees, Task 4 rebases onto Task 3 before its `pl-10` edit. Task 5 is last.
