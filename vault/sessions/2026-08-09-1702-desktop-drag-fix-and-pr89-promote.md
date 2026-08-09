---
type: session
date: 2026-08-09-1702
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  ["[[2026-08-09-gotcha-82-squash-plus-ours-heal-makes-the-main-develop-range-grow-forever]]", "[[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]]"]
---

# Desktop shell made installable, and PR #89 promoted

## What changed

- **`monolith-desktop`** (`87fbdf2`, `abdccb6`): removed `titleBarStyle: "hiddenInset"` — the window
  could not be dragged at all and the traffic lights sat on the app's own logo. Added
  `scripts/adhoc-sign.cjs` on `afterPack` and dropped `hardenedRuntime`, so an unsigned build stops
  reporting as **corrupt**. Added `pnpm install:local` (builds straight into `/Applications`, no
  download, no Apple account) and pinned DMG filenames to the download contract — the x64 build was
  shipping as `Monolith-1.0.0.dmg` while the web app advertised `-x64`, so the Intel button would
  have 404'd.
- **Settings install instructions** (`c4cd6eee`, merged `dc314ce5`): the `xattr` command targeted
  `/Applications/Monolith.app` *after* installing, a step the user can never reach. Retargeted to the
  `.dmg` and moved to step 1. Two regression tests; the ordering one was control-checked against the
  old copy.
- **Both DMGs rebuilt and re-uploaded** to the `desktop` bucket; downloaded the arm64 one back and
  verified it carries the fixed, coherently signed build.
- **Promoted `develop` → `main`** — **PR #89**, `7a9ab15e`, 35 commits. Squash divergence healed
  (`a869f337`); `origin/main` verified an ancestor of `origin/develop` again.
- **`/promote` commitlint scoping fixed** (`f0fb12ff`, `309484ac`) — see gotcha-82.

## Why

The desktop shell had passed all eight plan tasks and every gate while being un-draggable and
un-installable from a download. Both defects were invisible to typecheck, lint, tests and build, and
both were found the same way the offline-boards defects were: by running the real artifact. The
promotion then mattered because two user-visible fixes — the invite realtime delivery and the MCP
attachment tools Hermes explicitly asked for — had been sitting undeployed.

## How to test (for the user)

1. `cd ~/Dev/monolith-desktop && pnpm install:local`
2. Launch Monolith from Spotlight.
3. **Drag the window by its title bar** — it moves. This was the bug.
4. Top-left: the traffic lights sit in their own bar, the MONOLITH logo is clear beneath.
5. On https://www.monolith.works → Settings → Integrations → **Desktop app**: step 1 is now the
   Terminal command, and it names `~/Downloads/Monolith-*.dmg`, not `/Applications`.

## Open threads

- **`monolith-desktop` has no git remote.** 10 commits exist only on local disk; `gh repo create` was
  blocked by the permission classifier and not worked around. Needs the owner's go-ahead.
- **Auto-update is wired to nothing** — `releases.monolith.works/desktop/latest-mac.yml` 404s, so
  `electron-updater` finds no feed. (A parallel session has since added zip targets and an updater
  smoke test to that repo; the feed itself still needs a host.)
- **Notarization** parked on the $99 Apple Developer account. Until then every downloader needs the
  quarantine step.
- Stale local branch `task/mcp-metadata-attachments` + worktree left in place — another session's.

## Next session entry point

Production is live at `7a9ab15e` and confirmed (main CI green, Vercel `state=success`,
`desktop-release.json` serving the rebuilt DMGs). Pick up either the `monolith-desktop` remote +
update feed, or the dashboard-widget `SECURITY DEFINER`/service-client question in §3 Next, which may
be affecting users today and is still unverified in the running app.
