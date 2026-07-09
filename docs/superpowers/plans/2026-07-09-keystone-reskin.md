# Keystone Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the "Monolith Keystone" look by rethemeing the token layer (dark + light) and reskinning the three core surfaces (sidebar, board table, item panel), visual-only.

**Architecture:** Retheme the Tailwind v4 `@theme inline` token layer in `src/app/globals.css` (both `:root` light and `.dark` dark) + swap fonts in `layout.tsx`. Surfaces consume semantic tokens, so the palette cascades automatically; each surface task then adds the Keystone structural details (mono kickers, brightening hairlines, selection accent bar, card-lift, translucent pills). Foundation is serial and blocking; the three surfaces are an independent parallel wave.

**Tech Stack:** Next.js 16 (App Router, RSC), Tailwind v4 (`@theme inline`, no config file), shadcn primitives, `next/font/google`, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-09-keystone-reskin-design.md`

### Plan-level refinements to the spec (read first)

1. **Color fidelity via hex/rgba.** Keystone's neutral surface ramp and translucent hairlines are written as **exact hex / rgba** (not OKLch) to guarantee the prototype colors with zero conversion drift. Status/progress ramps stay OKLch (unchanged). Mixing color spaces in CSS custom properties is fine.
2. **`--primary` stays the periwinkle brand; the "ink-on-paper" hero CTA is a per-surface treatment.** Making _every_ shadcn primary button a glowing near-white button would be far too loud. So `--primary` = periwinkle with **near-black `--primary-foreground`** (AA-safe: near-black on `#8ea2eb`), and the single loud inverted+glow CTA is applied only to the board hero action (`+ New item`, Task 6) via a dedicated class. This preserves the spec's intent (one loud CTA; periwinkle accent everywhere else).
3. **No separate `--brand-strong`.** Light mode simply sets `--brand` to a deepened periwinkle `#5b6fd6` (AA on white as fill+text); dark uses `#8ea2eb`. This subsumes spec §3.4's `--brand-strong` need.
4. **Overlays keep a minimal shadow.** "Near-zero shadows" means cards/panels rely on surface-step + hairline, but floating overlays (popover/dropdown/dialog/sheet) keep a **minimal** `--elevation-panel` so they don't merge with content behind them. `--elevation-card` → `none`.
5. **`status-pill` already has the `soft` variant.** Surfaces adopt `variant="soft"`; the pill component only gets a small geometry/hover polish (Task 4).

---

## File Structure

**Foundation (serial):**

- `src/app/globals.css` — retheme `:root` + `.dark`, add tokens, radius, motion, `.card-lift` utility (Task 1)
- `src/app/layout.tsx` — Nunito + JetBrains Mono (Task 2)
- `src/components/ui/kicker.tsx` + `.test.tsx` — new primitive (Task 3)
- `src/components/ui/status-pill.tsx` + `.test.tsx` — geometry/hover polish (Task 4)

**Surfaces (parallel wave, after foundation):**

- **A — Sidebar/shell:** `authenticated-shell.tsx`, `sidebar-nav.tsx`, `nav-section.tsx`, `workspace-switcher.tsx`, `user-menu.tsx` (+ their tests) (Task 5)
- **B — Board table:** `BoardHeader.tsx`, `BoardToolbar.tsx`, `BoardViews.tsx`/`ViewSwitcher.tsx`, `BoardTable.tsx`, `ColumnHeader.tsx`, `SummaryRow.tsx`, `FooterCell.tsx`, `cells/*` (+ tests) (Task 6)
- **C — Item panel:** `boards/item-panel/ItemPanel.tsx`, `UpdatesTab.tsx`, `FilesTab.tsx`, `ActivityTab.tsx`, `ActivityRow.tsx`, `AttachmentCard.tsx`, `MentionTextarea.tsx` (+ tests) (Task 7)

**Integration (serial):**

- Visual smoke-check + gates (Task 8)

---

## Task 1: Token layer retheme (`globals.css`)

**Files:**

- Modify: `src/app/globals.css` — `@theme inline` block (add tokens, change `--radius`), `:root` block (light Keystone), `.dark` block (dark Keystone), `@layer base` (add `.card-lift`)

- [ ] **Step 1: Add new tokens to `@theme inline`**

In the `@theme inline` block, after the existing `--color-*` entries, add:

```css
/* Keystone additions */
--color-kicker: var(--kicker);
--color-border-hover: var(--border-hover);
--color-border-bright: var(--border-bright);
--shadow-glow-primary: var(--glow-primary);
--ease-keystone: cubic-bezier(0.16, 1, 0.3, 1);
```

And change the font bindings (currently Geist) to:

```css
--font-sans: var(--font-nunito);
--font-mono: var(--font-jetbrains-mono);
--font-heading: var(--font-nunito);
```

And change the radius base:

```css
--radius: 0.875rem; /* 14px — Keystone cards/panels; radius-sm→~8px chips */
```

(Note: `--radius` currently lives in `:root`, value `0.625rem`. Move the base value here OR update it in `:root`; keep a single source. Simplest: update the `--radius` line in `:root` to `0.875rem` and leave `@theme` calc chain as-is.)

- [ ] **Step 2: Replace the `:root` (light) Keystone palette**

Replace the color/surface/border/radius/elevation lines in `:root` with:

```css
/* Keystone light — deepened periwinkle for AA on white */
--brand: #5b6fd6;
--brand-foreground: #ffffff;

--background: #f6f6f8;
--foreground: #1a1a1f;
--surface: #ffffff;
--surface-muted: #f1f1f4;
--surface-sunken: #f1f1f4;
--card: #ffffff;
--card-foreground: #1a1a1f;
--popover: #ffffff;
--popover-foreground: #1a1a1f;

--primary: var(--brand);
--primary-foreground: var(--brand-foreground);

--secondary: #f1f1f4;
--secondary-foreground: #1a1a1f;
--muted: #f1f1f4;
--muted-foreground: #6b6b72;
--kicker: #9a9aa2;
--accent: #f1f1f4;
--accent-foreground: #1a1a1f;
--destructive: oklch(0.577 0.245 27.325);
--border: rgba(0, 0, 0, 0.08);
--border-hover: rgba(0, 0, 0, 0.14);
--border-bright: rgba(0, 0, 0, 0.22);
--input: rgba(0, 0, 0, 0.12);
--ring: var(--brand);
--glow-primary: 0 0 30px -8px rgba(91, 111, 214, 0.35);
```

Keep the existing `--status-*`, `--progress-*`, `--chart-*` lines unchanged. Update `--radius` to `0.875rem`. Set:

```css
--elevation-panel: 0 8px 24px -14px rgba(0, 0, 0, 0.18);
--elevation-card: none;
```

Update the sidebar block to reference the new surfaces:

```css
--sidebar: #f6f6f8;
--sidebar-foreground: #1a1a1f;
--sidebar-primary: var(--brand);
--sidebar-primary-foreground: var(--brand-foreground);
--sidebar-accent: #f1f1f4;
--sidebar-accent-foreground: #1a1a1f;
--sidebar-border: rgba(0, 0, 0, 0.08);
--sidebar-ring: var(--brand);
```

- [ ] **Step 3: Replace the `.dark` (dark) Keystone palette**

Replace the corresponding lines in `.dark` with:

```css
--brand: #8ea2eb; /* periwinkle */
--brand-foreground: #0e0e10; /* near-black text on periwinkle fill (AA) */

--background: #0e0e10;
--foreground: #f4f4f6;
--surface: #161619;
--surface-muted: #1c1c20;
--surface-sunken: #1c1c20;
--card: #161619;
--card-foreground: #f4f4f6;
--popover: #1c1c20;
--popover-foreground: #f4f4f6;

--primary: var(--brand);
--primary-foreground: var(--brand-foreground);

--secondary: #26262c;
--secondary-foreground: #f4f4f6;
--muted: #1c1c20;
--muted-foreground: #9a9aa2;
--kicker: #6b6b72;
--accent: #1c1c20;
--accent-foreground: #f4f4f6;
--destructive: oklch(0.704 0.191 22.216);
--border: rgba(255, 255, 255, 0.1);
--border-hover: rgba(255, 255, 255, 0.16);
--border-bright: rgba(255, 255, 255, 0.26);
--input: rgba(255, 255, 255, 0.14);
--ring: var(--brand);
--glow-primary: 0 0 36px -6px rgba(255, 255, 255, 0.35);
```

Keep the dark `--status-*` / `--progress-*` / `--chart-*` lines unchanged. Set:

```css
--elevation-panel: 0 8px 30px -12px rgba(0, 0, 0, 0.7);
--elevation-card: none;
```

Update the `.dark` sidebar block:

```css
--sidebar: #161619;
--sidebar-foreground: #f4f4f6;
--sidebar-primary: var(--brand);
--sidebar-primary-foreground: var(--brand-foreground);
--sidebar-accent: #1c1c20;
--sidebar-accent-foreground: #f4f4f6;
--sidebar-border: rgba(255, 255, 255, 0.1);
--sidebar-ring: var(--brand);
```

- [ ] **Step 4: Add the `.card-lift` utility + retune `--animate-slidein` easing**

In `@layer base`, add a shared hover-lift utility (used by interactive cards/rows/chips):

```css
/* Keystone signature: interactive cards lift + hairline brightens on hover. */
.card-lift {
  transition:
    transform 300ms var(--ease-keystone),
    border-color 300ms var(--ease-keystone),
    box-shadow 300ms var(--ease-keystone);
}
@media (hover: hover) {
  .card-lift:hover {
    transform: translateY(-4px);
  }
}
```

(The existing global `prefers-reduced-motion` block already neutralizes the transition/transform.)

- [ ] **Step 5: Update the `viewport.themeColor` dark value in `layout.tsx`**

(Deferred to Task 2 — it edits `layout.tsx` anyway. Note here so it isn't missed: dark theme color `#0d0d0f` → `#0e0e10`, light `#fafafa` → `#f6f6f8`.)

- [ ] **Step 6: Verify build compiles the CSS**

Run: `pnpm build`
Expected: build succeeds (Tailwind v4 accepts hex/rgba custom properties; no `oklch`-only assumptions). If `radius-sm` (chips) looks off, confirm `calc(var(--radius) * 0.6)` ≈ 8.4px.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(ui): retheme token layer to Keystone (dark + light)"
```

---

## Task 2: Fonts — Nunito + JetBrains Mono

**Files:**

- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Swap the font imports and variables**

Replace lines 2–14 with:

```tsx
import { Nunito, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
```

- [ ] **Step 2: Update the `<html>` className and themeColor**

Change the `<html className=...>` to use the new variables:

```tsx
      className={`${nunito.variable} ${jetbrainsMono.variable} h-full antialiased`}
```

And update `viewport.themeColor` colors: light `#fafafa` → `#f6f6f8`, dark `#0d0d0f` → `#0e0e10`.

- [ ] **Step 3: Verify no remaining Geist references**

Run: `grep -rn "geist\|Geist" src/`
Expected: no matches (except possibly unrelated). If any component hard-codes `font-[--font-geist-*]`, update to `font-sans`/`font-mono`.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. Visually confirm Nunito renders (dev server) — headings should be rounder/heavier.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(ui): swap fonts to Nunito + JetBrains Mono"
```

---

## Task 3: `<Kicker>` primitive

**Files:**

- Create: `src/components/ui/kicker.tsx`
- Test: `src/components/ui/kicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kicker } from "./kicker";

describe("Kicker", () => {
  it("uppercases the label via class and renders children", () => {
    render(<Kicker>Updates</Kicker>);
    const el = screen.getByText("Updates");
    expect(el).toHaveClass("uppercase");
    expect(el.className).toContain("font-mono");
  });

  it("renders an accent index prefix with a separator when index is given", () => {
    render(<Kicker index="01">Sprint 24</Kicker>);
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("Sprint 24")).toBeInTheDocument();
    // separator " / " present in the accessible text
    expect(screen.getByText("01").parentElement).toHaveTextContent(
      "01 / Sprint 24",
    );
  });

  it("merges a custom className", () => {
    render(<Kicker className="mb-2">Files</Kicker>);
    expect(screen.getByText("Files")).toHaveClass("mb-2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- kicker`
Expected: FAIL ("Cannot find module './kicker'").

- [ ] **Step 3: Implement `kicker.tsx`**

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Keystone eyebrow label — mono, uppercase, wide tracking, dim `--kicker` color,
 * with an optional accent-colored index prefix ("01 / SPRINT 24"). Decorative;
 * keep it for section labels, not body content.
 */
export function Kicker({
  index,
  className,
  children,
}: {
  index?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-kicker font-mono text-[11px] font-medium tracking-[0.12em] uppercase",
        className,
      )}
    >
      {index ? (
        <>
          <span className="text-primary">{index}</span>
          {" / "}
        </>
      ) : null}
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- kicker`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/kicker.tsx src/components/ui/kicker.test.tsx
git commit -m "feat(ui): add Kicker eyebrow primitive"
```

---

## Task 4: `status-pill` geometry + hover polish

**Files:**

- Modify: `src/components/ui/status-pill.tsx` (the base `<span>` className, ~line 126)
- Modify: `src/components/ui/status-pill.test.tsx` (if it asserts `rounded-md`)

The `soft` variant already produces the Keystone translucent look; this only tightens geometry to the 8px chip radius and adds the pill hover motion.

- [ ] **Step 1: Update the test for the new geometry**

In `status-pill.test.tsx`, if a test asserts `rounded-md`, change the expectation to `rounded-sm`. Add a test that the `soft` variant class is applied:

```tsx
it("soft variant uses a translucent token fill", () => {
  render(
    <StatusPill color="green" variant="soft">
      Done
    </StatusPill>,
  );
  expect(screen.getByText("Done").className).toContain("bg-status-green/15");
});
```

- [ ] **Step 2: Run to verify current state**

Run: `pnpm test -- status-pill`
Expected: the new/changed assertions FAIL (still `rounded-md`).

- [ ] **Step 3: Update the base className**

Change the base span className (line ~126) from:

```tsx
"inline-flex max-w-full items-center truncate rounded-md px-2.5 py-0.5 text-xs font-medium",
```

to:

```tsx
"inline-flex max-w-full items-center truncate rounded-sm px-2.5 py-0.5 text-xs font-medium transition-[transform,filter] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
```

(No hover here — pills that are interactive add `hover:-translate-y-px hover:brightness-110` at their call site so static pills don't move. Document this in the component's JSDoc.)

- [ ] **Step 4: Run tests**

Run: `pnpm test -- status-pill`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/status-pill.tsx src/components/ui/status-pill.test.tsx
git commit -m "feat(ui): tighten status-pill to Keystone chip geometry"
```

---

## Foundation checkpoint

After Tasks 1–4: run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. All green before dispatching the surface wave. The app already looks Keystone-tinted (palette cascaded); surfaces now add structure.

---

## Task 5 (Surface A): Sidebar / shell reskin

**Files (modify + their `.test.tsx`):**
`src/components/shell/authenticated-shell.tsx`, `sidebar-nav.tsx`, `nav-section.tsx`, `workspace-switcher.tsx`, `user-menu.tsx`

**Reference:** spec §6.1. Behavior, roles, links, and data wiring must not change — this is class/structure only.

- [ ] **Step 1: Read all five components + their tests** to learn the current markup and which classes tests assert.

- [ ] **Step 2: Apply the Keystone translation** (per component):
  - **Nav items** (`sidebar-nav.tsx`, `nav-section.tsx`): idle `text-muted-foreground`; hover `hover:text-foreground hover:border-border` (add `border border-transparent rounded-md`); active `text-foreground bg-primary/10 border-primary/25`. Transitions via `transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`.
  - **Section labels**: replace ad-hoc uppercase labels with `<Kicker index="01">Navigate</Kicker>` / `<Kicker index="02">Boards</Kicker>`.
  - **Workspace switcher** (`workspace-switcher.tsx`): wrap trigger as a translucent card — `bg-surface-muted border border-border rounded-lg card-lift hover:border-border-bright`; the workspace square uses `bg-primary/[0.18] text-primary`.
  - **User chip** (`user-menu.tsx`): `border border-border rounded-lg card-lift hover:border-border-bright`; role line as `font-mono text-[10px] uppercase tracking-wide text-kicker`.
  - **Shell** (`authenticated-shell.tsx`): sidebar container `bg-sidebar border-r border-border`; ensure the main canvas is `bg-background`.

- [ ] **Step 3: Update tests** whose class assertions changed. Keep assertions on **semantic token classes** (`bg-primary/10`, `text-kicker`) or behavior, not raw hex.

- [ ] **Step 4: Gate this surface**

Run: `pnpm test -- shell && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/
git commit -m "feat(ui): reskin sidebar/shell to Keystone"
```

---

## Task 6 (Surface B): Board table reskin

**Files (modify + their `.test.tsx`):**
`src/components/boards/BoardHeader.tsx`, `BoardToolbar.tsx`, `BoardViews.tsx`, `ViewSwitcher.tsx`, `BoardTable.tsx`, `ColumnHeader.tsx`, `SummaryRow.tsx`, `FooterCell.tsx`, and `cells/*` as needed.

**Reference:** spec §6.2. Behavior (sort, DnD, inline edit, selection, virtualization) unchanged.

- [ ] **Step 1: Read the components + tests.** Note which cells render status pills and dates.

- [ ] **Step 2: Apply the Keystone translation:**
  - **Board head** (`BoardHeader.tsx`): `<Kicker>` breadcrumb (e.g. `BOARDS / <workspace> / <period>`); title `text-[22px] font-extrabold tracking-tight`.
  - **View tabs** (`BoardViews.tsx`/`ViewSwitcher.tsx`): pill tabs `rounded-full`; idle `text-muted-foreground`, hover adds `border-border`, active `bg-surface-muted border-border-bright text-foreground`.
  - **Toolbar** (`BoardToolbar.tsx`): search + buttons `rounded-full border border-border`, `focus-within:border-border-bright` / `hover:border-border-bright`. The **hero CTA** (`+ New item`) is the inverted ink-on-paper button: `bg-foreground text-background rounded-full font-extrabold shadow-glow-primary hover:-translate-y-0.5 transition`.
  - **Group head** (in `BoardTable.tsx`): `<Kicker index="01">Sprint 24</Kicker>` + group name in `text-primary` (first group) / `text-muted-foreground`.
  - **Table card**: `bg-surface border border-border rounded-lg overflow-hidden` + `card-lift`-style `hover:border-border-hover` (no translate on the table itself — border brighten only; use `transition-colors`).
  - **Column header** (`ColumnHeader.tsx`): `font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-kicker`.
  - **Rows** (`BoardTable.tsx`): `border-t border-border`; hover `hover:bg-white/[0.025] hover:border-border-hover` (dark) — use a token-safe approach: `hover:bg-foreground/[0.025]`. **Selected**: `bg-primary/[0.08]` + a 3px accent bar via a `::before` (left, inset 6px, `bg-primary rounded`); implement with a `relative` row + `before:` utilities.
  - **Cells**: status cells use `<StatusPill variant="soft" className="hover:-translate-y-px hover:brightness-110" />`; date cells `font-mono text-[11px] uppercase tracking-wide text-muted-foreground`, overdue `text-status-red`; progress bar fill `bg-primary`, track `bg-foreground/[0.07]`, number `font-mono text-muted-foreground`.
  - **Summary row** (`SummaryRow.tsx`, `FooterCell.tsx`): recessed `bg-foreground/[0.015] border-t border-border`; aggregates `font-mono text-[10px] uppercase tracking-wide text-kicker`.

- [ ] **Step 3: Update tests** whose class contracts changed (assert semantic classes/behavior).

- [ ] **Step 4: Gate this surface**

Run: `pnpm test -- Board && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/
git commit -m "feat(ui): reskin board table to Keystone"
```

---

## Task 7 (Surface C): Item panel reskin

**Files (modify + their `.test.tsx`):**
`src/components/boards/item-panel/ItemPanel.tsx`, `UpdatesTab.tsx`, `FilesTab.tsx`, `ActivityTab.tsx`, `ActivityRow.tsx`, `AttachmentCard.tsx`, `MentionTextarea.tsx`.

**Reference:** spec §6.3. Behavior (tab switching, mentions, uploads, realtime) unchanged.

- [ ] **Step 1: Read the components + tests.**

- [ ] **Step 2: Apply the Keystone translation:**
  - **Panel container** (`ItemPanel.tsx`): `bg-surface border-l border-border`.
  - **Panel head**: `<Kicker>ITEM / <group></Kicker>` + close; title `text-[17px] font-extrabold`; meta chips `border border-border rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-kicker` with the value in `text-foreground`.
  - **Tabs**: pill tabs like §6.2 view tabs; the count suffix in `font-mono text-primary`.
  - **Comments** (`UpdatesTab.tsx`): each update as `bg-surface-muted border border-border rounded-lg p-3.5 card-lift hover:border-border-bright`; author `font-extrabold`, timestamp `font-mono text-[9.5px] uppercase tracking-wide text-kicker`; `@mentions`/tags `text-primary font-bold`.
  - **Composer** (`MentionTextarea.tsx` host): input row `border border-border rounded-lg focus-within:border-border-bright`; Send action `text-primary font-extrabold`.
  - **Attachments/activity** (`AttachmentCard.tsx`, `ActivityRow.tsx`): cards `bg-surface-muted border border-border rounded-lg`; keep icons/behavior.

- [ ] **Step 3: Update tests** whose class contracts changed.

- [ ] **Step 4: Gate this surface**

Run: `pnpm test -- item-panel && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/item-panel/
git commit -m "feat(ui): reskin item panel to Keystone"
```

---

## Task 8: Integration verify + gates

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 2: Visual smoke-check (browser)**

Start dev (`pnpm dev -p 3001`), and in **both dark and light** confirm:

- Boards index + a board (table): kickers, translucent rows, selection accent bar, soft pills, hero CTA glow, brightening hairlines.
- My Work, Dashboards, Settings: palette cascaded cleanly, no unreadable text, no broken layout.
- Sidebar: nav active wash, workspace/user chips lift, section kickers.
- Item panel: comment cards lift, mono meta chips, accent tabs/send.
  Check: no horizontal overflow, no CLS on load, focus rings visible (periwinkle), reduced-motion honored.

- [ ] **Step 3: Contrast spot-check**

Confirm `--foreground` on each surface step and pill text (soft variant) meet AA. The `soft` variant is already token-derived AA; verify the retuned neutrals didn't regress.

- [ ] **Step 4: Finish**

Run: `scripts/finish-task.sh` (from the worktree). Then write the "How to test this" walkthrough.

---

## Self-Review (author)

- **Spec coverage:** §3 tokens → Task 1; §3.6 fonts → Task 2; §4 Kicker → Task 3; §5 pill → Task 4; §6.1/6.2/6.3 surfaces → Tasks 5/6/7; §7 motion/a11y → `.card-lift` (T1) + per-surface transitions + T8 checks; §8 perf → no data changes anywhere (verified: no query/Server-Action edits in any task); §9 testing → per-task tests + T8; §10 DAG → foundation (T1–4) → parallel (T5–7) → T8. ✅ All sections mapped.
- **Placeholder scan:** foundation tasks carry literal code; surface tasks carry exact file lists + exact class mappings (not "style appropriately"). Surface JSX isn't pre-written because subagents read each file first — the class-translation tables are the concrete spec. ✅
- **Type/name consistency:** `Kicker` props (`index`, `className`, `children`) used consistently in T5/T6/T7; `StatusPill variant="soft"` matches the existing API; token names (`text-kicker`, `border-border-hover`, `border-border-bright`, `shadow-glow-primary`, `bg-primary/10`) match the tokens defined in T1. ✅
