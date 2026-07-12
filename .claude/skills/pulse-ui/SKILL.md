---
name: pulse-ui
description: Use when building or styling any Pulse UI — React components, pages, shadcn primitives, board/table/kanban surfaces, item panels, forms, or anything visual — to apply Pulse's "Monolith Keystone" design system (dark-first monochrome + single periwinkle accent) and component conventions. Complements the generic frontend-design skill with this project's specific tokens, shadcn/Tailwind v4 patterns, and app primitives.
---

# Pulse UI — "Monolith Keystone"

Pulse's look is **dark-first, monochromatic chrome + one periwinkle accent** — Linear-grade
restraint applied to a colorful (Monday-style) category. The 2026-07 "Monolith Keystone"
reskin is the current system: near-black layered surfaces, hairline borders that **brighten**
(never thicken) on hover, mono uppercase kickers, near-zero shadows. Build on shadcn/ui +
Tailwind v4. Pair with the `frontend-design` skill for craft; this skill is the
project-specific source of truth. Ground truth for every value: `src/app/globals.css`.

## Core principle

**Chrome is strictly monochrome. Color is earned.** Navigation, surfaces, borders, and text
use neutrals only. The single brand accent — periwinkle `#8ea2eb` in dark, deepened `#5b6fd6`
in light for AA-on-white (`--brand` → `primary`/`ring`) — marks primary actions and focus.
The status palette is the _one_ sanctioned multi-color set, and only for status/label pills —
never for chrome. **Elevation is surface steps + hairlines, not shadows**
(`--elevation-card: none`).

## Design tokens (defined in `src/app/globals.css`, dark + light)

Always style with semantic tokens, never raw Tailwind colors (`bg-zinc-800`, `text-blue-500`
are forbidden in app code). Use the utility, not the CSS var, in JSX.

| Need                                 | Token / utility                                             | Notes (dark / light)                           |
| ------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------- |
| Page background                      | `bg-background` `text-foreground`                           | `#0e0e10` `#f4f4f6` / `#f6f6f8` `#1a1a1f`      |
| Raised surface (cards, panels)       | `bg-surface`                                                | `#161619` / `#fff`; `card`/`popover` map here  |
| Elevated / muted surface step        | `bg-surface-muted`                                          | `#1c1c20` / `#f1f1f4`                          |
| Sunken surface (summary rows, wells) | `bg-surface-sunken`                                         | same values as muted — semantic alias          |
| Secondary text                       | `text-muted-foreground`                                     | `#9a9aa2` / `#6b6b72`                          |
| Kicker / eyebrow text                | `text-kicker`                                               | dimmer than muted: `#6b6b72` / `#9a9aa2`       |
| Hairline divider / outline           | `border` (uses `--border`)                                  | `rgba(255,255,255,.10)` / `rgba(0,0,0,.08)`    |
| Hairline on hover (brighten!)        | `hover:border-border-hover`                                 | `.16` / `.14` alpha                            |
| Hairline, active/bright              | `border-border-bright`                                      | `.26` / `.22` alpha                            |
| Primary action / active              | `bg-primary text-primary-foreground`                        | periwinkle fill, **near-black text** in dark   |
| Focus ring                           | `ring-ring` / `focus-visible:ring-2`                        | brand-colored, AA visible                      |
| Subtle hover (chrome)                | `hover:bg-accent`                                           | monochrome gray, NOT brand                     |
| Brand (explicit)                     | `bg-brand` / `text-brand`                                   | alias of primary; prefer `primary`             |
| Accent glow (hero moments only)      | `shadow-glow-primary`                                       | white glow in dark, periwinkle-tinted in light |
| Keystone easing                      | `ease-keystone`                                             | `cubic-bezier(0.16, 1, 0.3, 1)`                |
| Status labels only                   | `bg-status-{gray,blue,green,yellow,orange,red,purple,teal}` | the only multicolor surface                    |

Radius: `--radius` is **0.875rem (14px)** — `rounded-lg` for cards/panels; `rounded-sm`
(~8px) for chips/pills. Shadows: `shadow-card` is `none`; `shadow-panel` is a soft large
blur for floating panels only. Spacing: 4px grid. Icons: **lucide-react**, `size-4` (16px)
inline, `size-3.5` in dense rows. `text-destructive` is allowed for danger actions/menu
items (semantic token, not raw color) — the only non-status color beyond the brand.

## Typography

- **UI + headings: Nunito Sans** (`font-sans`, weights 400–800 loaded; headings lean
  600–800). **Mono: JetBrains Mono** (`font-mono`, 400–600). Wired in `src/app/layout.tsx`
  as `--font-nunito-sans` / `--font-jetbrains-mono`. Geist is gone — do not reference it.
- **Kickers** are a Keystone signature: JetBrains Mono, uppercase, 11px, `tracking-[0.12em]`,
  `text-kicker`, optional index prefix ("01 / SPRINT 24"). Use the `<Kicker index="01">`
  primitive (`src/components/ui/kicker.tsx`) — don't hand-roll the recipe.
- Body/table text is `text-sm`/`text-xs`; board rows are dense (`ROW_HEIGHT = 36` in
  `BoardTable.tsx`).

## Signature interactions

- **Hairlines brighten, never thicken:** hover/focus moves `--border` → `--border-hover`
  (→ `--border-bright` for active). Never change border width on interaction.
- **Card lift:** interactive cards use the global `.card-lift` class (globals.css) —
  `translateY(-4px)` at 300ms `--ease-keystone`, hover-capable pointers only. Pills opt into
  motion with `hover:-translate-y-px hover:brightness-110`; static pills stay put.
- Built-in `animate-fadein` / `animate-slidein` keyframes exist for entrances.
  `prefers-reduced-motion` is handled globally — don't re-implement it.

## Status & priority color semantics (normative — keep consistent across the app)

`StatusColor` (union of the eight status tokens) and `STATUS_COLORS` are defined centrally
in `src/components/ui/status-pill.tsx` — import from there, never redeclare or invent
ad-hoc mappings.

| Domain concept                  | Color    |
| ------------------------------- | -------- |
| Done / success / on-track       | `green`  |
| In progress / active / info     | `blue`   |
| Not started / neutral / backlog | `gray`   |
| At risk / needs attention       | `yellow` |
| Blocked / overdue / stuck       | `red`    |
| Waiting / on hold               | `orange` |
| Review / QA                     | `purple` |
| Planning / discovery            | `teal`   |

Priority maps: `Low=gray`, `Medium=blue`, `High=orange`, `Urgent=red`. User-defined statuses
pick from this palette (Monday-style); these are the defaults for system states.

**Rendering pills — two sanctioned components, nothing else:**

- **`<StatusPill>`** (`src/components/ui/status-pill.tsx`) for the eight app-level
  `--status-*` tokens. `variant="solid"` (boards look, WCAG-precomputed near-black text) or
  `variant="soft"` (15% translucent tint + colored text). Never hand-roll
  `bg-status-* text-white` — white fails AA on the pale dark-mode fills.
- **`<ColorChip>`** (`src/components/ui/color-chip.tsx`) for **arbitrary user-chosen hexes**
  (board column options): 15% tint + per-theme text contrast-clamped by `softPillText()`
  (`src/components/boards/cells/soft-pill-color.ts`) so any hue clears AA in both modes.

Chip geometry is `rounded-sm px-2.5 py-0.5 text-xs font-medium` — matches Keystone's 8px
chip radius.

## Conventions

- **Server Components by default.** Add `"use client"` only for interactivity (state, effects,
  handlers, dnd, forms). Mutations go through Server Actions (RLS is the real boundary).
- **shadcn first.** Reuse `src/components/ui/*` (button, card, dialog, sheet, alert-dialog,
  dropdown-menu, popover, command, input, input-group, textarea, label, switch, separator,
  tooltip, avatar, calendar, chart, skeleton, sonner). Add more with
  `yes '' | pnpm dlx shadcn@latest add <name> -y`. Compose with `cn()` from `@/lib/utils`.
- **Theming:** class-based dark mode via next-themes (no-flash already wired in
  `providers.tsx`). **Dark is the default and primary theme**; light is the inverted "paper"
  variant. Never hardcode a theme; tokens handle both.
- **Motion:** Radix/shadcn built-in animations (dropdown, dialog, popover, tooltip) are the
  standard — don't re-wrap in Framer Motion. Reserve Framer for bespoke motion: side panels /
  drawers, drag feedback, optimistic transitions (150–300ms, `ease-keystone` or ease-out).
- **Touch:** the app is iPad-optimized — coarse pointers get 44px targets
  (`pointer-coarse:` variants), `<DragHandle>` + `<RevealOnHover>`
  (`src/components/ui/`) instead of hover-only affordances.
- **Accessibility (WCAG AA):** every interactive element keyboard-reachable, visible
  `focus-visible` ring, `aria-label`/`sr-only` text for icon-only controls, `aria-invalid` on
  errored fields. Monochrome + accent makes contrast tight — verify AA, don't convey state by
  color alone (pair status color with text/icon).
- **Density:** generous whitespace, but board/table surfaces are information-dense — 36px
  rows, hairline separators, truncation with tooltips.

## App primitives (all shipped — reuse, don't rebuild)

- **Shell:** `src/components/app-shell.tsx` (authed layout frame: sidebar + topbar),
  `src/components/sidebar.tsx`, `src/components/shell/*` (nav sections, workspace switcher),
  `src/components/command-palette.tsx` (⌘K), `src/components/theme-toggle.tsx`.
- **Keystone text primitives:** `src/components/ui/kicker.tsx` (`<Kicker>`),
  `src/components/ui/meta-chip.tsx` (`<MetaChip>` — mono `LABEL value` pairs).
- **Pills/chips:** `src/components/ui/status-pill.tsx` (`<StatusPill>`, `StatusColor`,
  `statusToneClasses`), `src/components/ui/color-chip.tsx` (`<ColorChip>`).
- **Boards:** `src/components/boards/BoardTable.tsx` (virtualized table),
  `KanbanBoard.tsx`, `CalendarBoard.tsx`, `GanttBoard.tsx`, `ViewSwitcher.tsx`,
  `BoardHeader.tsx`, `BoardToolbar.tsx`, `ColumnHeader.tsx`, `SummaryRow.tsx`.
- **Cells:** renderers in `src/components/boards/cells/index.tsx` (Text, Status/OptionPill,
  Person, Date, Number, …), inline editors in `src/components/boards/cells/editors/`,
  specialty cells (`FilesCell`, `RelationCell`, `MirrorCell`, `TimeTrackingCell`) alongside.
- **Item panel:** `src/components/boards/item-panel/ItemPanel.tsx` (+ Updates/Files/Activity
  tabs, `MentionTextarea`).
- **Support:** `src/components/ui/empty-state.tsx`, `skeleton.tsx`, `drag-handle.tsx`,
  `reveal-on-hover.tsx`, `src/components/ui/chart.tsx` (dashboards).

Each new primitive: one clear purpose, typed props, no cross-org data assumptions (data is
RLS-scoped server-side).

## Quick patterns

```tsx
// Status pill — import, don't hand-roll. Pair color with text (not color-only).
import { StatusPill } from "@/components/ui/status-pill";
<StatusPill color="green" variant="soft">
  On track
</StatusPill>;

// Arbitrary user option color (board column options):
import { ColorChip } from "@/components/ui/color-chip";
<ColorChip color={option.color}>{option.label}</ColorChip>;
```

```tsx
// Keystone section header: kicker + heading.
import { Kicker } from "@/components/ui/kicker";
<div>
  <Kicker index="01">Sprint 24</Kicker>
  <h2 className="text-lg font-bold">Board overview</h2>
</div>;
```

```tsx
// Surface card — hairline that BRIGHTENS on hover; lift only if interactive.
<div className="bg-surface hover:border-border-hover card-lift rounded-lg border p-4">
  …
</div>
```

**Row / cell density & menus:** icon-only row controls use a ghost `Button size="icon"` shrunk
to `size-7` (28px) — `pointer-coarse:size-11` for touch; wrap in a `Tooltip` for
discoverability. In a `DropdownMenu`, put a `DropdownMenuSeparator` before destructive items
and style those with `text-destructive`.

## Common mistakes

- Using raw colors (`bg-slate-50`, `text-indigo-600`) instead of semantic tokens. → tokens only.
- Referencing the old system: Geist font, indigo accent, `0.625rem` radius — all replaced by
  Keystone (Nunito Sans/JetBrains Mono, periwinkle, `0.875rem`).
- Adding box-shadows for elevation. → surface steps + hairlines; shadows are (near) zero.
- Thickening borders on hover/focus. → hairlines **brighten** (`border-hover`/`border-bright`).
- Hand-rolling a status/option pill (`bg-status-* text-white`). → `<StatusPill>` / `<ColorChip>`.
- Coloring chrome with the brand (vivid sidebars/headers). → chrome stays neutral; brand = actions/focus.
- `getSession()` for auth gating in UI. → use server `getUser()` (see auth/session helpers).
- Marking a whole file `"use client"` to use one handler. → push the client boundary to the leaf.
- Conveying status by color alone. → always add a label/icon (AA + colorblind).
- Hand-rolling a primitive that already ships. → check `src/components/ui/*` and the
  inventory above first.
