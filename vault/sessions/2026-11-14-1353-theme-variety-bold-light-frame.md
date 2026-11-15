---
type: session
date: 2026-11-14-1353
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-14-decision-45-bold-light-frame-and-chrome-scope]]"
  - "[[2026-11-12-2224-visual-refresh-theme-reach]]"
---

# Theme variety and the bold light frame

## What changed

- **17 theme presets.** Twelve generated gradient presets added (Lagoon, Tropic, Orchid, Peach,
  Glacier, Dusk, Berry, Candy, Citrus, Prism, Mocha, Neon); Ocean, Forest, Ember and Rose removed.
  Stored values are aliased at read time (`resolveThemePresetId`), with no database migration.
- **Bold light frame.** Every light theme now has a saturated gradient chrome with white text.
  Elements on the wash carry `chrome-scope` (light-only); opaque surfaces nested inside carry
  `chrome-reset`. Dark mode is untouched by construction. See
  [[2026-11-14-decision-45-bold-light-frame-and-chrome-scope]].
- **Mesh blooms and a three-stop gradient.** `--app-bloom` is three radials derived once per mode;
  `--brand-mid` is derived, and only Prism sets its own.
- **Generator.** `scripts/theme/gen-presets.mjs` solves the light washes against the contrast
  rules and prints the preset blocks; tests assert the shipped CSS reproduces from it.
- **Settings picker** shows each theme's real light and dark frame.
- Built on `task/theme-variety` by subagents, one task at a time; whole-branch review found five
  Important defects (hover, loading, print states), all fixed before merge. Merged as `91ec24a7`.
  Spec `docs/superpowers/specs/2026-11-14-theme-variety-bold-light-design.md`, plan
  `docs/superpowers/plans/2026-11-14-theme-variety-bold-light.md`, prototype
  https://claude.ai/artifact/Jho9BfQoAhyb9RuMKZUe3p. Announced on `/updates` by a trailer on the
  docs commit.

## Why

The owner found the single-colour presets plain beside the gradient ones from 2026-11-12, and light
mode washed out. He picked, from a live prototype: all twelve new palettes, mesh blooms, the bold
frame for light, and removal of the four flat coloured presets.

## How to test (for the user)

Pull `develop` and run `pnpm dev`, or wait for the promotion. Use light mode unless stated.

1. Settings → Preferences → Theme. Expect 17 tiles, each split into a light and a dark half showing
   that theme's frame with an accent pill.
2. Click through several themes in light mode. Expect the sidebar and header to become a coloured
   gradient with white text, and the content card to stay white. Look hardest at Peach, Citrus and
   Mocha (brown-leaning) and at Candy and Neon (toned down).
3. Open a board and open the dock. Expect white text on the frame, and the suggestion cards and the
   message composer to stay dark-on-white.
4. In the dock's Intelligence tab hover "Catch me up": the button stays solid white with a readable
   label (it no longer changes fill on hover). Press it: the loading blocks are translucent.
5. Hover the left and right edges of the content card. Expect a light line and glow along the edge.
6. Hover your avatar in the header (with no profile photo set): the initial stays readable.
7. Press Cmd+P on a board. Expect dark text on white for the sidebar, header and dock.
8. Switch to dark mode. Expect the same look as before plus soft colour glows in the corners of the
   frame. Try two or three of the new themes.
9. If your account was on Ocean, Forest, Ember or Rose, expect Lagoon, Tropic, Peach or Orchid to
   be selected, with no flash on load.

## Open threads

- Browser-checked: all 17 light frames, the picker, the dock's three tabs, the account menu, the Ask
  page, dark Keystone and Prism. **Not checked:** the mobile drawer, reach Subtle and Vivid, print,
  the review fixes' hover states, and most new themes in dark.
- Peach, Citrus and Mocha are brown-leaning in light mode. Owner to decide: keep, rework hues, or drop.
- Candy ships at reduced chroma and Neon's second hue was nudged. Both follow from the
  bloom-visibility floor (1.12:1) added during the build; loosening it is the lever.
- Primary buttons on the light frame have no hover fill change (a white fill cannot dim and keep AA).
- The lit card seam sits mostly on the card's own border; it may be too faint in light mode.
- Known contrast gaps on the light frame, recorded in decision-45: secondary text in a selected
  sidebar row (about 4.07:1), a Mono's name tint (about 3.3–4.9:1), the button focus halo.
- Stored legacy ids are never rewritten, so the alias map is permanent until a data migration.
- Light `themeColor` in `src/app/layout.tsx` is still the old pale value.

## Next session entry point

Walk the test steps above with the owner, settle Peach, Citrus and Mocha, then promote. Everything
theme-related regenerates from `scripts/theme/gen-presets.mjs`.
