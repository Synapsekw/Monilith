---
type: adr
date: 2026-11-12
status: accepted
tags: [decision, design-system, theming]
related:
  [
    "[[2026-06-16-decision-08-dark-first-monday-reskin]]",
    "[[2026-11-12-visual-refresh-design]]",
  ]
---

# decision-42 — Themes reach the content, and a preset may carry two accents

**Date:** 2026-11-12
**Decided by:** owner, after a UI review of the live deployment
**Supersedes in part:** the "chrome is strictly monochrome" and "single accent" rules of the
Keystone system (pulse-ui skill, decision-08)

## Context

A preset used to change three things: the wash behind the shell, the bloom, and `--brand`. The
content card — where all work happens — was the same near-black in every preset
(`#0e110f` Forest vs `#12100e` Ember). Charts used greys or a fixed six-hue palette. The owner's
reading of the app: picking a theme does nothing, and the app has no personality next to the
landing page.

## Decision

1. **Reach is a third theme axis** beside mode and preset: `data-theme-reach` =
   `subtle | tinted | vivid`. `tinted` is the default for everyone. `subtle` is exactly the old
   look. Reach is a derived layer over the preset seeds, so no preset block and no component
   reads it.
2. **A preset may carry a second accent.** `--brand-2` is a seed token; single-accent presets set
   it equal to `--brand`. Aurora, Sunset and Nebula are opt-in; Keystone stays the default. The
   gradient is allowed in four places only: primary button, active sidebar indicator, progress
   fills, chart spectrum.
3. **Mono appears in the app**, in empty states and on Ask only.
4. **Completing an item celebrates**, on by default, with a per-user switch.

## Constraints we hit (the numbers are load-bearing)

- **AA caps Vivid.** Muted text on a hovered row inside a raised surface fell to 4.1–4.4:1 at the
  first-draft Vivid values (surface 7%, hover 13%). Shipped: surface 5%, hover 8%.
- **The light separation floor caps the light content tint.** The bloomed header band must stay
  ≥ 1.15:1 against the content card (the 2026-09-09 washed-out-chrome fix). 5% dropped light
  presets to 1.11–1.14; shipped light value is **2.5% for both Tinted and Vivid** (3% fails in
  Forest). Dark keeps 5% / 9%. So in light mode Vivid differs from Tinted only by the glow and a
  slightly stronger surface tint. This is intended: the app is dark-first.
- **Dark Vivid content cannot outrun the raised surfaces** (browser screenshot pass, same day).
  At content 9% / surface 5% cards measured 1.00–1.02:1 against the page in every dark preset.
  Shipped: **dark vivid content 8% / surface 7%** (7% is the dark AA cap with hover at 8%),
  which keeps 1.06–1.07:1. This supersedes the "Dark keeps 5% / 9%" above.
- **Selected must out-lift hover.** Reach turned hover into a brand tint as strong as the 14%
  selected fill. `--reach-selected: 12%` restores a ≥ 1.5× lead (text stays ≥ 4.9:1).
- **Categorical chart colours are hue rotations of the brand** (`oklch(from var(--brand) …)`,
  60° steps, fixed in-gamut L/C). Fixed hues collided with warm/green brands (ΔE 0.05).
- **`color-mix` argument order matters.** Tailwind emits the FIRST colour as the fallback for
  engines without `color-mix`. Brand-first compiled to a solid brand fill; the mixes are written
  seed-first.
- **Reach uses `in srgb`,** not `in oklab`, so `globals.contrast.test.ts` can reproduce every mix
  with a per-channel linear blend.

## Consequences

- Any surface painted with a raw seed in an arbitrary value (`var(--card)`) bypasses reach and
  will look like a hole. Use the utility or `var(--color-card)`.
- A new preset or a changed reach value must keep the contrast matrix green for every
  preset × mode × reach. Lower the value; never the floor.
- Auth and onboarding cards tint too, because the attribute lives on `<html>`.
- Not built here, deliberately: a custom accent colour (needs a runtime contrast clamp) and the
  daily ring (belongs with the My Work rebuild).
