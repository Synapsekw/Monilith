# Theme variety — twelve gradient presets, mesh wash, bold light frame

**Date:** 2026-11-14
**Status:** Draft — awaiting owner review
**Prototype:** https://claude.ai/artifact/Jho9BfQoAhyb9RuMKZUe3p (palette gallery, wash and light-direction switches)
**Builds on:** `2026-11-12-visual-refresh-design.md` (reach, second accent), `2026-09-08-ui-polish-and-theme-presets-design.md`

## 1. Problem

The three gradient presets shipped on 2026-11-12 (Aurora, Sunset, Nebula) are the ones the owner
likes. The four older coloured presets (Ocean, Forest, Ember, Rose) are a single flat hue and now
look plain beside them. Light mode is a pale tinted wash around a white card and reads as washed
out in every preset.

## 2. Decisions (owner, 2026-11-14)

| #   | Decision                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Twelve new presets ship**: Lagoon, Tropic, Orchid, Peach, Glacier, Dusk, Berry, Candy, Citrus, Prism, Mocha, Neon. Prism is three-colour; the rest are two-colour. |
| 2   | **Ocean, Forest, Ember and Rose are removed.** Keystone (default) and Graphite stay as the two single-colour presets.                                                |
| 3   | **Mesh blooms** replace the single bloom on the chrome wash, in both modes and every preset.                                                                         |
| 4   | **Bold frame** is the light-mode look for every preset: a saturated gradient chrome with white text around the white content card.                                   |

Result: 17 presets — Keystone, Graphite, Aurora, Sunset, Nebula and the twelve new ones.

Decision 4 changes the default light look for every light-mode user, including people who never
picked a preset. Dark mode changes only by the mesh blooms.

## 3. Scope

In scope:

- Chrome scope tokens and the bold light frame
- Mesh bloom derivation
- A middle gradient stop (`--brand-mid`) and the Prism preset
- Twelve preset blocks (light and dark) and registry entries
- Removal of four presets with a read-time alias so nobody falls back to the default
- Settings picker update
- Rule updates in the `pulse-ui` skill, an ADR, a changelog entry

Out of scope:

- Custom accent colour (still needs a runtime contrast clamp)
- Changing reach percentages. Reach keeps its three levels and current values.
- A database migration rewriting stored preset ids (the alias covers it; see 4.5)
- Landing page, auth pages and email colours

## 4. Design

### 4.1 Chrome scope (the mechanism behind the bold frame)

Sidebar, header and dock components style themselves with the ordinary semantic utilities
(`text-foreground`, `text-muted-foreground`, `border-border`, `bg-state-hover`,
`bg-state-selected`, `bg-chrome-fill`). On a saturated wash those dark-on-light values are
unreadable, so the tokens need different values on the chrome than on the content card, without
touching component code.

A new set of chrome tokens is declared once in `:root` and once in `.dark`. They are not seed
tokens; preset blocks must not redeclare them.

| Token                       | Light (bold frame)       | Dark                       |
| --------------------------- | ------------------------ | -------------------------- |
| `--chrome-foreground`       | `#ffffff`                | `var(--foreground)`        |
| `--chrome-muted-foreground` | white, alpha set by AA   | `var(--muted-foreground)`  |
| `--chrome-border`           | `rgb(255 255 255 / 16%)` | `var(--border)`            |
| `--chrome-border-hover`     | `rgb(255 255 255 / 26%)` | `var(--border-hover)`      |
| `--chrome-border-bright`    | `rgb(255 255 255 / 40%)` | `var(--border-bright)`     |
| `--chrome-hover`            | `rgb(255 255 255 / 10%)` | the current hover value    |
| `--chrome-selected`         | `rgb(255 255 255 / 20%)` | the current selected value |
| `--chrome-ring`             | `#ffffff`                | `var(--brand)`             |
| `--chrome-indicator`        | `#ffffff`                | `var(--brand-gradient)`    |
| `--chrome-fill` (existing)  | `rgb(255 255 255 / 14%)` | unchanged                  |
| `--chrome-scrollbar-thumb`  | `rgb(255 255 255 / 28%)` | `var(--scrollbar-thumb)`   |

A `.chrome-scope` class in `globals.css` maps the generic tokens onto these for its subtree:
`--foreground`, `--muted-foreground`, `--kicker`, `--border`, `--border-hover`, `--border-bright`,
`--ring`, `--scrollbar-thumb`, plus the resolved hover and selected fills. The class goes on the
elements painted directly on the wash: the sidebar rail, the shell header, the board dock aside,
and the equivalent elements in `ask/layout.tsx`. The content card, and anything portaled to
`<body>` (menus, popovers, dialogs, the mobile drawer), is outside the scope and keeps the normal
tokens.

In dark mode every chrome token resolves to today's value, so dark is unchanged by this unit.

The active sidebar indicator moves from `bg-brand-gradient` to `--chrome-indicator`, because a
brand gradient on a brand-coloured wash disappears. This is the only component edit besides
adding the class.

### 4.2 Bold light wash

Each light preset block's `--app-wash` becomes a saturated three-stop gradient from the preset's
first hue to a deeper tone of its second, replacing the pale wash. Keystone and Graphite get one
too (periwinkle into deep indigo; steel into charcoal). The content card stays white with the
existing reach tint.

The stops are bound by contrast, not taste: `--chrome-foreground` and `--chrome-muted-foreground`
must clear AA 4.5:1 on every wash stop with the mesh bloom at its peak. In practice the wash sits
darker than the light `--brand`.

Light `--muted-foreground` was tuned against the old pale wash. It now only has to clear AA on
the card and raised surfaces, which it already does. Its values do not change in this spec.

### 4.3 Mesh blooms

`--app-bloom` is currently one radial of `--brand`, repeated in all 18 blocks. It becomes three
radials — `--brand` top-left, `--brand-2` bottom-right, `--brand-mid` lower-left — derived once
in `:root` and once in `.dark`, and is removed from the preset seed set. Every preset follows
with no per-preset CSS, and each preset block gets shorter.

Bloom alphas are per mode. Light bloom alphas are capped by the chrome-text AA check in 4.2.
Dark bloom alphas are capped by the existing sidebar muted-text check.

The content-card header glow (`--reach-glow`, Vivid only) keeps its current behaviour.

### 4.4 Middle stop and Prism

`--brand-mid` is derived in `:root` as `color-mix(in srgb, var(--brand), var(--brand-2))`.
`--brand-gradient` becomes `linear-gradient(90deg, var(--brand), var(--brand-mid), var(--brand-2))`.
A browser interpolates a two-stop gradient in sRGB, so with the derived midpoint this paints the
same pixels as today for every existing preset. Prism is the one preset that redeclares
`--brand-mid` (cyan, violet, pink). `presets.test.ts` allows `--brand-mid` in Prism's blocks only.

### 4.5 Presets added and removed

Hue pairs, as OKLCH hue angles of the first and second accent. Final hex values are produced
during the build by tuning lightness and chroma until `globals.contrast.test.ts` is green.

| Preset  | Accent 1 → 2               | Note                   |
| ------- | -------------------------- | ---------------------- |
| Lagoon  | cyan 200 → blue 258        |                        |
| Tropic  | teal 172 → lime 128        |                        |
| Orchid  | magenta 335 → violet 292   |                        |
| Peach   | coral 32 → gold 82         |                        |
| Glacier | ice blue 228 → mint 188    | low chroma             |
| Dusk    | indigo 275 → rose 8        |                        |
| Berry   | crimson 15 → purple 318    |                        |
| Candy   | pink 350 → cyan 215        |                        |
| Citrus  | lime 118 → orange 68       |                        |
| Prism   | cyan 208 → pink 350        | middle stop violet 292 |
| Mocha   | caramel 58 → terracotta 28 | low chroma, earthy     |
| Neon    | green 150 → magenta 325    | high chroma            |

Removed ids are aliased at every read boundary so a stored value keeps resolving:

| Stored   | Resolves to |
| -------- | ----------- |
| `ocean`  | `lagoon`    |
| `forest` | `tropic`    |
| `ember`  | `peach`     |
| `rose`   | `orchid`    |

`LEGACY_THEME_PRESET_ALIASES` and a `resolveThemePresetId(value)` helper live in
`src/lib/theme/presets.ts`. The profile read (`queries-cached.ts`), `use-theme-preset.ts` and the
inline no-flash script all go through it. The Zod write boundary accepts current ids only, so the
stored value is replaced the next time the user saves a preset. No migration runs against the
live DEV database.

### 4.6 Settings picker

`theme-preset-form.tsx` renders 17 tiles. The swatch changes from "chrome wash plus an accent
dot" to a tile whose ground is the preset's wash for the active mode with the gradient bar on
it, matching the prototype tiles. `ThemePresetSwatch` gains the wash stops it needs; `accent2`
becomes required for every preset except Keystone and Graphite.

## 5. Performance and data-fetching budget

- First paint: no new requests. Everything is CSS custom properties on `<html>`, stamped by the
  existing inline no-flash script.
- Interactions: switching preset, mode or reach is 0 server round-trips for the repaint. Saving a
  preset is the existing Server Action; nothing new.
- No new reads. The alias is a pure function over a value already fetched.
- Paint cost: the wash goes from two background layers to four on one full-viewport element that
  does not animate.

## 6. Testing

`globals.contrast.test.ts` (runs per preset × mode × reach):

- New: chrome text and chrome muted text clear AA on every wash stop under peak bloom, both modes.
- New: chrome hover and selected fills stay distinguishable (selected lift ≥ 1.5× hover) on the wash.
- New: `--chrome-ring` and `--chrome-indicator` are ≥ 3:1 on every wash stop.
- New: `--brand-gradient` with the derived middle stop equals the two-stop gradient at 25/50/75%.
- Changed: the light sidebar muted-text check moves from `--muted-foreground` to
  `--chrome-muted-foreground`. The light chrome/card separation floor stays and passes by a wide
  margin.
- Existing brand-label checks now also cover `--brand-mid`.

`presets.test.ts`: seed set no longer contains `--app-bloom`; `--brand-mid` allowed only in
Prism; chrome tokens forbidden in preset blocks; 17 ids; registry and CSS blocks match.

Unit tests: `resolveThemePresetId` (aliases, unknown value, current ids); the inline script
resolves a stored legacy id; the picker renders 17 tiles and saves a current id.

Browser pass before merge (jsdom renders no colour): every preset in light and dark at all three
reach levels, checked in Chrome on the sidebar, header, board dock, Ask layout, a menu opened
from the sidebar, the mobile drawer, and the settings picker.

## 7. Independent units and execution order

| Unit | What                                                                 | Touches                                                |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| A    | Chrome tokens, `.chrome-scope`, class on shell elements, indicator   | `globals.css`, shell components, contrast test         |
| B    | Mesh bloom derivation, `--brand-mid`, gradient change                | `globals.css`, `presets.test.ts`, contrast test        |
| C    | Bold light wash for Keystone, Graphite, Aurora, Sunset, Nebula       | `globals.css`                                          |
| D    | Twelve preset blocks and registry entries; remove four; alias helper | `globals.css`, `presets.ts`, read paths, inline script |
| E    | Settings picker                                                      | `theme-preset-form.tsx`                                |
| F    | `pulse-ui` skill, ADR, changelog                                     | docs only                                              |

A, B, C and D all edit `globals.css` and the same two test files, so they run in sequence:
A → B → C → D. E depends on D's registry shape. F depends on nothing and runs alongside from the
start; E runs alongside the browser pass. Critical path: A → B → C → D → browser pass.

## 8. Rule changes in the `pulse-ui` skill

- "Chrome is neutral, lightly tinted by the theme" holds for dark mode only. In light mode the
  chrome is the preset's gradient and its text is white.
- Elements painted on the wash carry `.chrome-scope`; components inside keep using the generic
  semantic utilities and never read a `--chrome-*` token directly.
- `--brand-gradient` gets a fifth sanctioned use only indirectly: the wash is built from the
  seeds, not from the utility. The four sanctioned uses of `bg-brand-gradient` do not change,
  except that the sidebar indicator now reads `--chrome-indicator`.
- Preset list and seed-token rule updated (no `--app-bloom`; `--brand-mid` for Prism).

## 9. Risks

- **White muted text on mid-lightness hues.** Citrus, Peach and Tropic have light accents that
  are naturally bright; their light wash will be visibly deeper than the prototype to hold AA.
- **Default look changes for all light-mode users.** Mitigated by the changelog entry; there is
  no opt-out in this spec. A "classic light" switch is a possible follow-up if it is missed.
- **Elements on the wash that are missed by the scope** would show dark text on a saturated
  ground. The browser pass in section 6 lists the surfaces to check.
