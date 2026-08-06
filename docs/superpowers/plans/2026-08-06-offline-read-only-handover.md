# Offline Read-Only — Handover

**Date:** 2026-08-06
**Branch:** `task/offline-read-only` @ `0daac627` — **open, un-merged, worktree still on disk**
**Worktree:** `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/offline-read-only`
**Ledger:** `.superpowers/sdd/2026-08-06-offline-read-only/progress.md` (inside the worktree, git-ignored)

## Status in one line

All 10 planned tasks are implemented, reviewed and through their fix rounds; the four automated gates are green; **the feature does not yet work end-to-end**, so the branch was deliberately not merged.

## Why the branch is open

`pnpm typecheck` 0 errors · `pnpm lint` 0 errors · `pnpm test` 4407+ passing · `pnpm build` clean.
**`pnpm e2e e2e/offline.spec.ts` is RED.**

The E2E spec was run for real in a browser against a real server, seven times, and never passed. It found defects that twelve per-task reviews and 4407 unit tests all missed. The spec is committed while failing on purpose: it encodes the acceptance bar and reproduces the defects.

## What exists

20 commits, 58 files, +2517/−38.

**New modules** — `src/lib/offline/`: `constants.ts` (the single 7-day `OFFLINE_WINDOW_MS`, `OFFLINE_MESSAGE`, `LAST_USER_KEY`, `ENTITLEMENT_KEY`), `online-status.ts` (`assertOnline`, `useOnlineStatus`), `persister.ts` (user-namespaced IndexedDB persister, allowlist = `boardSnapshot` only), `wipe.ts`, `snapshot.ts`, `entitlement.ts`, `offline-render-context.tsx`.
`src/components/offline/`: `ServiceWorkerRegistrar`, `OfflinePersistence`, `OfflineBoard`, `OfflineBanner`.
Plus `public/sw.js`, `src/app/offline/page.tsx`, `public/desktop-release.json`, `e2e/offline.spec.ts`, and ADRs 35/36/37 in `vault/decisions/`.

**Design in one paragraph.** A service worker precaches only content-hashed `/_next/static/**` and one document, `/offline`, and serves it for any navigation that fails. `BoardViews` snapshots its full render props under the `boardSnapshot` query key (not `BoardCache` — that type has no `views`), which a persister writes to IndexedDB namespaced by user id and capped at 7 days. `/offline` restores that snapshot and re-renders the board with `access="viewer"` — the board's existing read-only mode, not a new one. Writes are refused by `assertOnline()` at the top of all 58 `mutationFn`s, enforced by a static-analysis test.

## Open work, in priority order

**B2 — BLOCKING. Offline reading does not work end-to-end in production.** Reloading while offline sometimes throws `ChunkLoadError`; sometimes it reaches `/offline` but reports a just-cached board as never-visited. This is the plan's central promise. Needs `systematic-debugging` — reproduce and find the mechanism before changing code. Two hypotheses worth testing first: the SW precache races the snapshot write, so the board is not yet in IndexedDB when `/offline` restores; and the SW's cache-first `/_next/static/**` rule may not hold every chunk `/offline` needs, producing the `ChunkLoadError`.

**B3** — in dev, reloading offline hangs on the app's own loading skeletons instead of the SW fallback. May be the same root cause as B2, may be a dev-server artifact; establish which before fixing.

**B4** — the `isOfflineRender` early return in `OfflinePersistence.tsx` also skips `enforceOfflineGrace`, the only caller that wipes on entitlement lapse. A user who only ever opens `/offline` is never wiped. Needs an explicit decision plus a comment recording it, not a silent change.

**B5** — `useBoardPresence`'s `enabled: false` path has no test; its `useBoardRealtime` sibling has one.

**B6** — `AddItemRow` / `AddGroupRow` are not gated by `canEdit`, so a read-only board still shows add controls. Writes are blocked at the mutation layer, so this is an affordance gap, not a safety hole. It affects online viewers too, so it predates this branch.

## Deferred minors (in the ledger, for the whole-branch review)

Static SW cache grows unbounded across deploys (fixed `CACHE` literal; `activate` only prunes other stores) — may deserve promotion. SW install failure is silent. No `AbortController` on the raced navigation fetch. `boardIdFromPath` is root-anchored, so `/boards/<id>/reports` shows the generic offline copy even when that board is cached. `enforceOfflineGrace().then()` has no `.catch` (unreachable today).

## Traps discovered — do not re-learn these

- **A green unit test is not a working page.** `user-menu.tsx` was a Server Component calling browser-only wipe code through an inline form action. Typecheck, lint, unit and build all passed; jsdom never exercises the RSC boundary. Fixed by extracting a `"use client"` leaf, and `src/components/shell/offline-wipe-client-boundary.test.ts` now asserts every importer of `@/lib/offline/wipe` declares `"use client"`.
- **Five defects originated in the plan text**, faithfully transcribed: `cache.put` outside `event.waitUntil`; `isWithinGrace` failing open on a future timestamp; an inert `enforceOfflineGrace`; a wipe that never cleared the identity marker; and the offline route re-persisting its own cache (so a board kept in offline use never aged out). All fixed. The pattern: when a reviewer says "plan-mandated," the plan is usually the thing that is wrong.
- **`@tanstack/react-query` and `@tanstack/react-query-persist-client` must share a `query-core` version** or a live `QueryClient` is not nominally assignable across the boundary. Both are pinned to `^5.101.4`.
- **The mutation guard's second assertion is load-bearing** — it compares declared `mutationFn:` count against matcher-recognised count, and it caught two non-async expression-bodied arrows that would otherwise have been skipped in silence. Never weaken it; widen the matcher instead.
- Parallel subagents in one worktree work fine when file sets are disjoint, provided they run **no git commands** and the controller commits between batches.

## How to resume

The ledger names every task's commits, every finding and every ruling. Trust it and `git log` over recollection.

```bash
cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/offline-read-only
cat .superpowers/sdd/2026-08-06-offline-read-only/progress.md
git log --oneline develop..HEAD
```

Do **not** run `scripts/finish-task.sh` until B2 is resolved and `pnpm e2e e2e/offline.spec.ts` passes.

## Plan 2 has not started

`docs/superpowers/plans/2026-08-06-macos-desktop-shell.md` — 8 tasks, a new `monolith-desktop` repo. Its only dependency on this branch is `public/desktop-release.json`, which is already committed here. It can start independently at any time.
