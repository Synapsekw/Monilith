---
type: adr
date: 2026-11-14
status: accepted
tags: [decision, design-system, theming]
related:
  [
    "[[2026-11-12-decision-42-themes-reach-the-content-and-may-carry-two-accents]]",
    "[[2026-11-14-theme-variety-bold-light-design]]",
  ]
---

# decision-45 — Light mode is a bold coloured frame, and the chrome re-seeds its tokens through a scope

**Date:** 2026-11-14
**Decided by:** owner
**Status:** accepted; built on `task/theme-variety`. **Not yet checked in a browser** — every
number below comes from the test suite and the generator script, not from a rendered page.
**Supersedes in part:** the "chrome is neutral" rule of the Keystone system (pulse-ui skill,
decision-08) for light mode, and the preset list of decision-42.

## Context

After decision-42 the app had nine presets. Four of them (Ocean, Forest, Ember, Rose) were
single-colour and looked plain beside the three two-accent ones. Light mode was the weaker half
of every preset: the chrome was a pale tinted wash, so a theme barely showed and the frame read
as washed out. The owner wanted more variety and a light mode with as much character as dark.

## Decision

The owner made four decisions on 2026-11-14.

1. **Twelve new presets ship:** Lagoon, Tropic, Orchid, Peach, Glacier, Dusk, Berry, Candy,
   Citrus, Prism, Mocha and Neon. Prism is three-colour; the others are two-colour.
2. **Ocean, Forest, Ember and Rose are removed.** Keystone (the default) and Graphite stay as
   the two single-colour presets. The result is seventeen presets: Keystone, Graphite, Aurora,
   Sunset, Nebula and the twelve new ones.
3. **Mesh blooms replace the single bloom** on the chrome wash, in both modes and every preset.
4. **The bold frame is the light-mode look for every preset:** a saturated gradient chrome with
   white text around the white content card.

## Mechanism

**Chrome scope.** Elements painted directly on the wash carry the class `chrome-scope`: the
sidebar rail, the shell header band, the board dock, and the rail and header of the Ask layout.
The rule is `:root:not(.dark) .chrome-scope`, so it exists in light mode only. Inside it the
generic tokens are re-seeded: `--foreground` is white, `--muted-foreground` and `--kicker` are
white at 90%, the borders, ring and scrollbar are white alphas, the hover, active and selected
fills are white alphas, `--destructive` is a pale red, and "the brand" (`--brand`, `--brand-2`,
`--brand-mid`, `--brand-gradient`, `--primary`) is white with the real brand as its label
colour. Reach's lean on hover and selected is switched off there. Components did not change
beyond gaining the class: they keep using the ordinary semantic utilities, and no component
reads a chrome value directly. This is why the active sidebar indicator and a primary button on
the frame are white in light mode with no component edit.

**Chrome reset.** An opaque surface nested inside the chrome (a dock card, the composer, the
avatar fallback) carries `chrome-reset`. The rule is
`:root:not(.dark) .chrome-scope .chrome-reset`, and it sets every token the scope moved back to
a `--base-*` alias. The aliases are declared once on `:root`, for example
`--base-foreground: var(--foreground)`.

**Why the `--base-*` capture works.** `:root`, `.dark`, and every preset and reach selector all
match the same `<html>` element. A custom property that refers to another with `var()` is
resolved on the element where it is declared, using the value that won the cascade on that
element. So `--base-foreground` on `<html>` computes to the root foreground of the active mode,
preset and reach, and descendants inherit that resolved colour, not the `var()` reference. When
the scope later redefines `--foreground` on a descendant, the inherited `--base-foreground` is
unaffected, and the reset can hand it back. This is also why the aliases are declared once and
not repeated in `.dark` or in any preset block.

**Dark mode is untouched by construction.** Every selector of the scope and the reset starts
with `:root:not(.dark)`. Under `.dark` neither class declares anything. The reset is also inert
outside a scope, which matters because shared cards that carry it also render on the content
card. The inherited text `color` for both classes is declared in `@layer base`, so a text
utility on the same element still wins. Content portalled to `<body>` (menus, popovers, dialogs,
tooltips, the mobile drawer) is outside the scope and keeps the normal tokens.

**Mesh bloom and the middle stop.** `--app-bloom` is no longer a preset seed. It is three
radials derived once per mode, in `:root` and in `.dark`, from `--brand`, `--brand-2` and
`--brand-mid`. `--brand-mid` is derived as the sRGB midpoint of the two accents, and only Prism
declares its own. `--brand-gradient` has three stops; with the derived midpoint it paints the
same pixels as the old two-stop gradient for every preset except Prism. The light bloom is a
glow of each accent (70% accent, 30% white) at peak alphas of 18%, 16% and 16%; the dark bloom
is the accents themselves at 22%, 18% and 12%.

**Generated presets.** The blocks of the twelve new presets, and their registry entries, are the
output of `scripts/theme/gen-presets.mjs`. For each light wash stop the script starts from a
mid-tone ramp and lowers the stop only until white chrome text clears AA on it under the
preset's own bloom. It also enforces a bloom-visibility floor (every radial at its peak must sit
at least 1.12:1 off the bare stop), a shape rule (the three stops descend in lightness), and a
warm-hue remap (a wash stop with a hue between 50 and 95 is pulled to 45, because dark amber
reads as brown). The light washes of the five older presets come from the same solver.
`scripts/theme/gen-presets.test.mjs` asserts that the shipped CSS reproduces from the script. A
failing preset is fixed by changing the script and regenerating, never by hand-editing a hex.

**Removed presets.** Stored values are aliased at read time by `resolveThemePresetId` in
`src/lib/theme/presets.ts`: Ocean becomes Lagoon, Forest becomes Tropic, Ember becomes Peach and
Rose becomes Orchid. There is no database migration. The write boundary accepts current ids
only, so a stored legacy value is replaced the next time the user saves.

## Measured floors

The contrast guards live in `src/app/globals.contrast.test.ts`. The bloom checks are
geometry-aware: radials are stacked only where their lit areas overlap.

- **Light frame, white body text on a selected row under the bloom: 4.60:1** at worst (floor
  4.5). Sunset is the preset that sits on it. This is the check that caps how light a wash may be.
- **Light frame, muted and kicker text: 5.60:1** at worst.
- **Bloom visibility: 1.125:1** at worst (floor 1.12).
- **Dark mode, muted text on the bloomed wash: 4.56:1** at worst.
- **Candy ships at reduced chroma (0.75), and Neon's second hue was nudged (to 312).** Both were
  changed for the bloom-visibility floor. A glow in a hue far from the stop's own hue barely
  moves the stop's luminance, so the solver has to push that stop darker until the radial shows.
  The adjusted values let both light frames stay coloured instead of sinking towards black.

## Rejected or changed along the way

- **Separate chrome tokens for both modes.** The spec declared a `--chrome-*` token set in
  `:root` and `.dark` and mapped the generic tokens onto it. The shipped design has no such set:
  the scope re-seeds the generic tokens directly and is light-only, so dark mode cannot regress
  and there is no second vocabulary to keep in sync. The spec's `--chrome-indicator` does not
  exist; the indicator still uses `bg-brand-gradient`, which is white inside the scope.
- **Stacking all blooms on one pixel.** The first contrast checks composited every radial at
  full peak on every wash stop. The first radial and the lower two never light the same pixel,
  so this tested a ground that cannot occur. The checks and the solver now stack only radials
  that overlap.
- **A white-haze light bloom.** A white bloom lightened the frame without adding colour. The
  light bloom is now a glow of each accent.
- **The first light washes were near-black.** They were replaced by saturated mid-tone washes:
  the solver now starts from a mid-tone ramp and darkens a stop only as far as the contrast and
  visibility floors require.

## Consequences

- **The default light look changed for every light-mode user**, including people who never
  picked a preset. There is no opt-out. A "classic light" switch is a possible follow-up if the
  old look is missed.
- **Any new element painted on the wash needs `chrome-scope`**, and any new opaque surface
  inside the sidebar, header or dock needs `chrome-reset`. Without the scope the element shows
  dark text on a saturated ground; without the reset the surface shows white text on white.
- **Any token added to the scope must be added to the reset and to the `--base-*` aliases.**
  The contrast test checks that the scope and reset lists agree.
- **Legacy preset ids stay aliased.** The alias map must not be deleted while stored values may
  still hold the old ids.
- **Light `--muted-foreground` no longer meets the wash.** It only has to clear AA on the
  content card and raised surfaces. Its values did not change.
- Adding a preset is now a row in the generator plus a regenerate, not a hand-written block.

## Known limitation

Secondary (muted) text inside a **selected** sidebar row in light mode is about **4.07:1 at
worst**. That is under the AA floor of 4.5, and it is deliberately not asserted by any test.
Body text on the same row passes (4.60:1). This is recorded as an open soft spot, not as
passing. Raising it would mean either a weaker selected fill or darker washes.
