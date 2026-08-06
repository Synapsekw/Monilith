# Offline Read-Only — Handover

**Date:** 2026-08-06
**Branch:** `task/offline-read-only` @ `0daac627` — **open, un-merged, worktree still on disk**
**Worktree:** `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/offline-read-only`
**Ledger:** `.superpowers/sdd/2026-08-06-offline-read-only/progress.md` (inside the worktree, git-ignored)

## Status in one line

All 10 planned tasks plus the whole B1-B6 follow-up list are implemented, reviewed and verified;
the four gates are green and **`pnpm e2e:offline` passes on three consecutive runs** against a
production build. The feature works end to end.

## Why the acceptance command changed

`pnpm e2e e2e/offline.spec.ts` could never pass, and not because of a bug. `next dev` serves
documents with `Cache-Control: no-cache, must-revalidate` (storable), so the browser answers an
offline reload from its HTTP cache, the navigation never fails, and the service worker's fallback -
the entire feature - is never reached. `next start` sends `no-store`, so the document is never
cached, the navigation genuinely fails and the worker takes over. Offline is structurally
unobservable under `next dev`.

So offline acceptance runs against a production build:

```bash
pnpm e2e:offline        # playwright.offline.config.ts: build + start on :3001
```

`offline.spec.ts` is `testIgnore`d from the default (dev) config. Every other spec is unchanged.

## What was actually wrong (B2 was four defects, not one)

1. **The worker cached the `/offline` DOCUMENT and none of its JavaScript.** `cache.add()` stores
   one response; the document's chunks are separate requests, and the cache-first rule only ever
   populated assets already fetched while online - and `/offline` is never visited while online.
   Measured on a production build: 28 of 30 script chunks absent. Whether an offline reload worked
   was decided by whether Chrome's HTTP disk cache happened to still hold them, which is exactly the
   reported "sometimes ChunkLoadError". The worker now caches the shell's whole asset graph
   atomically, refreshes it from a live navigation so it survives a deploy (a byte-identical `sw.js`
   is never reinstalled, while chunk hashes change every build), and prunes stale entries.
2. **`persistQueryClientSubscribe` performs no initial save.** It saves only from a _subsequent_
   cache event. The snapshot is written once, before the grace check resolves and the subscription
   exists, so nothing was ever written to disk - `indexedDB.databases()` showed `keyval-store`
   absent at every online observation point. Fixed with an explicit first save.
3. **TanStack's `onlineManager` never reads `navigator.onLine`.** It starts at `true` and only
   changes on the `online`/`offline` events, which fire on a _transition_. A page loaded while
   already offline reported itself online forever - so on `/offline` the banner never rendered and
   `assertOnline()` did not throw, losing the "every write clearly refused" guarantee for a session
   started offline. Seeded once at module load.
4. **The worker's network-first race was not a test of connectivity.** `fetch()` is answered from
   the browser's HTTP cache when it can be, so a fresh navigation to a cacheable Partial-Prerender
   shell "succeeded" while genuinely offline and the fallback never ran. Now short-circuits on
   `self.navigator.onLine === false` before attempting the network.

## B3-B6

**B3 - not a product defect.** Same cause as the acceptance-command change above. One dev-mode
defect _was_ real and is fixed: the asset scanner used an allow-list character class that silently
skipped every Turbopack dev chunk containing `[`, `]` or `@`.

**B4 - ruled and implemented.** `enforceOfflineGrace` now runs in `OfflineBoard` **before** the
restore, not in `OfflinePersistence`. Offline is where the grace window matters, because being
offline is precisely why the entitlement cannot be re-verified; enforcing after the restore would
render the board and only wipe for next time, which is not enforcement. The ruling is recorded at
the early return itself so it cannot be silently reverted.

**B5** - `useBoardPresence`'s `enabled: false` path now tested, mirroring its realtime sibling.

**B6** - `AddItemRow`/`AddGroupRow` gated on the existing `canEdit` (`access !== "viewer"`), as a
required prop so every future call site must decide. This was on the acceptance path.

## Also fixed (found while investigating, user-approved)

- **`/desktop-release.json` was auth-gated.** The proxy matcher exempts static files by extension
  and `.json` is not in that list, so it 307'd to `/login` - and Plan 2's shell reads it _before_
  sign-in, so every desktop shell would have received an HTML login page where it expects JSON.
  Fixed with an exact-match `PUBLIC_ROUTES` entry, not a blanket `.json` exemption.
- **The desktop surface is now clustered** under `src/lib/desktop/` (contract + validation + test +
  a README mapping every touchpoint), with `proxy.ts` importing `DESKTOP_RELEASE_PATH` so the
  allowlist and the contract cannot drift.
- **`playwright.config.ts` no longer reuses a stray server.** `reuseExistingServer` was
  `!process.env.CI` against a fixed `:3000`; every task worktree shares that port, so a dev server
  left running from `develop` was picked up silently and the suite reported on code that was not
  under test. It is now `false` - start the suite with `:3000` free.

## Deferred minors (in the ledger, for the whole-branch review)

Static SW cache grows unbounded across deploys (fixed `CACHE` literal; `activate` only prunes other stores) — may deserve promotion. SW install failure is silent. No `AbortController` on the raced navigation fetch. `boardIdFromPath` is root-anchored, so `/boards/<id>/reports` shows the generic offline copy even when that board is cached. `enforceOfflineGrace().then()` has no `.catch` (unreachable today).

## Traps discovered — do not re-learn these

- **A green unit test is not a working page.** `user-menu.tsx` was a Server Component calling browser-only wipe code through an inline form action. Typecheck, lint, unit and build all passed; jsdom never exercises the RSC boundary. Fixed by extracting a `"use client"` leaf, and `src/components/shell/offline-wipe-client-boundary.test.ts` now asserts every importer of `@/lib/offline/wipe` declares `"use client"`.
- **Five defects originated in the plan text**, faithfully transcribed: `cache.put` outside `event.waitUntil`; `isWithinGrace` failing open on a future timestamp; an inert `enforceOfflineGrace`; a wipe that never cleared the identity marker; and the offline route re-persisting its own cache (so a board kept in offline use never aged out). All fixed. The pattern: when a reviewer says "plan-mandated," the plan is usually the thing that is wrong.
- **`@tanstack/react-query` and `@tanstack/react-query-persist-client` must share a `query-core` version** or a live `QueryClient` is not nominally assignable across the boundary. Both are pinned to `^5.101.4`.
- **The mutation guard's second assertion is load-bearing** — it compares declared `mutationFn:` count against matcher-recognised count, and it caught two non-async expression-bodied arrows that would otherwise have been skipped in silence. Never weaken it; widen the matcher instead.
- **A test probe can manufacture the bug it is looking for.** `waitForOfflineSnapshot` opened
  `keyval-store` and aborted `onupgradeneeded`, documented as "observe, never create". Aborting a
  version-change transaction that was creating the database rolls it back to version 0 and destroys
  the store: `indexedDB.databases()` reported the database absent immediately after that probe had
  confirmed the snapshot present. A control run with the instrument removed entirely is what
  separated instrument from product - do that before trusting any measurement.
- **`reuseExistingServer` + a fixed port + worktrees = silently testing another branch.** The main
  checkout's `develop` server answers `:3000` and 404s `/sw.js`.
- Parallel subagents in one worktree work fine when file sets are disjoint, provided they run **no git commands** and the controller commits between batches.

## How to resume

The ledger names every task's commits, every finding and every ruling. Trust it and `git log` over recollection.

```bash
cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/offline-read-only
cat .superpowers/sdd/2026-08-06-offline-read-only/progress.md
git log --oneline develop..HEAD
```

Acceptance: `pnpm e2e:offline` (production build). The default `pnpm e2e` deliberately skips this spec.

## Plan 2 has not started

`docs/superpowers/plans/2026-08-06-macos-desktop-shell.md` — 8 tasks, a new `monolith-desktop` repo. Its only dependency on this branch is `public/desktop-release.json`, which is already committed here. It can start independently at any time.
