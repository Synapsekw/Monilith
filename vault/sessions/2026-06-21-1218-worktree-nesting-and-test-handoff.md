---
type: session
date: 2026-06-21-1218
branch: develop
trigger: wrapup
status: complete
tags: [session, process, git, worktrees, subagents, workflow]
related:
  - "[[2026-06-21-0928-worktree-workflow-commit-identity]]"
  - "[[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]"
  - "[[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]"
---

# Nested worktrees for subagent-driven dev + user test-handoff at closure

## What changed

- **Relocated task worktrees from sibling `../Monolith-<name>` to nested `.claude/worktrees/<name>`** (`4f65532`). A sibling sits outside the subagent sandbox; nested is inside it, so subagent-driven development can write into the worktree. Empirically proven (a dispatched subagent Wrote/Read/Edited into `.claude/worktrees/sandbox-probe/`). Bonus: a nested worktree inherits the main checkout's `node_modules` via Node upward resolution — no install/symlink needed.
- `start-task.sh` path change + `.gitignore` `.claude/worktrees/`; `finish-task.sh` unchanged (derives paths dynamically). Marked gotcha-28 **resolved**; updated decision-22 to the nested location.
- **Added a closure rule** (`f4fda1f`): after `finish-task.sh` merges to `develop`, the final step is a numbered "How to test this" walkthrough for the user — in the closing message AND the `/wrapup` note ("How to test" section). Non-user-facing changes get a one-line "nothing to test". Wired a reminder into `finish-task.sh` and the new section into `wrapup.md`.
- Investigation only (no code): confirmed worktrees are real sibling/nested folders that appear at start and vanish at finish; the dev server runs per-worktree on its own port; agents see a frozen `develop` snapshot, not other worktrees' unmerged work.

## Why

Running many parallel sessions in one checkout caused constant collisions; worktrees isolate them, but the mandated worktree (sibling) was mutually exclusive with the mandated build method (subagent-driven dev), because subagents are sandboxed to the primary dir. Nesting the worktree under the project resolves the conflict so both hold at once. The closure rule closes the loop: every shipped feature hands the user a concrete acceptance path, not just green CI.

## How to test (for the user)

Workflow/tooling change — verify behavior on the next real task:

1. Run `scripts/start-task.sh <name>` and confirm the worktree appears at `.claude/worktrees/<name>/` (not as a sibling `../Monolith-*`), and that `git status` in the main checkout stays clean (it's gitignored).
2. In that worktree, run `pnpm typecheck` — it should resolve dependencies with no `pnpm install` (inherited `node_modules`).
3. On task completion, confirm `finish-task.sh` prints the "NEXT (closure): give the user a 'How to test this' walkthrough" reminder, and that the agent's closing message contains numbered test steps.
4. Run `/wrapup` and confirm the session note includes a filled-in "How to test (for the user)" section.

## Open threads

- `pnpm typecheck/build` from a nested worktree is proven for module _resolution_; pnpm's `.bin` PATH shim via ancestor `node_modules/.bin` is very likely fine but unconfirmed end-to-end — verify on first real nested task (fallback: cheap `pnpm install` in the worktree).
- `EnterWorktree` re-root path for subagent-driven sessions is documented but not yet exercised on a real build.
- `CONTRIBUTING.md` still describes the older flow; reconcile when next touched.
- Three stale `_draft-*.md` (06-19/06-20) from other sessions remain in `vault/sessions/` — left untouched.

## Next session entry point

Resume Phase 6 work. On the first real nested-worktree task, confirm the typecheck/build-from-worktree path, then proceed normally with `start-task.sh` → build (subagents if useful) → `finish-task.sh` → how-to-test handoff.
