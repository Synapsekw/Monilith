---
type: session
date: 2026-06-21-1416
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-21-0928-worktree-workflow-commit-identity]]"
---

# /promote — develop→main promote-and-watch command

## What changed

- Brainstormed → spec'd → built **`/promote`** (`.claude/commands/promote.md`) + design spec
  (`docs/superpowers/specs/2026-06-21-promote-command-design.md`). Commits `efd4504`, `f7a82f0`,
  `9aa1de8` — **pushed, `develop == origin/develop`**.
- Promote-and-watch the **whole `develop → main`** bundle: preflight → validate develop CI +
  commitlint on the delta → auto-compose the PR title/body → **gate (explicit confirm) before the
  merge** → watch GitHub Actions + Vercel deploy → formatted bullet report. It's the **promote**
  counterpart to `finish-task.sh` (which owns `task/* → develop`).
- Key mechanism finding: **no `vercel` CLI needed** — Vercel posts the prod-deploy state as a GitHub
  **commit status** (context `"Vercel"` + `target_url`), read via
  `gh api repos/Synapsekw/Monilith/commits/<sha>/status`; GH Actions watched via `gh run watch`.
- Dry-ran read-only against the live repo: it correctly **stopped on its own unpushed commit**
  (step-1 hard stop), develop CI green, commitlint exit 0, **644 valid conventional commits**,
  **develop is 655 commits ahead of main**.
- Two refinements after the dry-run: (1) a **dirty working tree is a NOTE, not a stop** (ignore
  `.obsidian/*`; the real hard stop is _un-pushed local `develop` commits_, since promotion ships
  only the remote); (2) made the **all-or-nothing bundle** rule explicit — promotion is always the
  complete delta, never cherry-picked; keep work out of production by keeping it off `develop`.

## Why

The `develop → main` promotion was the one **manual gap** in the workflow — `finish-task.sh` covers
`task/* → develop`, but nothing scripted the production promotion AGENTS.md describes as "open a
develop→main PR, merge once CI passes." `/promote` closes that with a gated, watched, reported flow.

## How to test (for the user)

This is a dev-workflow tool, not user-facing app behavior — but you can exercise it safely:

1. From the **main checkout** (`/Users/danijeljovanovic/Dev/Monolith`) on `develop`, pull latest, then
   run **`/promote --dry-run`**.
2. Expect it to now clear step 1 (no unpushed commits) and print: the **655-commit delta**, develop
   CI = green, commitlint pass, and the **composed promotion PR title + body** — with **nothing
   pushed, no PR opened, `main` untouched**.
3. When ready for the real thing, run **`/promote`** (no flag): same checks, then it opens the PR and
   **stops to ask for explicit confirmation** before the production-deploying merge.

## Open threads

- **655-commit `develop → main` promotion still pending** — review the composed PR body via
  `--dry-run` before any real run. Per north-star §3 Branch line, `main` is held with a **manual gate**
  ("WebGL landing dep needs a cross-browser check") — clear that before the first real `/promote`.
- Optional future hardening (in the spec's "out of scope"): extract the deterministic preflight into a
  testable `scripts/` helper if `/promote` ever earns unit tests.

## Next session entry point

Run `/promote --dry-run` to eyeball the 655-commit bundle PR; resolve the WebGL cross-browser manual
gate, then do the first real `develop → main` promotion via `/promote`.
