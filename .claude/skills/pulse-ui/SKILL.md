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

**Dark chrome is neutral, lightly tinted by the theme. Light chrome is the preset's gradient
with white text. Color is still earned.** In dark mode, navigation, surfaces, borders, and text
are neutrals that take a small brand tint through the **reach** layer (see "Theme reach" below)
— never a hand-picked colour. In light mode the chrome around the white content card is the
**bold frame**: a saturated mid-tone gradient of the preset's own hues, and everything painted
on it is white (see "Chrome scope" below). The frame's colour comes from the preset's wash, never
from a component — you still do not colour chrome by hand in either mode. The content card and
every raised surface stay neutral in both modes. The single brand accent — periwinkle `#8ea2eb`
in dark, deepened `#5a6ed5` in light for AA-on-white (`--brand` → `primary`/`ring`) — marks
primary actions and focus.
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
| App chrome wash                      | `app-wash` (class on the shell root)                        | dark lean + mesh bloom / the bold frame        |
| Secondary text                       | `text-muted-foreground`                                     | `#b2b2ba` / `#5b5b62`; white on light frame    |
| Kicker / eyebrow text                | `text-kicker`                                               | EQUALS muted-foreground; mono/caps carry it    |
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

**Light-mode notes for the wash.** The dark `--muted-foreground` is tuned for AA on the bloomed
wash. The light value is tuned for AA on the content card and raised surfaces only — it never
meets the light wash, because on the light frame (inside `chrome-scope`, see below) the same
utilities resolve to white: `text-foreground` is white, `text-muted-foreground` and `text-kicker`
are white at 90%, borders and `ring-ring` are white alphas, and `bg-primary` is a white fill with
brand-coloured text.

Radius: `--radius` is **0.875rem (14px)** — `rounded-lg` for cards/panels; `rounded-sm`
(~8px) for chips/pills. The app-shell content card (`app-shell.tsx` / `ask/layout.tsx`) is
the **only** `rounded-xl` surface in the app — everything else is `rounded-lg`. Shadows:
`shadow-card` is `none`; `shadow-panel` is a soft large blur for floating panels only;
`shadow-drag` is the named lift for a row/card actively being dragged — never a raw
`shadow-sm/md/lg/xl`. Spacing: 4px grid. Icons: **lucide-react**, `size-4` (16px)
inline, `size-3.5` in dense rows. `text-destructive` is allowed for danger actions/menu
items (semantic token, not raw color) — the only non-status color beyond the brand.

## Theme presets

Users pick a preset in Settings → Preferences → Theme. There are seventeen, in this order:
the two single-accent presets `keystone` (default) and `graphite`; the three hand-seeded
two-accent ("gradient") presets `aurora`, `sunset`, `nebula`; and twelve generated two-accent
presets `lagoon`, `tropic`, `orchid`, `peach`, `glacier`, `dusk`, `berry`, `candy`, `citrus`,
`prism`, `mocha`, `neon`. A preset is **not** a third mode — it re-seeds accent, neutral tint
and chrome wash _inside_ light or dark, via `[data-theme-preset]` on `<html>`. Registry:
`src/lib/theme/presets.ts`; CSS blocks live after `.dark` in `globals.css` (`keystone` has
none — it IS `:root`/`.dark`).

`ocean`, `forest`, `ember` and `rose` were removed on 2026-11-14. A stored value is aliased at
read time by `resolveThemePresetId` (`ocean` → `lagoon`, `forest` → `tropic`, `ember` → `peach`,
`rose` → `orchid`); there is no database migration. Read a stored preset through that function,
never through `isThemePresetId` alone.

**Seed-token rule:** an override block declares ONLY the seed set (brand, `--brand-2`,
surfaces, text, `--app-wash`, `--content-surface`, plus `--glow-primary` in light).
`--app-bloom` is **not** a seed: it is three radials derived once per mode (in `:root` and in
`.dark`) from `--brand`, `--brand-2` and `--brand-mid`, so every preset gets its mesh bloom for
free. `--brand-mid` is derived too (the sRGB midpoint of the two accents) and only `prism`
declares its own. Never redeclare alpha tokens (`--border`, `--state-*`, `--chrome-fill`),
brand-derived ones (`--primary`, `--ring`, `--brand-gradient`, `--app-bloom`) or the `--base-*`
aliases — they follow. Component code never reads a preset — style with the same semantic
tokens and every preset works for free.

**New presets are generated, not hand-written.** Add a row to `NEW_PRESETS` in
`scripts/theme/gen-presets.mjs`, run `node scripts/theme/gen-presets.mjs presets`, and paste
its output into `globals.css` (both blocks) and `presets.ts` (the `THEME_PRESETS` entry). The
script solves each light wash stop to be as light as it can be while white chrome text still
clears AA under the preset's own bloom (including muted text on the resting `bg-chrome-fill`
of a chip or kbd — never darken a wash to pay for a fill; lower the fill's alpha in the scope
and `CHROME_FILL_ALPHA` together), keeps every bloom radial visible on every stop
(≥ 1.12:1), makes the three stops descend in lightness, and pulls dark amber wash hues to burnt
orange so they do not go brown. `scripts/theme/gen-presets.test.mjs` fails when the shipped CSS
or registry stops reproducing from the script, `presets.test.ts` enforces the exact token set,
and `globals.contrast.test.ts` re-runs every AA check per block. **Fix a failing preset by
changing its row or the recipe in the script and regenerating — never by hand-editing a hex.**
The light washes of the five older presets come from the same solver (`BASE_WASHES`, printed by
the `base` command).

## Second accent and the brand gradient

`--brand-2` is a seed token. Single-accent presets set it equal to `--brand`; the gradient
presets set a second hue. `--brand-gradient` has **three stops** — `--brand`, `--brand-mid`,
`--brand-2` — and because `--brand-mid` defaults to the midpoint, it paints the same pixels a
two-stop gradient would for every preset except `prism`, which bends through a third hue. The
utility `bg-brand-gradient` (hover `hover:bg-brand-gradient-hover`) is sanctioned in exactly
four places: the primary `Button` fill, the active sidebar indicator, progress-bar fills, and
the chart spectrum. `--ring`, links and text stay on `--brand`. Do not add a fifth use without
a spec.

In light mode, on the frame, the sidebar indicator and a primary button are **white**, not the
gradient: a brand gradient on a brand-coloured wash would disappear, so the chrome scope
re-seeds `--brand-gradient` to white there. The components did not change — they still use
`bg-brand-gradient`. The wash itself is built from the seeds by the generator, not from the
utility, so it is not a fifth use.

The primary button's hover image is a token too: `--brand-gradient-hover`, derived once in
`:root` (the three stops at 80% alpha). The chrome scope re-seeds it to **opaque white**, so a
primary button on the light frame does **not** change its fill on hover. That is deliberate:
the label there is the preset's brand, tuned to about 4.5:1 on pure white, so any translucent
step lets the frame through and fails the label (80% measured 3.1:1; even 99% fails in
Keystone). Never give a button on the frame a translucent white hover.

## Chrome scope

The light wash is saturated and mid-tone, so the ordinary dark-on-light tokens are unreadable
on it. Two classes in `globals.css` (the "Bold frame" section) fix that without any component
reading a chrome value:

- **`chrome-scope`** goes on every element painted **directly on the wash**: today the sidebar
  rail, the shell header band, the board dock, the rail and header in `ask/layout.tsx`, and
  the card seam (`CardSeam` — it lies over the card's outline but lights against the frame,
  so its lit line and haze are white in light mode; its opaque cap carries `chrome-reset`).
  Inside it the generic tokens are re-seeded — text, borders, ring, hover/selected fills and
  "the brand" all become white (muted text is white at 90%, the destructive red becomes a pale
  red). Everything inside keeps using `text-foreground`, `text-muted-foreground`,
  `border-border`, `bg-state-hover`, `bg-primary` and so on.
- **`chrome-reset`** goes on every **opaque surface nested inside a scope** — a dock card, the
  composer, an avatar fallback. It hands the root values back (captured on `:root` as `--base-*`
  aliases), so the surface's contents are dark-on-light again.

Rules:

- A new element on the wash needs `chrome-scope`. A new `bg-surface` / `bg-card` /
  `bg-background` box inside the sidebar, header or dock needs `chrome-reset`. A shared card
  that can render both in the dock and on the content card carries `chrome-reset` always — the
  class is inert outside a scope.
- Both classes are **light-only** (`:root:not(.dark) …`). In dark mode neither declares
  anything, so never use them to change the dark look.
- Components never read `--base-*` or any chrome value directly, and never branch on "am I in
  the chrome". If a token is missing from the scope, add it to the scope **and** the reset in
  `globals.css` (`globals.contrast.test.ts` checks the two lists agree).
- Anything portalled to `<body>` — menus, popovers, dialogs, tooltips, the mobile drawer — is
  **outside** the scope and keeps the normal tokens, even when its trigger is in the sidebar.
- The scope's `color` lives in `@layer base`, so a text utility on the same element still wins.
- **A translucent hover on a `chrome-reset` surface must be `dark:`-prefixed** (or absent).
  Inside the reset `hover:bg-state-hover` is the root's black 4%, which replaces the opaque
  fill and leaves dark content on the coloured frame (the avatar fallback did this).
- **A tint tile on a chrome fill does not work on the frame**: `bg-primary/[0.18] text-primary`
  on `bg-chrome-fill` is a white glyph on stacked white alphas (3.5–4.2:1). Use a solid
  `bg-primary text-primary-foreground` in light and keep the tint behind `dark:`.
- Secondary text may sit on `bg-chrome-fill` (9% white in the scope): muted and kicker text on
  it are asserted ≥ 4.5 for every preset. Do not stack a second white fill under text.
- Loading blocks inside a scope use `<Skeleton variant="chrome">`, never the opaque default.
- **Print:** in `@media print` the scope hands every token back to its `--base-*` value and
  the light wash is dropped, so the chrome prints dark-on-paper. A token added to the scope
  goes in **three** lists: the scope, the reset, and the print fallback (plus its `--base-*`
  alias). `globals.contrast.test.ts` and `print-styles.test.ts` check they agree.
- Known limitation: secondary (muted) text inside a **selected** sidebar row in light mode is
  about 4.07:1 at worst, under AA, and no test asserts it. Do not add more muted text to
  selected rows on the frame without fixing that first.
- Known limitation, open: a **Mono's name tint** mixes the Mono's colour towards the scope's
  white foreground, so on the light frame the seven default palette colours measure about
  3.3–5.0:1 at worst (four of them under 4.5) and a dark custom colour can be far lower. Not
  fixed, and no test asserts it.

## Theme reach

A third axis next to mode and preset: `<html data-theme-reach="subtle|vivid">`, absent =
`tinted` (the default). Registry and helpers live in `src/lib/theme/presets.ts`
(`THEME_REACH_IDS`, `applyThemeReach`); the user control is Settings → Preferences → Theme
reach. Reach mixes `--brand` into the content card, raised surfaces and hover as a DERIVED
layer in `globals.css` (`--reach-content`, `--reach-surface`, `--reach-hover`,
`--reach-selected`, `--reach-glow`),
so component code never reads it — keep using `bg-content-surface`, `bg-surface`, `bg-card`,
`hover:bg-accent` and every level works for free.

- `subtle` is the pre-reach look: every derived token resolves to its seed.
- Never paint a surface with a raw seed in an arbitrary value (`bg-[var(--card)]`,
  `[background:…var(--surface)]`) — that bypasses reach. Use the utility or `var(--color-card)`.
- `--chart-1..5` and `--chart-cat-1..6` follow the brand at `tinted`/`vivid` and fall back to
  the old greys/hues at `subtle`. `--chart-cat-1` is the brand; `--chart-cat-2..6` are 60°
  rotations of the brand's hue (`oklch(from var(--brand) L C calc(h + N))`, fixed in-gamut L/C,
  behind `@supports`), so the six are distinct in every preset. Status-coloured series keep
  status colours.
- `--reach-selected` (12%) strengthens `bg-state-selected` so a selected row always out-lifts
  a hovered one (≥ 1.5×). Dark `vivid` is content 8% / surface 7% — the two must climb
  together or cards sink into the page.
- Reach values are pinned by `globals.contrast.test.ts` (text AA on every surface, and the
  light chrome/card separation floor). Light mode's content tint is deliberately weaker than
  dark's. Change a value only with that test green for every preset × mode × reach.

## Typography

- **UI + headings: Inter** (`font-sans`, weights 400–800 loaded; headings lean
  600–800 with `-0.02em` tracking at display sizes). **Mono: JetBrains Mono**
  (`font-mono`, 400–600). Wired in `src/app/layout.tsx` as `--font-inter` /
  `--font-jetbrains-mono`. Nunito Sans is gone from the UI; Nunito 800 survives
  ONLY as the MONOLITH wordmark face in `src/lib/fonts.ts` — do not unify it.
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
  `providers.tsx`). **Dark is the default and primary theme**; light is a white "paper"
  content card inside the preset's bold coloured frame. Never hardcode a theme; tokens handle
  both.
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
- **Mascot:** `src/components/brand/mono.tsx` (`<Mono mood="idle"|"happy">`) — empty states
  and the Ask page only; never in tables, toolbars or dialogs.
- **Delight:** `src/components/ui/done-burst.tsx` (`fireDoneBurst`, `celebrateStatusEdit`) and
  the `animate-pill-pop` utility — gated by the user's "Celebrate completed items" preference
  (`<html data-celebrate>`) and by reduced motion.
- **Support:** `src/components/ui/empty-state.tsx` (optional `mascot` / `title` / `actions`), `skeleton.tsx`, `drag-handle.tsx`,
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
- Referencing the old system: Nunito Sans font, indigo accent, `0.625rem` radius — all replaced by
  Keystone (Inter/JetBrains Mono, periwinkle, `0.875rem`).
- Adding box-shadows for elevation. → surface steps + hairlines; shadows are (near) zero.
- Thickening borders on hover/focus. → hairlines **brighten** (`border-hover`/`border-bright`).
- Hand-rolling a status/option pill (`bg-status-* text-white`). → `<StatusPill>` / `<ColorChip>`.
- Coloring chrome with the brand by hand (a `bg-brand` sidebar or header). → dark chrome stays
  neutral and the light frame comes from the preset's wash; brand = actions/focus.
- Painting an opaque surface inside the sidebar or dock without `chrome-reset` → white text on a
  white surface in light mode.
- Putting a new element on the wash without `chrome-scope` → dark text on a saturated frame in
  light mode.
- Hand-editing a hex in a generated preset block. → change `scripts/theme/gen-presets.mjs` and
  regenerate.
- `getSession()` for auth gating in UI. → use server `getUser()` (see auth/session helpers).
- Marking a whole file `"use client"` to use one handler. → push the client boundary to the leaf.
- Conveying status by color alone. → always add a label/icon (AA + colorblind).
- Hand-rolling a primitive that already ships. → check `src/components/ui/*` and the
  inventory above first.
