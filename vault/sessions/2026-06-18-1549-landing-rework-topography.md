---
type: session
date: 2026-06-18-1549
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Landing rework — CTAs + topographic backdrop

## What changed

- **Brainstorm → spec → plan → subagent build** of a "Refined Monolith" landing:
  spec `docs/superpowers/specs/2026-06-18-refined-monolith-landing-design.md`,
  plan `…/plans/2026-06-18-refined-monolith-landing.md`. Both review stages passed.
- Replaced the full-surface click-to-enter hero with explicit entry points driven by a
  new `signedIn` prop: `MagneticButton` (cursor-pull CTA), `MonolithScene` (staggered
  reveal), `vitest.setup.ts` `matchMedia` stub for Framer under jsdom. (`486db75..dc2277e`)
- **User feedback pass** (`4bd8850`): dropped the top nav (brand mark + auth buttons),
  made the primary CTA a **white pill** (was indigo), subtitle → "The only work surface
  you need.", tightened title↔subtitle spacing (`line-height:1` + smaller gap).
- **Background redesign** (`0c2970a`): showed 4 mockups (aura / topography / dot-grid /
  aurora); user picked **topography**. New `TopographyCanvas` — marching-squares contour
  field that raises a hill toward the cursor, behind a central aura glow. Removed the
  monolith slab + parallax. Static frame under reduced-motion; SSR/jsdom-safe.
- Gate green throughout (typecheck/lint/**446 tests**/build); e2e home spec updated.

## Why

The MONOLITH landing (shipped 2026-06-17) was a single click-anywhere art piece with no
clear sign-up/login affordance. This gave it real entry points and a more striking,
mouse-reactive backdrop while keeping the dark, monochrome + indigo identity.

## Open threads

- Topography is tunable if desired: line density (grid res), color/opacity, hill
  size/strength, drift speed. Throwaway mockups for the other 3 options live in
  `/tmp/landing-options/`.
- White CTA is a deliberate deviation from pulse-ui's "brand accent = primary action"
  (justified for the bespoke always-dark hero).

## Next session entry point

Landing is done and committed on `develop` (unpushed). Next untouched feature work is
**Phase 5 (Automations + Rules)**.
