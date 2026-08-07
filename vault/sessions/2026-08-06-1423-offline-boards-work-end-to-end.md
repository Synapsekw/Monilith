---
type: session
date: 2026-08-06-1423
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-08-06-decision-38-only-main-auto-deploys-on-vercel]]",
    "[[2026-08-06-gotcha-79-a-test-probe-can-manufacture-the-bug-it-is-hunting]]",
  ]
---

# Offline read-only boards actually work

## What changed

- **`task/offline-read-only` merged** (`7c25bf87`). B2 was **four** defects, not one: the SW cached
  the `/offline` document and none of its JS (28 of 30 chunks absent — the ChunkLoadError);
  `persistQueryClientSubscribe` performs **no initial save**, so nothing was ever written to disk
  (`keyval-store` never even existed); TanStack's `onlineManager` never reads `navigator.onLine`, so
  a page **loaded** offline reported online forever (no banner, and `assertOnline()` did not throw);
  and the worker's network-first race was not a test of connectivity, because `fetch()` is answered
  from the HTTP cache. B4 ruled (grace check moved into `OfflineBoard` **before** the restore), B5/B6
  done. Plus `/desktop-release.json` un-gated from auth and the desktop surface clustered into
  `src/lib/desktop/`.
- **`task/offline-multi-board` merged** (`83eb5aa6`) after the owner tested and found it still
  broken. Three more defects: any reload **overwrote** the persisted record with a dehydrate of the
  current QueryClient, destroying every other cached board; in-app link clicks never reached the
  worker (a soft nav fetches RSC, not a document — and the URL does not change, so the boundary
  cannot recover it); and the live shell **crashes on its own** after the network drops, on a lazily
  imported chunk that was never precached.
- **Acceptance moved to a production build** — `playwright.offline.config.ts` + `pnpm e2e:offline`.
  Offline is structurally unobservable under `next dev`, which serves documents without `no-store`.
- **`finish-task.sh`** now installs in the main checkout when a merge changes dependencies, and
  `playwright.config.ts` no longer reuses a stray `:3000` server.

## Why

Twelve per-task reviews and 4407 unit tests passed over a feature that did not work at all. Every
one of these seven defects was found by running the thing in a real browser and measuring — never by
reading code. Two were found only because the owner tested the merged result by hand.

## How to test (for the user)

1. Pull `develop`, then `pnpm build && pnpm start` — **production build**; this cannot work under
   `pnpm dev`.
2. Sign in and open three or four boards, pausing a few seconds on each.
3. Reload while still online. (This is the step that used to destroy the cache.)
4. DevTools → Application → IndexedDB → `keyval-store` → `keyval`: **all** the boards you opened
   should be listed, not just the last.
5. Turn off Wi-Fi and reload — the board renders read-only with an offline bar, no add-item control.
6. Click a different cached board in the sidebar. If the shell has already crashed to "You're
   offline", it reloads itself into that board within a second.
7. Edit the URL to a board you never opened → "This board isn't available offline."
8. Wi-Fi back on, reload → fully editable again.

## Open threads

- **`/offline` has no navigation.** It sits outside the `(app)` group, so no sidebar — by design,
  since the document is precached and must carry no user data. An offline board switcher is cheap
  now (the persister keeps 20 boards and each snapshot carries its name) and needs **no** navigation
  at all: swap which snapshot renders. Owner declined for now; revisit if it chafes.
- The offline cache is capped at `MAX_CACHED_BOARDS = 20` and never surfaces that to the user.
- Lazily imported chunks outside `/offline`'s asset graph are still not precached — the error
  boundary recovers, but a round trip is visible.

## Next session entry point

**Plan 2 — the macOS desktop shell** (`docs/superpowers/plans/2026-08-06-macos-desktop-shell.md`),
8 tasks, not started, a **new `monolith-desktop` repo**. Its only dependency on this repo,
`public/desktop-release.json`, is merged and now reachable before sign-in.
