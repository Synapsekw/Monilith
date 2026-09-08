# UI polish + theme presets — design

**Date:** 2026-09-08
**Status:** approved (owner answered scope questions in-session; spec written for the plan)

## Why

An audit of `src/components/` + `src/app/` (three explore agents, code-only — Chrome extension
was not connected so no screenshots) found the token discipline is strong (0 raw Tailwind
colors, 0 unlabeled icon buttons, 0 touch-target gaps) but six visible inconsistencies remain,
and the owner reported the light-mode nav reads "washed out". The owner also asked for a way
to change theme colors and chose **full theme presets** (accent + neutral tint + wash), not
accent-only.

## Scope (six tracks)

| Track | Name                      | User-visible?                              |
| ----- | ------------------------- | ------------------------------------------ |
| A     | Light-mode nav fix        | Yes — light chrome, kickers, active item   |
| B     | Theme presets             | Yes — Settings → Preferences → Theme       |
| C     | PageHeader + Kicker       | Yes — consistent headings on every route   |
| D     | AA pills, radius, shadows | Yes — subtle                               |
| E     | Loading / error states    | Yes — skeletons + boundaries               |
| F     | Landing + stale brand hex | Yes on `/landing`; charts; no-op elsewhere |

Out of scope: per-organization theme enforcement, free hex picker, `viewport.themeColor`
meta per preset, themed emails (emails keep the Keystone default hex, centralized).

---

## Track A — light-mode nav washout

### Diagnosis (from `globals.css` + `app-shell.tsx` + `sidebar-nav.tsx`)

The sidebar and topbar are `transparent`; their color is entirely the `.app-wash` gradient.
Four stacked causes, all in light `:root`:

1. **Chrome vs content card separation ≈ 1.10:1** (dark ≈ 1.47:1). Wash top stop `#e3e7f6`
   abuts the white `--content-surface`.
2. **Light `--app-bloom` is a no-op.** Commit `6f878f5a` (2026-08-27) set the bloom color
   (`rgb(226 232 250 / 55%)`) to the same value as the first wash stop, so it composites to a
   ~1/255 shift. Dark gets a real 22% brand bloom; light gets a flat pastel.
3. **`--kicker` light `#9a9aa2` ≈ 2.5:1** on the chrome. Commit `88878691` lifted
   `--muted-foreground` but left `--kicker` on the rejected value; `globals.contrast.test.ts`
   only guards `--muted-foreground`.
4. **Active nav item barely reads**: `bg-primary/10 border-primary/25` on periwinkle-tinted
   ground. `--state-selected` exists (`globals.css:233`) but the nav does not use it.
   Hairlines (`--border` 8% black, `--content-edge` 7%) are near-invisible on the chrome.

### Fix

- Light `--app-bloom`: a genuinely lighter, brand-derived source so the gradient has visible
  falloff and presets inherit it — e.g.
  `color-mix(in oklab, var(--brand) 12%, white)` at ~70% alpha, mirroring the dark recipe's
  shape; first wash stop may deepen slightly (`#dde2f2`) so the bloom has range. Target:
  header-band chrome (bloomed) vs `--content-surface` ≥ **1.15:1**.
- Light `--kicker` → ≈ `#6e6e77` (≥ 4.5:1 on every light wash stop). Dark `--kicker`
  stays (verify ≥ 4.5:1 under bloom; lift to ≈ `#8a8a93` if not).
- Light `--content-edge` → `rgb(0 0 0 / 12%)`.
- `sidebar-nav.tsx` active state (expanded + collapsed): `bg-state-selected border-primary/40
text-foreground` in both themes; hover keeps `hover:border-border`. Light `--state-selected`
  bumps to 14% brand (dark stays 14%).
- Extend `globals.contrast.test.ts`: add `--kicker` cases mirroring the `--muted-foreground`
  ones (light stops; dark stops unbloomed + bloomed), and one assertion that light
  chrome-vs-card contrast ≥ 1.15.

Files: `src/app/globals.css`, `src/components/shell/sidebar-nav.tsx`,
`src/app/globals.contrast.test.ts`. No data changes.

---

## Track B — theme presets

### Model

A **preset** is a named palette that overrides a small **seed** set of tokens in each mode;
everything else in `globals.css` already derives from those seeds (`--primary`, `--ring`,
`--sidebar-primary`, `--state-selected`, dark `--app-bloom` alias `--brand`).

Seed tokens per mode (light `:root` / dark `.dark`):

| Token                                                                                                                                                | Role                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--brand`, `--brand-foreground`                                                                                                                      | accent + AA text on it                                                                                                |
| `--app-wash`                                                                                                                                         | 3-stop chrome gradient                                                                                                |
| `--app-bloom`                                                                                                                                        | `color-mix(in oklab, var(--brand) N%, transparent)` — light becomes brand-derived too (Track A sets the light recipe) |
| `--background`, `--surface`, `--surface-muted`, `--surface-sunken`, `--card`, `--popover`, `--secondary`, `--muted`, `--accent`, `--content-surface` | neutral tint (surfaces)                                                                                               |
| `--foreground`, `--muted-foreground`, `--kicker`                                                                                                     | neutral tint (text)                                                                                                   |
| `--glow-primary` (light only)                                                                                                                        | brand-tinted glow                                                                                                     |

Status palette, file palette, chart palette, borders, radii: **not** part of a preset.

### Presets (v1)

| id         | Label    | Accent (dark / light) | Neutral cast            |
| ---------- | -------- | --------------------- | ----------------------- |
| `keystone` | Keystone | periwinkle (current)  | cool violet (current)   |
| `graphite` | Graphite | neutral gray accent   | pure gray, no blue cast |
| `ocean`    | Ocean    | teal                  | cool teal-gray          |
| `forest`   | Forest   | emerald               | green-gray              |
| `ember`    | Ember    | amber                 | warm gray               |
| `rose`     | Rose     | rose                  | warm pink-gray          |

`keystone` is the default and is the **unmodified** `:root` / `.dark` blocks — no CSS
override block. Exact hexes are chosen by the implementer and **proven** by the contrast test
(below); the constraint set is the spec, not the numbers.

### CSS

Per non-default preset, two override blocks in `globals.css` after `.dark`:

```css
:root[data-theme-preset="ocean"] {
  /* light seeds */
}
.dark[data-theme-preset="ocean"] {
  /* dark seeds */
}
```

Attribute lives on `<html>` beside next-themes' `dark` class. Specificity beats the base
blocks; no `!important`.

### Source of truth + drift guard

- `src/lib/theme/presets.ts` (no `"use client"`, importable anywhere):
  `THEME_PRESETS = [{ id, label, swatch: { light, dark } }]`, `ThemePresetId` union,
  `DEFAULT_THEME_PRESET = "keystone"`, `THEME_PRESET_STORAGE_KEY = "pulse-theme-preset"`,
  `KEYSTONE_BRAND_HEX = { light: "#5b6fd6", dark: "#8ea2eb" }` (for emails / non-CSS
  consumers).
- `src/lib/theme/presets.test.ts` parses `globals.css`: every non-default preset id has both
  override blocks; every override block's id exists in `THEME_PRESETS`; each block declares
  exactly the seed token set (parity across presets).
- `globals.contrast.test.ts` iterates every preset × mode using the preset's own
  `--muted-foreground`, `--kicker`, wash stops, bloom, `--content-surface`, and adds:
  `--brand-foreground` on `--brand` ≥ 4.5:1; `--brand` on `--content-surface` ≥ 3:1
  (non-text UI contrast); `--foreground` on `--surface` ≥ 7:1.

### Persistence + no-flash

- Migration (`scripts/new-migration.sh profiles_theme_preset`):
  `alter table public.profiles add column theme_preset text not null default 'keystone'
check (char_length(theme_preset) <= 32);`. No enum in the DB — Zod is the boundary; an
  unknown stored value falls back to `keystone` on read. Applied to DEV via `supabase-dev`
  MCP with the committed version + name, then `pnpm db:ledger-check`, then regenerate types
  (MCP `generate_typescript_types` + prettier — `pnpm db:types` fails in a worktree).
- Zod: `updateProfileThemePresetSchema = z.object({ themePreset: z.enum(ids) })` in
  `src/lib/validations/profile.ts`.
- Server Action `updateProfileThemePreset` in `src/lib/profile/actions.ts`, mirroring
  `updateProfileTimezone` (getUser → RLS update self → `updateTag(profileTag(user.id))`).
- Cached read `getUserThemePresetCached(userId)` in `src/lib/profile/queries-cached.ts`
  (`"use cache"`, `cacheLife("nav")`, `cacheTag(profileTag(userId))`), normalizing unknown
  values to the default.
- **No-flash:** inline `<script>` in `src/app/layout.tsx` `<head>` (before paint) reads
  `localStorage[THEME_PRESET_STORAGE_KEY]` and sets `data-theme-preset` when it is a known id
  (the id list is inlined as a literal into the script string from `THEME_PRESETS`; wrapped in
  try/catch). Same pattern next-themes uses for the `dark` class.
- **Cross-device sync:** `<ThemePresetSync preset={promise}>` client component mounted once in
  `AuthenticatedShell` and once in `ask/layout.tsx` (both frames), receiving the cached read
  as an unawaited promise like the timezone; on resolve, if the server value differs from the
  attribute, apply it + write localStorage. Server wins.
- **Applying a change:** `useThemePreset()` hook (`src/lib/theme/use-theme-preset.ts`) sets
  the attribute + localStorage synchronously (0 round-trips for the visual change), then
  calls the Server Action in a transition; on failure, revert + toast.

### UI

- `src/components/settings/theme-preset-form.tsx`: a radiogroup of six swatch tiles (two-tone
  swatch: chrome tint + accent dot, label under, current one `border-border-bright`), same
  visually-hidden-radio recipe as `AppearanceForm`. Coarse pointer ≥ 44px tiles.
- Mounted in `settings/preferences/page.tsx` as a new `SettingRow` "Theme" under
  "Appearance". Header `ThemeToggle` unchanged.
- Existing hardcoded periwinkle consumers pick up the preset: `light-rays.tsx` /
  `monolith-scene.tsx` read `getComputedStyle(document.documentElement)
.getPropertyValue("--brand")` at mount (Track F).

### Performance budget

First paint: attribute set by inline script, zero extra requests. Switching: 0 RSC
round-trips for the visual change, 1 Server Action write. Read is one indexed `profiles`
row by PK, cached per user.

---

## Track C — `PageHeader` primitive + Kicker migration

- New `src/components/ui/page-header.tsx`: `<PageHeader kicker? index? title description?
actions?>` renders `<Kicker>` (optional) + `<h1 className="font-heading text-lg
font-semibold tracking-tight">` + optional description (`text-muted-foreground text-sm`) +
  right-aligned actions slot. Server component.
- Migrate the 13 top-level route headers (boards, my-work, goals, portfolios, workload, time,
  dashboards, reports, board detail, settings section title, updates, admin pages) to it.
  `updates/page.tsx` drops its inline `nunito.className`. `/ask` gains no heading (the
  composer is the surface). `BoardHeader.tsx` keeps its dense `h-7` row but adopts the same
  `text-lg font-semibold` type ramp.
- Replace the 39 hand-rolled uppercase-tracking kickers with `<Kicker>`; where the site is a
  table column header or a dense `text-3xs` label, add `size="xs"` to `Kicker` rather than
  keeping a bespoke class string.
- Test: `page-header.test.tsx` (renders h1, kicker, actions); grep-guard in
  `status-pill.test.tsx`-style: no `uppercase` + `tracking-` class combos outside
  `kicker.tsx` / `page-header.tsx` in `src/` (allowlist for the landing module).

## Track D — AA pills, radius, shadows

- Replace `bg-status-red text-white` at `cells/index.tsx:341`, `editors/index.tsx:249` with
  `<StatusPill color="red" variant="solid">`; `FileTypeChip.tsx:58` and
  `PresenceRing.tsx:52` use the precomputed solid-pill foreground (`statusToneClasses`) —
  never `text-white`.
- Fold the 8 inlined soft-pill recipes (`SmartFillGrid`, `ConfirmStep`, `MapStep`,
  `MappingGrid` ×3, `cells/index.tsx:203`, `GanttRowItem`) into `<StatusPill variant="soft">`.
- Radius: unify on `rounded-lg` (14px). Change `ui/card.tsx` and `ui/dialog.tsx` /
  `ui/alert-dialog.tsx` from `rounded-xl`; migrate the 32 admin/feedback/platform sites;
  `app-shell.tsx` / `ask/layout.tsx` `<main>` keep `rounded-xl` (the content card is
  deliberately the one larger radius — document in pulse-ui skill).
- Shadows: remove the 5 static `shadow-sm` (feedback segmented control uses
  `bg-surface-muted border-border-bright` for the active segment; `PresenceFlashMessage`,
  `PresenceRing`, `PdfPreview` drop it). Floating bars (`BoardBulkBar`, `BoardTableInner:717`,
  `MentionTextarea` popover) → `shadow-panel`. Drag-lift `shadow-lg` (7 sites) → a new
  `shadow-drag` token (`--shadow-drag`, defined light + dark) so the intent is named.
- Add `--shadow-drag` to `globals.tokens.test.ts` registered list.

## Track E — loading / error states

- `(app)/boards/[boardId]/loading.tsx`: real skeleton — header row, toolbar, 8 table rows
  matching `ROW_HEIGHT = 36`.
- New `loading.tsx` for `ask`, `ask/[conversationId]`, `updates`,
  `(app)/boards/[boardId]/reports`, `(app)/boards/[boardId]/reports/[reportId]`, `(auth)`
  group (one shared minimal card skeleton).
- New `error.tsx` for `admin` and `ask` segments (same shape as `(app)/error.tsx`).
- `Composer.tsx`: surface a failed turn (inline `FieldStatus`-style error under the composer
  with retry), never silent.
- Tests: each new `loading.tsx` renders (smoke, like `admin/loading.test.tsx`); Composer
  error path test.

## Track F — landing + stale brand hex

- `monolith-hero.module.css`: replace zinc hexes with tokens (`var(--foreground)`,
  `var(--muted-foreground)`, `var(--background)`, `var(--brand)`), keeping the dark look by
  reading the dark tokens (the landing is rendered under the `dark` class; if the theme is
  light, it now correctly inverts instead of hardcoding). `landing-agent-mocks.tsx:30` inline
  glow → `shadow-glow-primary`.
- `light-rays.tsx` / `monolith-scene.tsx`: default color read from `--brand` at mount
  (fallback `KEYSTONE_BRAND_HEX.dark`).
- `chart-theme.ts`: `SPECTRUM_STOPS` / `SPECTRUM_SOLID` → `--chart-spectrum-1..3` tokens
  derived from `--brand` via `color-mix` (light + dark), registered in `@theme inline`.
- `briefing-render.ts` email hex → import `KEYSTONE_BRAND_HEX.light` from
  `src/lib/theme/presets.ts` (value unchanged; test unchanged).
- `DocxPreview.tsx` / `PreviewPane.tsx`: wrapper gets `bg-surface-muted`; the document iframe
  body stays white (it is paper).

---

## Execution DAG

- **A** independent. **C**, **D**, **E** independent of everything. **F** depends on **B**
  (imports `KEYSTONE_BRAND_HEX`, `--chart-spectrum` follows the preset seeds). **B** depends
  on **A** (A finalizes the light wash/bloom/kicker recipe that every preset copies; both edit
  `globals.css`).
- **Batch 1 (parallel):** A, C, D, E.
- **Batch 2:** B (after A merges).
- **Batch 3:** F (after B merges).
- Critical path: A → B → F.
- Shared-file risk: `globals.css` (A, B, D adds `--shadow-drag`, F adds spectrum tokens) —
  D's token addition is a 4-line block; merge A, then D, then B, then F, serialized by the
  orchestrator. `globals.tokens.test.ts` touched by A? no; by D (+`--shadow-drag`), by B (no —
  preset blocks are separate selectors). `globals.contrast.test.ts` touched by A then B.

## How to test (per track, for the closing walkthrough)

- **A:** pull `develop`, run dev, switch header toggle to Light. Sidebar shows a visible
  light-to-lavender gradient from top-left; "BOARDS"/"DASHBOARDS" kickers legible; the active
  nav item has a clear tinted fill; a visible edge separates chrome from the white card.
- **B:** Settings → Preferences → Theme: six tiles; click "Ocean" — accent, chrome tint and
  surfaces change instantly with no reload; reload → persists; open in a second browser →
  same preset after sign-in; Light/Dark toggle still works with every preset.
- **C:** every top-level page header has the same size/weight; goals/portfolios/admin show a
  mono kicker above the title.
- **D:** board Priority "Critical" pill is red with dark text in dark mode; admin cards have
  the same corner radius as board cards.
- **E:** open a heavy board with throttled network — table skeleton appears; `/ask` shows a
  skeleton; break an admin page (dev only) — segment error boundary, not the root one.
- **F:** `/landing` in Light theme inverts cleanly; dashboard spectrum chart follows the
  chosen preset accent.
