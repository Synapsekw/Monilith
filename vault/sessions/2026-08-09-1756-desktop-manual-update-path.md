---
type: session
date: 2026-08-09-1756
branch: develop
trigger: wrapup
status: complete
tags: [session, desktop, macos, release]
related:
  [
    "[[2026-08-09-1703-desktop-release-feed]]",
    "[[2026-08-09-gotcha-84-a-dmg-only-update-feed-is-inert]]",
    "[[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]]",
  ]
---

# Desktop: a manual update path that actually reaches users

Follows [[2026-08-09-1703-desktop-release-feed]]. The feed can find and download a release; it
cannot install one until the app is signed. This closes the gap in between.

## What changed

**`monolith-desktop` (`9029710`, local-only — still no remote):**

- **`latestShell` went from decorative to the release lever.** `/desktop-release.json` has
  advertised it since the shell shipped and **nothing read it** outside the blocked-app error
  string, so bumping it did literally nothing. A newer value now shows a non-blocking
  **Download / Later** prompt, raised after the window and not awaited so it can't delay startup.
- **The hard block stopped being a dead end.** `minSupportedShell` showed "too old to run" with a
  single **Quit** button naming no destination — the floor was enforceable but locked users out
  with nowhere to go. It now offers Download alongside Quit.
- **Monolith → Check for Updates…**, which distinguishes *up to date* from *the check failed*.
  `latest: null` means the request didn't succeed, and reporting that as "you're up to date" is a
  lie the user acts on.
- `isUpdateAvailable` fails **closed** — the deliberate mirror of `isShellSupported`'s fail-open.
  Deciding whether to BLOCK must degrade to "run"; deciding whether to NAG must degrade to silence.
- `downloadUrlForArch` enforces **https**, because that value is remote data whose only consumer is
  `shell.openExternal`, which hands `file:` paths and custom schemes to Launch Services. The host is
  deliberately **not** pinned, or repointing the vanity release host would silently break it.

**This repo (`c15fe6b0`):** Settings → Integrations → Desktop app gained an **Updating** section —
the command, the steps, and a pointer to the in-app check.

## Why

Updating is not the install procedure with a different title. It opens with **quit the app**, a step
that doesn't exist on a first install and that macOS enforces: Finder refuses to replace a running
`.app`. Left implicit, it sends people to "the application is in use" with no explanation.

## How to test (for the user)

1. Pull `develop`, open **Settings → Integrations → Desktop app**. Below "Installing" there is now
   an **Updating** section: quit first, download, clear quarantine on the new `.dmg`, drag over the
   old copy, relaunch.
2. `cd ~/Dev/monolith-desktop && pnpm install:local`, launch it.
3. **Monolith → Check for Updates…** → *"You're up to date"* (real fetch; `latestShell` is 1.0.0).
4. To see the prompt itself: set `latestShell` to `1.0.1` in `public/desktop-release.json`, promote,
   relaunch the app → **Download / Later**, and Download opens the arch-correct installer.
5. Turn off Wi-Fi and check again → *"Couldn't check for updates"*, never "up to date".

## Open threads

- **One manual reinstall bootstraps everyone.** The prompt lives in the shell, so copies installed
  today cannot announce the version that adds announcing. Same shape as the signing story — doing it
  once covers both.
- **No persistence on "Later"** — it re-asks next launch. Deliberate against carrying a settings
  file for one boolean; persist the skipped version if it nags.
- **13 commits, still no remote.** Two features deep with no backup; `gh repo create` was blocked by
  the permission classifier and needs the owner.
- When the Developer ID lands, drop the boot prompt so Squirrel and this don't both nag; keep the
  menu item and the floor.
- Verified by test and by running the real dialogs in a real main process — **not** looked at in a
  browser. The Settings change is static copy inside the existing list/kicker pattern.

## Next session entry point

Give `monolith-desktop` a git remote, or buy the Developer ID — it retires the `xattr` dance, the
"damaged" warning, and the whole manual path in one purchase.
