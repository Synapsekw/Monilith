---
type: spec
status: approved
date: 2026-06-18
phase: RS
title: Light-mode reskin
tags: [project/pulse, spec, reskin, theming, a11y]
related:
  - "[[2026-06-16-decision-08-dark-first-monday-reskin]]"
  - "[[00-north-star]]"
---

# Light-mode reskin — design

## 1. Goal & context

The dark-first reskin shipped and is user-verified (RS workstream). Its counterpart, **light
mode**, is the pending half. Per ADR-08, light mode "stays fully supported but secondary" — but it
has never been polished or AA-verified against the shipped surfaces.

Crucially, **the light tokens already exist** in `src/app/globals.css` `:root` (a complete OKLch
set — white background, dark foreground, the same status palette, indigo brand accent), and the
`next-themes` toggle already switches between them (default `dark`, `storageKey` `pulse-theme-v2`).
So this is **not** authoring a new palette from scratch — it is a **finishing pass**: make the
existing light tokens a polished, legible, WCAG-AA counterpart to dark across every shipped surface.

**Default theme stays `dark`.** No change to theme-switch mechanics.

Non-goals: no redesign of the dark theme, no new components, no palette re-theming of dark, no
data-model or schema changes, no migration, no type regen.

## 2. The one real code change — dynamic pill foreground

### Problem

Status / dropdown / group "pills" store a **user-chosen hex color in the DB** (per
`ColumnOption.color`, `groups.color`) and render it inline via `style={{ backgroundColor }}` with a
**hardcoded `text-white`** className. White text was chosen for the vivid dark palette. On light
surfaces (and for any pale user-picked color in either mode), white-on-light fails WCAG AA, and pale
fills (e.g. `#c4c4c4`) nearly vanish.

### Solution — luminance-based text color (theme-agnostic)

A pure helper computes the pill background's relative luminance and picks the legible foreground:

- New module `src/lib/boards/contrast.ts`:
  - `pillTextColor(hex: string): "light" | "dark"` — parse `#rgb`/`#rrggbb`, compute WCAG relative
    luminance (sRGB → linearized), return `"dark"` (use near-black text) when the background is
    light, `"light"` (use white text) when dark. Threshold tuned so AA holds for the status palette
    and graceful for arbitrary input. Invalid/missing hex → safe default (`"light"`, i.e. current
    behavior).
  - Expose the concrete foreground as a small mapping (e.g. a `cn()`-friendly className pair or a
    style value) so call sites stay terse. Keep one source of truth — no per-call-site logic.
- Solid fill is **kept**; only the text (and the small leading dot, where present) flips. The
  pill's visual identity is unchanged; it just becomes legible.

### Call sites to update (drop hardcoded `text-white`, use the helper)

Per the theming map:

- `src/components/boards/cells/index.tsx` — `OptionPill`
- `src/components/boards/cells/editors/index.tsx` — `StatusEditor` and `DropdownEditor` option buttons
- `src/components/boards/KanbanBoard.tsx` — group/column header pill
- `src/components/boards/item-panel/ActivityRow.tsx` — activity status/label chip
- `BoardTable.tsx` group color **dot** has no text → **untouched**.

(If any other site is found rendering a DB color with `text-white` during implementation, it routes
through the same helper.)

### Tests

- Unit test `pillTextColor` with table-driven known inputs: the 8 seeded status hexes, the 11
  template hexes (`templates.ts`), `column-defaults.ts` defaults, white, black, mid-gray, invalid
  input. Assert each returns the AA-correct choice.

## 3. Light token polish (`globals.css :root`)

CSS-only edits, scoped to `:root` (and the `@theme`/`.dark` shadow split). No JS.

1. **Elevation hierarchy.** Today `--background`, `--surface`, `--card`, `--popover` are all pure
   white — there is no layering; separation relies entirely on borders. Introduce a faint off-white
   page `--background` (e.g. `oklch(~0.985 0 0)` / very light neutral) so white
   `--surface`/`--card`/`--popover` _lift_ off the page, mirroring dark's base→surface→elevated
   story. Keep the hairline `--border`. Verify `--sidebar` still reads as a distinct rail.
2. **Shadows.** Make `--shadow-panel` / `--shadow-card` theme-scoped instead of single global
   values tuned for dark. Light uses soft low-alpha shadows (`rgba(0,0,0,~0.06–0.10)`); dark keeps
   its existing heavy values. (Mechanically: define light values in `:root` and override in `.dark`,
   keeping whatever `@theme` wiring exposes them as utilities.)
3. **Scrollbar.** Add a light counterpart to the `.dark`-only custom scrollbar styling (light track
   - neutral thumb), so light mode isn't left with the raw browser default.
4. **Chart ramp.** The grayscale `--chart-1..5` is shared across modes; the light end (`~0.87`)
   washes out on white. Tune the light ramp darker so Number/Chart/Battery/List widgets read with
   adequate contrast on white surfaces.

`dark:` Tailwind variants in shadcn primitives are correct (they shade theme tokens) and are **left
as-is**.

## 4. Full verification sweep (evidence before "done")

Drive the app with Playwright in **light mode** (toggle via the ThemeToggle / set theme), screenshot
each surface, eyeball legibility + AA, and fix what breaks. Surfaces:

- Public **landing** page
- **Auth** (sign-in/up) and **onboarding**
- **Boards:** Table, Kanban, Calendar, Timeline/Gantt
- **Item panel:** Updates, Files, Activity tabs
- **Dashboards:** the canvas + every widget — Number/KPI, Chart (bar/pie), Battery, List (incl.
  filter editor)
- **Chrome:** sidebar + topbar, both **expanded and collapsed**; inbox/notifications bell
- **⌘K command palette**

Checks per surface: text contrast (body, muted, on-pill), focus rings visible, status never
conveyed by color alone (label/icon present), borders/elevation legible, no invisible/over-bright
elements, no dark-only assumption leaking through.

Screenshots are the completion evidence; record notable fixes.

## 5. Non-functional

- **Performance & data-fetching budget:** purely presentational. **0 new server round-trips.** No
  data-fetching, no Server Actions, no RSC navigation changes, no new queries. The pill helper is
  pure render-time client compute over data already loaded. No migration, no `db:types` regen, no
  advisors run needed (no schema touch).
- **Accessibility:** WCAG AA is the bar for the changed surfaces; the pill helper exists precisely
  to guarantee on-pill contrast for arbitrary colors.
- **Branch / workflow:** all work on `develop` (no feature branch). Subagent-driven per the working
  agreement — the main thread holds the plan and runs verification/synthesis.
- **Done gate:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green **and** the
  light-mode screenshot evidence captured + reviewed, before any completion claim.

## 6. Risks / notes

- Light off-white `--background` must not muddy the monochrome-restraint look — keep it _barely_
  off-white; white surfaces do the lifting.
- The luminance threshold is the one tunable; pick it so the seeded status palette passes AA in both
  modes, then confirm visually.
- Already-created boards with dark-tuned custom colors are handled automatically by the dynamic text
  helper — no data migration needed.
