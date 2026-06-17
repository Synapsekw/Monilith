---
type: session
date: 2026-06-17-1829
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-06-17-1126-monolith-landing-page]]"]
---

# MONOLITH nav brand + sidebar-collapse plan

## What changed

- **Nav brand → MONOLITH** (`2a19fb2`): replaced the "P"/Pulse mark with a cleaved-monolith SVG
  mark (`src/components/brand/monolith-mark.tsx`, `currentColor`, theme-adaptive) + the MONOLITH
  wordmark in the landing's Archivo face. Extracted the shared font to `src/lib/fonts.ts` (reused by
  the hero) and globally stubbed `next/font/google` in `vitest.setup.ts`.
- **`/landing` splash** (`70156e4`): new always-on public route (`src/app/landing/page.tsx`) the nav
  logo points to; `MonolithHero` gained an `href` prop; auth-aware enter destination (signed-in →
  `/`, logged-out → `/login`); `/landing` whitelisted in `src/proxy.ts`; logged-out e2e added.
- **Dropped the org-name line** under the nav logo (`e714eb0`).
- **Sidebar collapse — designed + planned, NOT built:** spec (`9382110`) + 4-task TDD plan
  (`21d32b5`). Icon rail (w-60⇄w-14), persisted via Zustand `persist` + `hasHydrated` guard, footer
  toggle + ⌘\, tooltips; new `Sidebar` client component replacing the inline `<aside>`.
- Gate green throughout (typecheck/lint/build; 296→310 tests as work landed).

## Why

Polishing the app's first-impression chrome under the MONOLITH rebrand — a consistent brand mark
and type in the nav, and a reachable splash from inside the app. The collapsible sidebar is the next
"nice UI visual," fully designed and planned, paused on the execution-mode choice.

## Open threads

- **Sidebar collapse plan ready to execute:** `docs/superpowers/plans/2026-06-17-sidebar-collapse.md`
  — awaiting subagent-driven vs inline choice.
- Nav/landing commits + sidebar docs are **local on develop** (3 docs unpushed; nav/landing earlier).
- Deferred review polish: `aria-label` on the hero link; "Press to enter" copy (kept "Click to enter").
- A concurrent session is driving Phase 2c (column management) on the same `develop` checkout.

## Next session entry point

Execute the sidebar-collapse plan (Task 1 = the Zustand store). Then consider pushing `develop` and
the `develop → main` promotion PR.
