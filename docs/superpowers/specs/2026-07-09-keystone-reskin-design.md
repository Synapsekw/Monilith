# Keystone reskin — tokens + core surfaces

**Date:** 2026-07-09
**Status:** Approved (design) — pending spec review
**Branch:** `task/keystone-reskin`
**Related:** memory `dark-first-monday-reskin`; `vault/decisions/2026-06-16-decision-08-dark-first-monday-reskin.md`; prototype `ui-directions/2-monolith-keystone.html` (ephemeral scratchpad)

## 1. Goal

Land the **"Monolith Keystone"** visual direction in the app by (1) rethemeing the token
layer for **both dark and light** themes and (2) reskinning the three core surfaces — sidebar,
board table, and item panel — to match the chosen prototype. Ships as **one** `task/keystone-reskin`
worktree / one big-bang PR. Keystone is **dark-first** (the primary experience), but light gets a
coherent Keystone translation in the same task so both themes land together.

Non-goals (explicitly deferred to later waves): reskinning every secondary surface (calendar,
gantt, kanban internals, dashboards, settings forms, auth screens, onboarding). Those already
consume the tokens, so they shift palette automatically; bespoke Keystone polish for them is
future work.

## 2. Design language (from the prototype)

- **Surfaces by elevation step, not shadow.** Elevation is communicated by stepping the surface
  color (bg → surface → elevated) plus hairline borders — near-zero drop shadows. The one
  exception is a soft **white glow** on the single primary CTA.
- **Hairlines brighten, not thicken.** Borders are translucent white (dark) / translucent black
  (light). On hover/focus the border **brightens** (raises alpha) — width never changes.
- **Mono kickers.** Section/eyebrow labels are `JetBrains Mono`, uppercase, 11px, tracking
  `.12em`, in a dim `--kicker` color, optionally prefixed with an accent index (`01 / SPRINT 24`).
- **Type.** `Nunito` 600–800 for UI + headings; body 13.5px. Mono only for kickers, dates,
  counts, and code-like metadata.
- **Radius.** 14px for cards/panels/tables, 8px for chips/nav-items/pills.
- **Accent.** Periwinkle `#8ea2eb` replaces the old raw indigo `#6366f1` — used for active
  states, rings, progress fill, accent index numbers, selection wash/bar.
- **Primary CTA is "ink on paper," inverted.** Background = foreground color, text = background
  color (near-white button in dark, near-black button in light) + the white glow. This is the
  single loudest element and the only shadow in the system.
- **Signature motion.** `cubic-bezier(.16,1,.3,1)` easing; interactive cards lift
  `translateY(-4px)` over 300ms on hover; status pills lift `-1px` + brighten.

## 3. Token layer — `src/app/globals.css` + `src/app/layout.tsx`

The system is Tailwind v4 `@theme inline` with a `:root` (light) and `.dark` (dark) variable set
bound to shadcn semantics. Surfaces consume the semantic tokens (`--background`, `--surface`,
`--card`, `--border`, `--primary`, `--muted-foreground`, status/progress ramps), so a retheme
cascades app-wide automatically.

### 3.1 New tokens (both themes)

- `--kicker` — dim mono-label color (dark `#6b6b72`, light `#9a9aa2`).
- `--border-hover` — brightened hairline for hover (dark `oklch(1 0 0 / 0.16)`, light
  `oklch(0 0 0 / 0.14)`).
- `--border-bright` — strongest hairline for active/focus (dark `oklch(1 0 0 / 0.26)`, light
  `oklch(0 0 0 / 0.22)`).
- `--glow-primary` — the white CTA glow (dark `0 0 36px -6px rgba(255,255,255,.35)`; light a
  softer neutral glow).
- `--ease-keystone` — `cubic-bezier(.16, 1, .3, 1)` (promoted from the existing slidein easing).

These are exported through `@theme inline` as needed (`--color-kicker`, `--color-border-hover`,
`--color-border-bright`, `--shadow-glow-primary`, `--ease-keystone`) so surfaces can use
`text-kicker`, `border-border-hover`, `shadow-glow-primary`, etc.

### 3.2 `.dark` — Keystone dark palette

| Token                                                                      | Value (hex ref)         | OKLch                    |
| -------------------------------------------------------------------------- | ----------------------- | ------------------------ |
| `--background`                                                             | `#0e0e10`               | `oklch(0.145 0.004 285)` |
| `--surface` / `--card` / `--popover`                                       | `#161619`               | `oklch(0.185 0.004 285)` |
| `--surface-muted` / `--surface-sunken` / `--muted` / `--accent` (elevated) | `#1c1c20`               | `oklch(0.223 0.005 286)` |
| `--secondary`                                                              | `#26262c` (kept)        | `oklch(0.275 0.007 286)` |
| `--foreground` / `*-foreground`                                            | `#f4f4f6`               | `oklch(0.963 0.002 286)` |
| `--muted-foreground` (dim)                                                 | `#9a9aa2`               | `oklch(0.68 0.006 286)`  |
| `--kicker`                                                                 | `#6b6b72`               | `oklch(0.52 0.006 286)`  |
| `--border`                                                                 | `rgba(255,255,255,.10)` | `oklch(1 0 0 / 0.10)`    |
| `--input`                                                                  | `rgba(255,255,255,.14)` | `oklch(1 0 0 / 0.14)`    |
| `--brand` / `--primary` / `--ring`                                         | `#8ea2eb` periwinkle    | `oklch(0.72 0.11 274)`   |

Status palette stays the controlled multi-color set; keep the existing dark `--status-*` and
`--progress-*` values (they already read well on near-black and were AA-tuned in Batch A). Exact
OKLch values above are targets — the implementer confirms each with a hex→OKLch check and adjusts
lightness within ±0.01 to hit the reference hex.

### 3.3 `:root` — Keystone light palette

Light is the Keystone system inverted: near-white paper, dark ink, translucent **black**
hairlines that darken on hover, periwinkle accent, near-zero shadows.

| Token                                                           | Value (hex ref)   | Notes                                                                |
| --------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `--background`                                                  | `#f6f6f8`         | soft paper canvas                                                    |
| `--surface` / `--card` / `--popover`                            | `#ffffff`         | raised panels                                                        |
| `--surface-muted` / `--surface-sunken` / `--muted` / `--accent` | `#f1f1f4`         | recessed/elevated bands                                              |
| `--foreground`                                                  | `#1a1a1f`         | ink                                                                  |
| `--muted-foreground` (dim)                                      | `#6b6b72`         |                                                                      |
| `--kicker`                                                      | `#9a9aa2`         |                                                                      |
| `--border`                                                      | `rgba(0,0,0,.08)` | `oklch(0 0 0 / 0.08)`                                                |
| `--border-hover` / `--border-bright`                            | `.14` / `.22`     |                                                                      |
| `--brand` / `--primary` / `--ring`                              | periwinkle        | slightly deepened for AA on white where used as text/fill (see §3.4) |

Status/progress light ramps stay as-is (already AA-tuned).

### 3.4 Accent contrast rule

Periwinkle `#8ea2eb` is a **light** hue. Usage rules to preserve AA:

- As a **surface wash / border / ring / progress fill / accent index** → use `#8ea2eb` directly
  in both themes (decorative, not body text).
- As **filled-button background with text on top** → the primary CTA does **not** use periwinkle;
  it is the inverted ink-on-paper button (§2). So no periwinkle-bg + text pairing exists.
- If periwinkle is ever used as **text on a surface** (e.g. active nav label), dark theme uses
  `#8ea2eb` (passes on `#161619`); light theme uses a **deepened periwinkle** `--brand-strong`
  (≈`#5b6fd6`) to pass AA on white. Implementer adds `--brand-strong` per theme and uses it for
  periwinkle-as-text only.

### 3.5 Radius & shadow

- `--radius`: `0.625rem` → `0.875rem` (14px). The existing `radius-sm = calc(--radius * 0.6)` →
  ~8.4px covers chips/nav-items/pills; audit that no surface hard-codes a radius that now clashes.
- `--elevation-panel` / `--elevation-card`: collapse to hairline-only (near-zero; e.g.
  `0 1px 0 rgba(0,0,0,0)` or a `1px` inset hairline). `--shadow-glow-primary` carries the only
  real shadow.

### 3.6 Fonts — `src/app/layout.tsx` + `@theme`

- Replace `Geist` → `Nunito` (`weight` set incl. 600/700/800; `variable: --font-sans` binding).
- Replace `Geist_Mono` → `JetBrains_Mono` (`variable: --font-mono`).
- Update `@theme inline` `--font-sans` / `--font-mono` / `--font-heading` bindings to the new
  variables. Self-hosted via `next/font/google` → no external requests (CSP-safe), automatic
  `font-display: swap` + `size-adjust` (no CLS). Delete the now-unused Geist variable names.

## 4. New primitive — `<Kicker>` (`src/components/ui/kicker.tsx`)

```tsx
<Kicker index="01">Sprint 24</Kicker>   // → 01 / SPRINT 24  (mono, uppercase, tracking .12em)
<Kicker>Updates</Kicker>                 // → UPDATES
```

- Props: `index?: string` (accent-colored prefix + `/` separator), `children`, `className`.
- Renders a `<span>` (or `as` for flexibility) with mono/uppercase/tracking/`--kicker` color; the
  index number uses the accent color.
- Fully unit-tested (renders index, uppercases, applies classes). Consumed by board group heads,
  panel section labels, nav section labels, board-head breadcrumb.

## 5. `status-pill.tsx` retune

Retune the existing Batch A pill to the Keystone treatment: **15% translucent fill of the status
hue + the status hue (lightened) as text**, 8px radius, hover `translateY(-1px)` + `brightness`.
Preserve the current public API and status→color mapping; only the visual treatment changes.
Update `status-pill.test.tsx` for the new class contract. Re-verify AA of pill text on its own
translucent fill over the surface (extends the Batch A contrast work).

## 6. Surface reskins

Each surface consumes §3–§5 and must keep all existing behavior, data flow, a11y roles, and test
intent — this is a visual reskin, not a rewrite. Interaction handlers, keyboard nav, DnD, realtime,
and Server-Action wiring are untouched.

### 6.1 Sidebar / shell — `authenticated-shell`, `sidebar-nav`, `nav-section`, `workspace-switcher`, `user-menu`

- Wordmark with the keystone mark (angled-slab clip-path, ink-on-paper).
- Workspace switcher as a translucent `--surface-el` card, 14px radius, brighten + `-2px` lift on
  hover.
- Nav items: 8px radius, `--muted-foreground` idle → `--foreground` + hairline on hover; active =
  periwinkle wash (`~10%`) + periwinkle-tinted border + `--foreground` text.
- Section labels via `<Kicker>` (e.g. `01 / Navigate`, `02 / Boards`).
- User chip: bottom-anchored, avatar + name + mono role line (`OWNER / SYNAPSE`).

### 6.2 Board table — `BoardHeader`, `BoardToolbar`, `BoardViews`/`ViewSwitcher`, `BoardTable`, `ColumnHeader`, `cells/*`, `SummaryRow`, `FooterCell`

- Board head: `<Kicker>` breadcrumb + 22px/800 title.
- View tabs + toolbar: pill tabs (999px), search + toolbar buttons with brighten-on-focus
  hairlines, one inverted primary CTA (`+ New item`) carrying `--shadow-glow-primary`.
- Group head: `<Kicker>` (`01 / SPRINT 24`) + accent group name.
- Table card (`gtable`): 14px radius, hairline that brightens on hover; mono-uppercase column
  header row.
- Rows: translucent hover (`rgba(255,255,255,.025)` dark) + top-border brighten; **selected** =
  periwinkle wash + 3px accent bar (`::before`).
- Cells: translucent status pills (§5), accent progress bar + mono %, mono date (overdue → status
  red), priority dot+label.
- Summary row: recessed band, mono-uppercase aggregates, stacked status distribution bar.

### 6.3 Item panel — `boards/item-panel/*`

- Panel head: `<Kicker>` (`ITEM / SPRINT 24`) + close, 17px/800 title, mono meta chips
  (`Status Working`, `Due Jul 14`).
- Tabs: pill tabs with accent count (`Updates 02`).
- Body: comments as elevated `--surface-el` cards, 14px radius, hover `-4px` lift + brighten;
  author bold + mono timestamp; `@mentions`/tags in accent.
- Composer: input row with brighten-on-focus hairline + accent `Send`.

## 7. Motion & accessibility

- Card-lift + hairline-brighten transitions use `--ease-keystone`, 300ms. A shared utility
  (e.g. `.card-lift` in `globals.css` `@layer` or a Tailwind pattern) centralizes the hover
  transform so surfaces don't each re-declare it.
- The existing global `prefers-reduced-motion` block already neutralizes transforms/animations —
  verify the new lift/brighten respect it (they will, since they're CSS transitions).
- Contrast: `#f4f4f6` on `#161619`/`#1c1c20` and `#1a1a1f` on `#ffffff`/`#f1f1f4` pass AA for
  body; dim `--muted-foreground` reserved for secondary text only; `--kicker` reserved for
  non-essential eyebrow labels (large-enough tracking, decorative). Pill text AA re-checked (§5).
  Periwinkle-as-text follows §3.4.
- Focus-visible rings use `--ring` (periwinkle) at existing widths — unchanged behavior.

## 8. Performance & data budget (working agreement #5)

- **First paint vs interaction:** unchanged. This is pure presentation — **0 new server
  round-trips** on any interaction. No view/tab/filter/sort behavior changes; in-page toggles stay
  client-state + History API as before.
- **Server data:** no interaction added here changes server data. No Server Actions, queries,
  revalidation, or RSC navigation added or altered.
- **Hot-path reads:** unchanged — no new/removed queries; board reads stay bounded/indexed as-is.
- **Font cost:** Nunito + JetBrains Mono self-hosted via `next/font` (subset, `swap`,
  `size-adjust`) → no external requests, no CLS. Net asset delta is two small woff2 subsets
  replacing two others.

## 9. Testing strategy

- **Unit/RTL:** new `kicker.test.tsx`; update `status-pill.test.tsx` and any surface tests whose
  asserted class contracts change. Tests assert **behavior/roles/structure**, not exact color hex,
  to avoid brittle snapshots — where a class is asserted, assert the semantic token class
  (`bg-surface`, `text-kicker`) not a raw value.
- **Visual smoke-check:** drive the running app (browser) across **boards / my-work / dashboards /
  settings** in **both** dark and light, confirming the Keystone look and no layout breakage.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before
  `finish-task.sh`.

## 10. Execution DAG (working agreement #6)

**Interfaces**

- Foundation **produces:** Keystone tokens (both themes), fonts, radius/motion/shadow tokens,
  `<Kicker>`, retuned `status-pill`.
- Surfaces A/B/C **consume:** all of the above. They share no state and touch disjoint file sets,
  so they are mutually independent.

**Graph**

- **Batch 0 (serial, blocking):** Foundation (§3–§5).
- **Batch 1 (parallel, after Batch 0):** A Sidebar (§6.1) · B Board table (§6.2) · C Item panel
  (§6.3) — dispatched as concurrent subagents in the one worktree (disjoint files).
- **Batch 2 (serial):** integration smoke-check + gates + `finish-task.sh`.

**Critical path:** Foundation → max(A, B, C) → verify/gates. Foundation is the wall-clock floor's
head; the three surfaces collapse into one parallel wave.

## 11. Risks & mitigations

- **Hard-coded colors/radii in surfaces** bypassing tokens → grep for raw hex / `rounded-[` /
  `#` usages in the target components during each surface task; convert to tokens.
- **Translucent border regressions** — some components may assume a solid `--border`; verify
  nested translucent borders don't compound into muddy lines (use `--border` consistently, avoid
  stacking).
- **Font swap layout shift** — Nunito's metrics differ from Geist; rely on `next/font`
  `size-adjust`, and eyeball dense surfaces (board rows at 39px height, 13.5px body) for wrapping.
- **Light-mode accent contrast** — enforce §3.4 (`--brand-strong` for periwinkle-as-text).
- **Test brittleness** — assert semantic token classes/behavior, not raw hex (see §9).
