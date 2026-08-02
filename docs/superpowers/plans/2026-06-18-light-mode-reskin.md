# Light-mode Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Monolith's already-defined light-mode tokens a polished, WCAG-AA counterpart to the shipped dark theme across every surface — without redesigning dark.

**Architecture:** One pure helper (`pillTextColor`) gives DB-colored status/label pills a luminance-chosen text color (fixes both modes); CSS-only edits in `globals.css` give light mode real elevation, soft shadows, a custom scrollbar, and a readable chart ramp; a Playwright sweep in light mode verifies every surface and fixes what breaks. Default theme stays `dark`. No schema, migration, type regen, or new server round-trips.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (`@theme inline` + CSS custom props), shadcn/ui, next-themes, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-18-light-mode-reskin-design.md`

---

## File Structure

- **Create:** `src/lib/boards/contrast.ts` — pure color-contrast helper (parse hex → WCAG luminance → pick legible foreground). One responsibility.
- **Create:** `src/lib/boards/contrast.test.ts` — unit tests for the helper.
- **Modify:** `src/components/boards/cells/index.tsx` — `OptionPill` uses the helper, drops `text-white`.
- **Modify:** `src/components/boards/cells/editors/index.tsx` — `StatusEditor` + `DropdownEditor` option buttons use the helper, drop `text-white`.
- **Modify:** `src/components/boards/KanbanBoard.tsx` — group header pill uses the helper, drops `text-white`.
- **Modify:** `src/components/boards/item-panel/ActivityRow.tsx` — `Chip` uses the helper, drops `text-white`.
- **Modify:** `src/app/globals.css` — light-token polish (elevation, theme-scoped shadows, light scrollbar, light chart ramp).

`BoardTable.tsx` renders the group color as a borderless **dot** with no text — intentionally untouched.

---

## Task 1: Contrast helper (`pillTextColor`)

**Files:**

- Create: `src/lib/boards/contrast.ts`
- Test: `src/lib/boards/contrast.test.ts`

The helper returns the actual CSS color string (not a Tailwind class) so call sites set it inline alongside the existing `backgroundColor` style — keeping the pill's color logic in one place. It picks whichever of near-black / white has the **higher WCAG contrast ratio** against the pill background (best-effort legibility; no magic threshold). Unparseable input falls back to white = today's behavior.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/boards/contrast.test.ts
import { describe, it, expect } from "vitest";
import {
  pillTextColor,
  contrastRatio,
  LIGHT_FG,
  DARK_FG,
} from "@/lib/boards/contrast";

describe("pillTextColor", () => {
  it("uses dark text on white and white text on black", () => {
    expect(pillTextColor("#ffffff")).toBe(DARK_FG);
    expect(pillTextColor("#000000")).toBe(LIGHT_FG);
  });

  it("falls back to white on unparseable input (prior behavior)", () => {
    expect(pillTextColor("")).toBe(LIGHT_FG);
    expect(pillTextColor("not-a-color")).toBe(LIGHT_FG);
    expect(pillTextColor("#12")).toBe(LIGHT_FG);
  });

  it("supports 3-digit hex", () => {
    expect(pillTextColor("#fff")).toBe(DARK_FG);
    expect(pillTextColor("#000")).toBe(LIGHT_FG);
  });

  // Property: for every real palette color, it returns whichever foreground
  // actually has the higher contrast against that background.
  it("always picks the higher-contrast foreground for palette colors", () => {
    const palette = [
      "#00c875",
      "#fdab3d",
      "#e2445c",
      "#c4c4c4",
      "#808080",
      "#6366f1",
      "#8b5cf6",
      "#38bdf8",
      "#ec4899",
      "#14b8a6",
      "#f97316",
    ];
    for (const bg of palette) {
      const chosen = pillTextColor(bg);
      const other = chosen === LIGHT_FG ? DARK_FG : LIGHT_FG;
      expect(contrastRatio(bg, chosen)).toBeGreaterThanOrEqual(
        contrastRatio(bg, other),
      );
    }
  });

  it("flips pale fills (e.g. grey) to dark text so they stay legible", () => {
    expect(pillTextColor("#c4c4c4")).toBe(DARK_FG);
    expect(pillTextColor("#fdab3d")).toBe(DARK_FG);
  });

  it("keeps white text on the brand indigo", () => {
    expect(pillTextColor("#6366f1")).toBe(LIGHT_FG);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/boards/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/boards/contrast"` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/boards/contrast.ts
/**
 * Legible text color for a solid color-chip ("pill") background.
 *
 * Status/dropdown/group pills store a user-chosen hex in the DB and render it
 * as the pill background. White text was hardcoded for the vivid dark palette,
 * but fails on light fills (and on pale colors in either mode). This picks
 * whichever of near-black / white has the higher WCAG contrast ratio against
 * the background — theme-agnostic, and robust for arbitrary user colors.
 */

/** White foreground (unchanged from prior behavior). */
export const LIGHT_FG = "#ffffff";
/** Near-black foreground (not pure #000 — softer on the eye). */
export const DARK_FG = "#1a1a1d";

/** Parse `#rgb` / `#rrggbb` → [r,g,b] in 0–255, or null if unparseable. */
function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== "string") return null;
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance (0–1) of an sRGB color. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1–21) between two hex colors. Unparseable → 1. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick a legible text color for a solid pill of background `bg`.
 * Returns the higher-contrast of {@link DARK_FG} / {@link LIGHT_FG}.
 * Unparseable input → {@link LIGHT_FG} (prior behavior).
 */
export function pillTextColor(bg: string): string {
  if (!parseHex(bg)) return LIGHT_FG;
  return contrastRatio(bg, DARK_FG) >= contrastRatio(bg, LIGHT_FG)
    ? DARK_FG
    : LIGHT_FG;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/boards/contrast.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/contrast.ts src/lib/boards/contrast.test.ts
git commit -m "feat(reskin): luminance-based pill text-color helper"
```

---

## Task 2: Wire the helper into pill render sites

**Files:**

- Modify: `src/components/boards/cells/index.tsx:19-29` (`OptionPill`)
- Modify: `src/components/boards/cells/editors/index.tsx` (`StatusEditor` ~line 154, `DropdownEditor` ~line 200 — the two `style={{ backgroundColor: o.color }}` buttons)
- Modify: `src/components/boards/KanbanBoard.tsx:286-292` (group header pill)
- Modify: `src/components/boards/item-panel/ActivityRow.tsx:12-19` (`Chip`)

For each site: import `pillTextColor`, remove the `text-white` class token, and add `color: pillTextColor(<hexVar>)` to the existing inline `style`.

- [ ] **Step 1: Update `OptionPill` in `cells/index.tsx`**

Add the import at the top of the file (after the existing import):

```tsx
import type { ColumnOption } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";
```

Replace the `OptionPill` function body (lines 20-29):

```tsx
function OptionPill({ option }: { option: ColumnOption }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-md px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: option.color,
        color: pillTextColor(option.color),
      }}
    >
      {option.label}
    </span>
  );
}
```

- [ ] **Step 2: Update `StatusEditor` + `DropdownEditor` in `cells/editors/index.tsx`**

Add the import near the other `@/lib/...` imports:

```tsx
import { pillTextColor } from "@/lib/boards/contrast";
```

In `StatusEditor`, the option `<button>`: remove `text-white` from `className` and add `color` to `style`:

```tsx
<button
  key={o.id}
  type="button"
  role="option"
  aria-selected={selected === o.id}
  onClick={() => onCommit({ optionId: o.id })}
  className="focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
  style={{ backgroundColor: o.color, color: pillTextColor(o.color) }}
>
  {o.label}
</button>
```

In `DropdownEditor`, the option `<button>`: remove `text-white` from the `cn(...)` base string and add `color` to `style`:

```tsx
<button
  key={o.id}
  type="button"
  role="option"
  aria-selected={isSelected}
  onClick={() => toggle(o.id)}
  className={cn(
    "focus-visible:ring-ring inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-opacity focus-visible:ring-2 focus-visible:outline-none",
    isSelected ? "opacity-100" : "opacity-60 hover:opacity-90",
  )}
  style={{ backgroundColor: o.color, color: pillTextColor(o.color) }}
>
  {o.label}
</button>
```

- [ ] **Step 3: Update the Kanban group header pill in `KanbanBoard.tsx`**

Add the import with the other `@/lib/...` imports at the top of the file:

```tsx
import { pillTextColor } from "@/lib/boards/contrast";
```

Replace the colored-header `<span>` (the `column.color` branch, lines ~287-292):

```tsx
{column.color ? (
  <span
    className="inline-flex items-center truncate rounded-md px-2 py-0.5 text-xs font-medium"
    style={{ backgroundColor: column.color, color: pillTextColor(column.color) }}
  >
    {column.label}
  </span>
) : (
```

- [ ] **Step 4: Update the `Chip` in `ActivityRow.tsx`**

Add the import after the existing import:

```tsx
import type { ActivityDescriptor } from "@/lib/collaboration/activity";
import { pillTextColor } from "@/lib/boards/contrast";
```

Replace the colored `<span>` in `Chip` (lines 12-19):

```tsx
return (
  <span
    className="rounded px-1.5 py-0.5 text-xs font-medium"
    style={{ backgroundColor: value.color, color: pillTextColor(value.color) }}
  >
    {value.label}
  </span>
);
```

- [ ] **Step 5: Verify no other hardcoded `text-white` on a DB color remains**

Run: `grep -rn "text-white" src/components/boards`
Expected: no remaining matches that sit on a `style={{ backgroundColor: ... }}` element. (If a new one is found, route it through `pillTextColor` the same way.)

- [ ] **Step 6: Typecheck + run the existing board test suites**

Run: `pnpm typecheck && pnpm test -- src/components/boards src/lib/boards/contrast.test.ts`
Expected: typecheck clean; tests PASS. (Snapshot/DOM tests that asserted `text-white` on pills, if any, must be updated to assert the inline `color` style instead — fix them to match the new markup.)

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/cells/editors/index.tsx src/components/boards/KanbanBoard.tsx src/components/boards/item-panel/ActivityRow.tsx
git commit -m "feat(reskin): pills pick legible text color by luminance"
```

---

## Task 3: Light-token polish in `globals.css`

**Files:**

- Modify: `src/app/globals.css` (`@theme inline` shadow block ~80-82, `:root` ~109-164, `.dark` ~166-226, `@layer base` scrollbar ~238-256)

CSS-only. Four changes: theme-scoped shadows, off-white page elevation, light chart ramp, light scrollbar. No JS, no token renames that consumers reference (the `shadow-panel`/`shadow-card`/`chart-*` utility names stay).

- [ ] **Step 1: Make `--shadow-panel` / `--shadow-card` theme-scoped**

In `@theme inline`, change the two static shadow lines (currently lines 81-82) to reference per-mode vars:

```css
/* Elevation — values set per theme in :root / .dark (see below) */
--shadow-panel: var(--elevation-panel);
--shadow-card: var(--elevation-card);
```

In `:root` (add near the `--radius` line), the soft light-mode values:

```css
--elevation-panel: 0 8px 24px rgba(0, 0, 0, 0.08);
--elevation-card: 0 1px 2px rgba(0, 0, 0, 0.06);
```

In `.dark` (add near its `--sidebar-ring` line), the existing heavy values:

```css
--elevation-panel: 0 8px 30px rgba(0, 0, 0, 0.5);
--elevation-card: 0 1px 3px rgba(0, 0, 0, 0.4);
```

- [ ] **Step 2: Give light mode a real elevation hierarchy**

In `:root`, change the page background from pure white to faint off-white so the white `--surface`/`--card`/`--popover` lift off it. Change line 114:

```css
--background: oklch(0.985 0 0);
```

Leave `--surface`, `--card`, `--popover` at `oklch(1 0 0)` (white) — they now read as raised. (`--surface-muted` stays `0.97`, `--sidebar` stays `0.985`.)

- [ ] **Step 3: Darken the light-mode chart ramp**

The grayscale `--chart-1..5` light end washes out on white. In `:root` only (NOT `.dark`), replace lines 149-153:

```css
--chart-1: oklch(0.72 0 0);
--chart-2: oklch(0.58 0 0);
--chart-3: oklch(0.46 0 0);
--chart-4: oklch(0.34 0 0);
--chart-5: oklch(0.22 0 0);
```

Leave the `.dark` chart ramp unchanged (light-on-dark already reads).

- [ ] **Step 4: Add a light-mode custom scrollbar**

In `@layer base`, immediately BEFORE the existing `.dark *` scrollbar rules (after the `html { @apply font-sans; }` block, ~line 237), add a light counterpart scoped to `html:not(.dark)` so it never collides with the dark rules:

```css
/* Light-mode scrollbar — neutral thumb on the page canvas. */
html:not(.dark) * {
  scrollbar-color: oklch(0.82 0 0) transparent;
}
html:not(.dark) ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
html:not(.dark) ::-webkit-scrollbar-track {
  background: transparent;
}
html:not(.dark) ::-webkit-scrollbar-thumb {
  background: oklch(0.82 0 0);
  border: 2px solid var(--background);
  border-radius: 6px;
}
html:not(.dark) ::-webkit-scrollbar-thumb:hover {
  background: oklch(0.72 0 0);
}
```

- [ ] **Step 5: Verify build picks up the CSS (no syntax errors)**

Run: `pnpm build`
Expected: production build succeeds (Tailwind compiles `globals.css` with no errors).

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(reskin): light-mode elevation, soft shadows, scrollbar, chart ramp"
```

---

## Task 4: Full light-mode verification sweep

**Files:** none changed unless the sweep surfaces a defect (then fix at the responsible component/token and re-check).

Drive the running app in **light mode** with Playwright, screenshot each surface, eyeball legibility + AA, and fix what breaks. Use the project's existing Playwright e2e harness/auth setup (see `e2e/`) as the driver; force light mode by setting `localStorage["pulse-theme-v2"] = "light"` before load (or click the ThemeToggle → Light).

- [ ] **Step 1: Start the dev server**

Run (background): `pnpm dev`
Expected: app serves on its dev port (default `http://localhost:3000`).

- [ ] **Step 2: Drive + screenshot each surface in light mode**

Using Playwright (webapp-testing skill), authenticate via the existing e2e setup, set light theme, and capture a screenshot of each:

- Public landing (`/`)
- Auth (sign-in / sign-up) and onboarding
- Boards: Table, Kanban, Calendar, Timeline/Gantt (`?view=`)
- Item panel (`?item=`): Updates, Files, Activity tabs
- Dashboards: canvas + each widget — Number/KPI, Chart (bar + pie), Battery, List (+ filter editor)
- Chrome: sidebar + topbar, expanded AND collapsed; notifications bell
- ⌘K command palette

Save screenshots to a scratch dir (e.g. `/tmp/light-sweep/`).

- [ ] **Step 3: Inspect each screenshot against the checklist**

For every surface confirm: body/muted text contrast OK; on-pill text legible (Task 1–2 effect); focus rings visible; status never color-only (label/icon present); borders + card elevation legible on the off-white page; nothing invisible or blown-out; no dark-only assumption leaking (e.g. an element that vanishes on white).

- [ ] **Step 4: Fix any defects found**

For each issue, fix at the correct layer — a token in `globals.css` (preferred, fixes broadly) or the specific component if it hardcoded something. Re-screenshot the affected surface to confirm. Repeat until the checklist passes on every surface. Record notable fixes for the session note.

- [ ] **Step 5: Full verification gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four green.

- [ ] **Step 6: Commit any fixes from the sweep**

```bash
git add -A
git commit -m "fix(reskin): light-mode verification sweep fixes"
```

(Skip if the sweep found nothing to fix.)

---

## Self-Review (completed during planning)

- **Spec coverage:** §2 pill helper → Tasks 1–2; §3 token polish (elevation, shadows, scrollbar, chart ramp) → Task 3; §4 verification sweep → Task 4; §5 gate → Task 4 Step 5. All covered.
- **Type consistency:** `pillTextColor` / `contrastRatio` / `LIGHT_FG` / `DARK_FG` names used identically in the helper, its test, and all four call sites.
- **No placeholders:** every code step shows the actual code; every command shows expected output.
- **Perf/data budget:** no server round-trips, queries, Server Actions, migrations, or type regen introduced — confirmed presentational-only.
