---
type: session
date: 2026-08-01-2000
branch: develop
trigger: wrapup
status: complete
tags: [session, landing, design]
related: []
---

# Landing rebuilt around agents, on one continuous page

## What changed

- **Three merges to `develop`:** `66e0b76b` (hero + sections reframed around agents),
  `a17e98eb` (hero crosses the fold), `9a866e69` (one continuous page, no duplicate CTAs).
- **Hero:** the "In active development" badge is gone (a test pins it out), a sticky `LandingNav`
  was added, and the wordmark dropped from `clamp(40–124px)` to `clamp(34–72px)` — face, weight,
  tracking, glow and sweep untouched, per the user's constraint. The CTA row under the subcopy was
  removed entirely; entry points live in the nav only.
- **New `landing-agent-mocks.tsx`:** agent roster, a thread where a human `@mention`s an agent and
  the agent answers under its own badged identity and attaches a document to the task, a
  board-with-thread-dock window, and the morning digest a scheduled agent delivers. `<RollingOut>`
  marks the one claim that does not ship.
- **Page structure below the hero:** trust strip → boards & views (view switcher leads) → agents →
  intelligence → security → capabilities → founder → FAQ → access. The 14-card capability wall
  became three columns; a six-question FAQ ships as native `<details>` (no client JS).
- **Backgrounds:** every per-section background removed in favour of one `.wash` spanning the full
  scrollable page. `CapabilityGrid` and `MiniFeatureCard` deleted rather than left uncalled.
- **`landing-sections.tsx` split** (837 → 448 → 226 lines) into `sections/primitives`,
  `sections/visuals`, `sections/bands` — which cleared the standing `max-lines` tripwire.

## Why

The landing read as a splash screen, not a product: a full-viewport wordmark, a beta badge, no nav,
and the only real proof (the board mock) parked below the fold. Separately, the Buzz-inspired
personal-agents work made the old positioning stale — the page sold a Work OS while the product was
becoming an agentic one. Both had to change before launch.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev`, open `http://localhost:3000/landing`.
2. Fold: wordmark → headline → subcopy → four agent cards → the board+thread window crossing the
   cut. There must be **no buttons under the subcopy**, and no "In active development" pill.
3. Scroll: the nav stays **pinned** with Get started always reachable, and the background drifts
   side to side with **no visible band edges** anywhere.
4. Click Agents / Product / Views in the nav — jumps in-page, no reload, no spinner.
5. In the agents section: `@Triage` in periwinkle, the `AGENT` badge, the PDF chip marked
   *ATTACHED TO THIS TASK*, and `NAMED AGENTS · ROLLING OUT` under the bullets.
6. Open an FAQ entry — expands with no JS.
7. At 390px: no sideways scroll; the dock's board scrolls **inside** its own panel.

## Open threads

- **The page's CTA model is incoherent and needs a product decision.** The nav says "Get started"
  → `/signup`, the footer says "Invitation only", and the closing band is a waitlist whose email
  input is **inert** (`type="button"`, no handler). That is the last real prototype tell on the page.
- Section rhythm was tightened to `py-20 md:py-28` (one constant, `BAND` in `sections/bands.tsx`)
  without an explicit answer from the user — reversible if the extra air was wanted.
- The landing still claims named per-user agents only behind `<RollingOut>`; when
  `task/personal-agents` ships that marker must come off, or it becomes an understatement.

## Next session entry point

Landing work is closed. Resume at the north-star's Next: **promote `develop → main`**, which is now
also what publishes this landing. Decide the signup-vs-waitlist question before the promotion, since
the page ships either way.
