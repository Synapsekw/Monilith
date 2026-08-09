---
type: session
date: 2026-08-09-1703
branch: develop
trigger: wrapup
status: complete
tags: [session, desktop, macos, release, infra]
related:
  [
    "[[2026-08-09-gotcha-84-a-dmg-only-update-feed-is-inert]]",
    "[[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]]",
    "[[2026-08-06-decision-36-desktop-ships-as-a-notarized-direct-download]]",
  ]
---

# Desktop release feed

Build work ran 2026-08-07; final smoke verification and this capture on 08-09.

## What changed

- **`releases.monolith.works` now exists.** A zero-build Vercel project (`monolith-releases`) that
  only 307-redirects `/desktop/*` into the public `desktop` bucket. Source in the desktop repo at
  `release-feed/`. The subdomain resolved to Vercel but **no project claimed it** — every update
  check had 404'd since 1.0.0.
- **Three blockers, not one** (spec: `docs/superpowers/specs/2026-08-07-desktop-release-feed-design.md`).
  Nothing published; **no mac `zip` target** ([[2026-08-09-gotcha-84-a-dmg-only-update-feed-is-inert]]);
  and the bucket's `allowed_mime_types` **415'd the feed's own file types** — fixed by migration
  `20260807165135` (applied to DEV, ledger reconciled, **8th** consecutive `apply_migration`
  mis-stamp).
- **1.0.0 published** — 9 objects, `latest-mac.yml` on `max-age=60` against `immutable` binaries.
  Mac artifact names pinned (`${arch}.${ext}`) *before* publishing; the x64 zip was emitting as
  `Monolith-1.0.0-mac.zip`, and renaming after publish strands objects in the bucket.
- **Updater failures are visible.** `AppUpdater`'s check-failure path emits `"error"` then throws —
  with no listener, Node makes the *emit* throw `ERR_UNHANDLED_ERROR`, **replacing** the real error
  before `.catch(() => undefined)` discarded it. Now has `electron-log` + an error listener.
- **Two new tests**, both mutation-checked: a static guard on the `zip` target, and a live-feed
  acceptance test (spawned Electron main, `tests/fixtures/updater-main.js`) asserting the published
  feed offers a `.zip` — it fails against a bad feed.

## Why

`electron-builder.yml` had declared `publish.url` since the shell shipped and `startAutoUpdates()`
ran every six hours against nothing. The indirection is the load-bearing decision: `publish.url` is
compiled into every binary and **can never change for installs already in the field**, and a
DEV→PROD Supabase cutover is planned — pointing straight at `hjqca…` would weld the DEV ref into
every `.app` forever.

## How to test (for the user)

1. `curl -sL https://releases.monolith.works/desktop/latest-mac.yml` → YAML for 1.0.0 listing two
   `.zip` entries **first**. The zips are the whole point.
2. `curl -sI https://releases.monolith.works/desktop/Monolith-1.0.0-arm64.dmg` → `307` to
   `hjqca….supabase.co`, not a proxied body.
3. `cd ~/Dev/monolith-desktop && pnpm exec playwright test -g "published update feed"` → passes <1s.
4. Reinstall from Settings → Integrations → Desktop app, launch, then
   `tail ~/Library/Logs/Monolith/main.log` → `Checking for update` / `already up to date`. That file
   did not exist before.
5. Next release: `pnpm package` → `scripts/publish-release.sh` → bump `latestShell` in
   `public/desktop-release.json` → promote.

## Open threads

- **Auto-update still cannot install.** Squirrel.Mac validates an update against the running app's
  designated code-signing requirement; for the ad-hoc signature that requirement is the current
  binary's `cdhash`. Verified up to and including a 118MB download + sha512; the install step is
  **documented-and-expected to fail, not observed**. Remaining work is `mac.identity` +
  `hardenedRuntime: true` — but see
  [[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]]: those
  two must move **together**.
- **My merge (`2741c477`) is on `develop` but not in `main`** — PR #89 promoted a state predating it.
  Harmless: the feed is Vercel + Supabase + the desktop repo, all live independently.
- Existing 1.0.0 installs are unsigned and cannot self-update, so they will never receive the new
  logging — reinstall to pick it up.
- Deliberately not done: a "Check for Updates…" menu item; repointing `desktop-release.json`'s
  `downloads` through the vanity host (same baked-in-URL argument, and the strongest next step).
- **Left by a peer session, uncommitted:** gotcha-82 and gotcha-83 in `vault/decisions/` are
  untracked while the session note that links them is committed — broken wikilinks until staged.

## Next session entry point

Repoint `desktop-release.json`'s `downloads` through `releases.monolith.works`, or promote
`develop → main` (now several merges behind, including this migration).
