---
type: session
date: 2026-06-22-1241
branch: develop
trigger: wrapup
status: complete
tags: [session, worktrees, tooling, gotcha]
related: ["[[2026-06-21-gotcha-31-worktree-needs-real-install]]"]
---

# Worktree install gate fix — `start-task.sh` now installs deps + links `.env.local`

## What changed

- `scripts/start-task.sh`: after `worktree add`, run `pnpm install --prefer-offline` (~6s warm,
  hardlinked) and symlink `.env.local` from the main checkout. Corrected the stale "inherits
  node_modules, no install needed" comment.
- `AGENTS.md`: corrected the matching "inherits node_modules… no install" claim to state the install
  is required (imports walk up; pnpm won't reach an ancestor `node_modules/.bin`).
- Backfilled the two in-flight worktrees (`group-column-headers`, `move-to-group-automation`) with
  `pnpm install` + `.env.local` so those live sessions are unblocked.
- Updated [[2026-06-21-gotcha-31-worktree-needs-real-install]] to **implemented** (commit `d70f5bb`)
  and the auto-memory note `worktree-gates-binaries-turbopack` to **resolved**.
- Commit `d70f5bb` on `develop` (pushed).

## Why

Agents dispatched into worktrees (e.g. via `/whats-next`) kept failing the gates with
`vitest: command not found`. Root cause: pnpm doesn't add an ancestor `node_modules/.bin` to a
script's PATH (Node imports walk up, bin executables don't), and Turbopack needs a local
`node_modules`. gotcha-31 had diagnosed this a day earlier and recommended exactly this fix — but it
stayed prose, never wired into the helper, so it kept biting.

## How to test (for the user)

1. `cd /Users/danijeljovanovic/Dev/Monolith && scripts/start-task.sh throwaway-check`
2. Watch for `→ installing dependencies in the worktree` and `→ linked .env.local → main checkout`.
3. `cd .claude/worktrees/throwaway-check && pnpm test` → runs (no "command not found").
4. Teardown: `cd /Users/danijeljovanovic/Dev/Monolith && git worktree remove --force .claude/worktrees/throwaway-check && git branch -D task/throwaway-check`

## Open threads

- gotcha-31's "bonus trap" (`finish-task.sh` vs a diverged main checkout) is still unaddressed —
  the script doesn't detect divergence or offer the fast-forward fallback.
- `pnpm install` emits an `esbuild`/`approve-builds` notice and runs husky `prepare` in each
  worktree — harmless, but noisy in the start-task output.

## Next session entry point

Tooling is solid for worktree gates. If picking up tooling hardening, teach `finish-task.sh` to
detect a diverged main checkout and offer the branch-tip fast-forward path (gotcha-31 bonus trap).
Otherwise resume the in-flight board work (`group-column-headers`, `move-to-group-automation`).
