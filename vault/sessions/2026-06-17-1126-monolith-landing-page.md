---
type: session
date: 2026-06-17-1126
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-06-17-gotcha-12-public-route-needs-proxy-and-e2e-update]]"]
---

# MONOLITH public landing page

## What changed

- New public landing at `/`: `MonolithHero` (pure RSC, zero JS) — Archivo 800 wordmark over a
  cleaved floating slab with an Ice column-shaft glow, CSS-only animation + hover cue +
  `prefers-reduced-motion` off-switch. Files under `src/components/landing/`. (`b5dbbe1`)
- Root `src/app/page.tsx` switched `requireUser()` → `getUser()`: logged-out visitors get the
  landing; logged-in redirect/Welcome behavior unchanged. (`458a026`)
- `src/proxy.ts`: added exact-match `PUBLIC_ROUTES = ["/"]` so the proxy stops redirecting
  unauthenticated `/` to `/login`; updated `e2e/home.spec.ts` accordingly. (`6a514a0`)
- Tests: hero unit tests + root-route branch tests (landing / board-redirect / onboarding-redirect /
  empty-boards welcome). Full gate green: typecheck, lint (0 err), 275 unit, build, e2e home.
  (`cfd3d95`)
- ADR gotcha-12 logged; design chosen via the brainstorming visual companion (Obelisk → Archivo →
  Cleaved → Column → Ice). Pushed develop to origin.

## Why

The app needed a public front door. Built through the full brainstorming → spec → plan →
subagent-driven-development flow with the user picking the visual direction live in the browser
companion.

## Open threads

- Not promoted to `main` (no production deploy) — develop pushed only.
- Reviewer's optional polish, deferred: `aria-label` on the hero link; "Press to enter" copy (user
  kept the approved "Click to enter").
- Follow-up from gotcha-12: consider a unit test for the proxy's public/auth/protected branching so
  route-visibility regressions are caught without a browser run.

## Next session entry point

Landing is live on develop. If shipping it, open the `develop → main` promotion PR. Otherwise pick
up the next feature (e.g. the concurrent phase-4c attachments work also on develop).
