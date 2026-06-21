---
type: decision
date: 2026-06-21
status: accepted
tags: [decision, gotcha, worktrees, tooling, build]
related:
  [
    "[[2026-06-21-1304-phase7a-portfolios]]",
    "[[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]",
    "[[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]",
  ]
---

# gotcha-31: a nested worktree needs a real `pnpm install`, not inherited `node_modules`

## Context

The nested-worktree workflow (`.claude/worktrees/<name>`, gotcha-28 resolution) claimed a worktree
"inherits the main checkout's `node_modules` via Node upward resolution, so no install is needed."
That is **only half true**, and the gap broke the gate during the Phase 7a build.

## The trap

1. **CLI binaries aren't on the script PATH.** Node's upward resolution finds packages for runtime
   `require()`, but `pnpm run <script>` puts only the _local_ `node_modules/.bin` on PATH and does
   **not** walk up. So `pnpm typecheck` / `lint` / `test` fail with `tsc: command not found` in a
   worktree that has no `node_modules`.
2. **A symlink fixes the bins but breaks the Turbopack build.** Symlinking
   `node_modules -> <main>/node_modules` unblocks `tsc`/`eslint`/`vitest`, but `next build` (default
   **Turbopack**) rejects it: _"Symlink [project]/node_modules is invalid, it points out of the
   filesystem root."_ So `pnpm build` — which `finish-task.sh` runs — fails.

## Resolution

- **Run a real `pnpm install` in the worktree.** It's ~6s (pnpm hardlinks from the global store) and
  produces a real `node_modules` with a working `.bin`, which satisfies _both_ the script PATH and
  Turbopack. `.claude/worktrees/` is gitignored, so it's never committed.
- **Recommended fix:** have `scripts/start-task.sh` run `pnpm install --prefer-offline` in the new
  worktree (or at least print the instruction), and drop the "no install needed" claim from
  AGENTS.md / decision-22.

## Bonus trap (same session): `finish-task.sh` vs a diverged main checkout

`finish-task.sh` merges through the **main checkout's** `develop` (`checkout` → `pull --ff-only` →
`merge --no-ff` → push). When the main checkout has _another session's_ diverged/unpushed commits (or
a dirty tree), it either fails at `pull --ff-only` or would sweep that other session's work into the
push. **Fallback:** if your branch already merged current `origin/develop` into itself, push the
branch tip straight to `origin/develop` (a fast-forward containing only your commits), then
`git worktree remove --force` + `git branch -d` manually. Worth teaching `finish-task.sh` to detect
divergence and offer this path.
