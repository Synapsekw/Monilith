---
type: session
date: 2026-06-23-1016
branch: develop
trigger: wrapup
status: complete
tags: [session, phase-9, ppr, cache-components, streaming]
related:
  - "[[2026-06-22-1617-phase-9-design-and-91-auth-getclaims]]"
  - "[[2026-06-23-gotcha-40-cachecomponents-global-blast-radius]]"
  - "[[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]"
---

# Phase 9.2 — Streaming shell (PPR / Cache Components) build

## What changed

- `/whats-next` triage → scope-to-plan agent wrote the 9.2 spec + plan
  (`docs/superpowers/{specs,plans}/2026-06-23-phase-9-2-streaming-shell*`) → built it inline
  (subagents are read-only here). Merged `task/streaming-shell-9-2` → `develop` (`f46b54e`, 9 commits).
- Enabled `cacheComponents: true`. Split `AppShell` into a static **frame** taking slot `ReactNode`s;
  per-user data moved into streamed server components behind `<Suspense>` + content-shaped skeletons:
  `SidebarNavData`→`SidebarNav` (client, reads collapse store), `HeaderUserData`, `CommandPaletteData`,
  `TimeZoneBoundary`. New `Skeleton` primitive; extracted `UserMenu`. The 8 section layouts collapse to
  one `AuthenticatedShell` helper (synchronous; `unstable_instant = false`). Admin keeps its
  `requirePlatformAdmin()` gate at the top (stays `ƒ Dynamic`).
- Flipping the flag is **global**, not just the 8 sections: every cookie-reading route outside a
  Suspense broke the build. Wrapped the 4 standalone ones (`home`, `landing`, `onboarding`,
  `(auth)/change-password`) in Suspense gates — see [[2026-06-23-gotcha-40-cachecomponents-global-blast-radius]].
- Rebased onto a `develop` that gained a concurrent **sidebar-nav-highlight** session (`079182d`);
  resolved the lone `sidebar.tsx` conflict and ported their active-nav highlight into the new `SidebarNav`.

## Why

Phase 9 hardening: make the authed app _feel_ as instant as the static landing. 9.2 prerenders the
app chrome and streams per-user data, the big perceived-speed win — and lays the Suspense boundaries
9.3 (cache) and 9.4 (skeletons) slot into. Builds on 9.1's `getClaims` auth fast-path.

## How to test (for the user)

1. Pull `develop`, `pnpm dev`, sign in, go to **/boards**. DevTools → Network → Slow 3G, hard-reload.
   Expect: sidebar frame + brand + collapse toggle + header + ⌘K trigger paint immediately; nav lists
   and header avatar/bell show skeletons that fill in with **no layout shift**.
2. Click **/boards → /dashboards → /goals**: chrome never blanks, only data regions re-stream.
3. `/boards/A → /boards/B`: sidebar stays put, no skeleton flash; only board content swaps.
4. Toggle collapse (`⌘\`): instant, no network, persists; active-nav highlight still works.
5. Platform admin: header user menu shows the **Platform admin** link (streams in).
6. Maintainer: `pnpm build` → authed routes show `◐ Partial Prerender`.

## Open threads

- **Not run clean on integration** — the finish gate hit [[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]
  (25 RLS failures under shared-cloud contention; two worst files pass 13/13 in isolation; diff has no
  server/DB code). Hand-merged on deterministic-green (typecheck·lint·unit 1032·build). CI re-runs integration.
- **Deferred:** `@next/playwright` `instant()` e2e (helper not installed); page-level
  `unstable_instant = { prefetch: 'static' }` refinement (build-time PPR validation already passes).
- **Not promoted** — reaches prod on the next `/promote`.

## Next session entry point

9.3 (cache semi-static sidebar via `use cache`) + 9.4 (content-shaped skeletons + `loading.tsx`) are
now unblocked — both slot into 9.2's Suspense boundaries. Then 9.6 Web-Vitals gate.
