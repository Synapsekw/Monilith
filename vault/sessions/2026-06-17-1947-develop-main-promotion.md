---
type: session
date: 2026-06-17-1947
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[pulse-working-agreement]]"]
---

# develop → main promotion (Phases 0–4)

## What changed

- No code changes. Merged the standing promotion PR **#16** `develop → main`, advancing `main`
  for the first time past Phase 2b — now carries Phases 0–4 + dark reskin + landing + sidebar.
- `main` HEAD is now `30a9cf3` (squash commit). PR title/body refreshed to reflect full scope
  (the old title was stale at "4a+4b").
- Confirmed `develop` was already fully synced with `origin/develop` (Phase 2c had been pushed;
  north-star's "unpushed" note was stale).

## Why

`develop` was green with four phases of unshipped work and nothing in `main` past Phase 2b.
Promoting now banks that integration cheaply while the tree is clean, before layering on Phase 5+.

## Open threads

- **Merge method locked to squash.** Repo disallows merge-commits; rebase failed (merge commits
  in `develop`'s history can't be linearized). So `main` got one squash commit and now diverges
  permanently in history from `develop`. Future promotions still diff correctly (tree-based), but
  `main` will never mirror `develop`'s granular commits unless merge-commits are re-enabled.
- **No Vercel project yet** — testing is local-only; promotion to `main` is integration, not a
  deploy. Vercel gets set up once the app is feature-complete.

## Next session entry point

Pick a build target: light-mode reskin (closes the RS thread), Dashboard view (Phase 8 slice —
`dashboard` view_kind migration + recharts), or Phase 5 Automations (largest). Brainstorm first.
