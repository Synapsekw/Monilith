---
type: session
date: 2026-06-18-1946
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Public /updates changelog page + landing dev-note

## What changed

- **Public `/updates` page** (`src/app/updates/page.tsx`) — always-dark, fully static RSC rendering a hand-written changelog. New `src/lib/changelog/` (`types.ts`, `entries.ts` with `groupByDate`/`formatDate`) + `src/components/changelog/` (`changelog-timeline`/`-date-group`/`-item-badge`). Badge palette is Pulse mono + accent (`new`→`bg-primary`, `improved`/`fixed`→muted outline), **not** Mubarak's gold/blue/emerald. Curated, not auto-generated — kept Mubarak's data shape so git auto-gen can bolt on later. Commits `fc6b6cf..733de12`.
- **Landing dev-note** (`13bcd39`) — "In active development" status pill above the wordmark (`monolith-scene.tsx`) + a hero footer "Invitation only" / `Updates →` link to `/updates` (`monolith-hero.tsx` + css + test). Counts in `monolith-hero.test.tsx` bumped 2→3 / 1→2.
- **Adopted a parallel session's in-flight `archivo`→`nunito` font rename** (`cfe5338`) at the user's call (it was uncommitted in the shared checkout and my page already depended on it).
- **fix `61e24fd`** — `/updates` added to `proxy.ts` `PUBLIC_ROUTES`; the new auth proxy (Next-16 `proxy.ts`, landed by the parallel session after my spec) was redirecting it to `/login`. Caught by runtime probe, not the test suite.
- **fix `a4bb9fb`** — `/updates` back link → `/landing` (not `/`) so a logged-in visitor reaches the splash instead of being redirected into the app. User-requested.
- Spec + plan: `docs/superpowers/specs/2026-06-18-landing-note-and-updates-page-design.md`, `docs/superpowers/plans/2026-06-18-landing-note-and-updates-page.md`. Donor pattern studied: `mubarak-ai` `/updates` + changelog feature.

## Why

Monolith is invite-only and under active development but said so nowhere, and there was no public place to show what shipped. Curated (vs. Mubarak's git-auto-gen + jargon filter) fits this early, invite-only stage: full control of public wording, no jargon-leak risk, far lighter.

## Open threads

- **`develop` is RED on repo-wide `typecheck`/`build`** — entirely the parallel session's Phase 5b automations refactor (`28e9cc3` made the trigger a discriminated union; `AutomationsDialog.tsx`/`AutomationBuilder.tsx` still read `.columnId`/`.toOptionId` on the `item_created` variant). Not my code; left untouched. **Do not promote to `main` until that session fixes it.** My feature is green in isolation (482 tests, my targeted tests, runtime probes).
- **No proxy test exists** — the parallel session shipped `proxy.ts` without one. A test asserting `/updates` (and `/`, `/landing`) stay public while gated routes 307→`/login` is a good follow-up.
- Built but **not pushed**. Built subagent-driven (Tasks 1–5, Task 6), each with spec + code-quality review (both ✅); runtime-verified against the live dev server (`/updates` 200 logged-out, control `/dashboards` 307→`/login`, back link `/landing`, pill + footer present).

## Next session entry point

If picking this up: confirm `develop` typechecks again (after the automations 5b fix), then `git push`. Consider adding the missing `proxy.ts` public-routes test. The `/updates` curated list lives in `src/lib/changelog/entries.ts` — add an entry when something user-facing ships.
