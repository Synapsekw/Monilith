---
type: adr
status: resolved
date: 2026-06-21
tags: [adr, gotcha, subagents, worktrees, parallel]
related:
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
  - "[[2026-06-21-0020-in-app-invite-acceptance]]"
  - "[[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]"
---

# Gotcha 28 — Subagents can't Write/Bash outside the primary working dir → git-worktree parallel dispatch fails

## Update (2026-06-21) — RESOLVED: nest the worktree inside the project

The "untested" escape hatch below was tested and **works**. The blocker was worktree _location_,
not worktrees per se: a **sibling** `../Monolith-<name>` is outside the primary dir → outside the
subagent sandbox. A worktree **nested at `.claude/worktrees/<name>`** is _inside_ the primary dir →
inside the sandbox, so dispatched subagents Read/Write/Edit into it freely.

Verified empirically: a `general-purpose` subagent dispatched from a main-rooted session
successfully `Write`/`Read`/`Edit`-ed a file under `.claude/worktrees/sandbox-probe/` with zero
permission errors. Bonus: the nested worktree resolves the **main checkout's `node_modules`** via
Node's upward module resolution (`require.resolve('next')` → `/Monolith/node_modules/...`), so no
install/symlink is needed.

The "shared-index races on commit" worry was unfounded — each git worktree has its **own** index
and HEAD, so committing in a worktree never races the main checkout's index.

The fix is now the standard workflow (`scripts/start-task.sh` creates `.claude/worktrees/<name>`;
`.claude/worktrees/` is gitignored; a subagent-driven session re-roots via
`EnterWorktree({ path })`). The original mitigation below (disjoint files in the main checkout) is
no longer necessary, but is kept for the record. See
[[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]] and AGENTS.md #1.

## Context

AGENTS.md rule 6 says parallel file-mutating tasks should run in isolated **git worktrees**
(`superpowers:using-git-worktrees`) to avoid clobbering the shared `develop` checkout. During the
invite-acceptance build I created three sibling worktrees (`../Monolith-wt-task{2,3,4}`, with
`node_modules` symlinked) and dispatched one implementer subagent per worktree.

All three immediately failed: the subagents' `Write`/`Edit`/`Bash` calls were **permission-denied**
because the worktrees live **outside the primary working directory** (`/Users/.../Monolith`). The
harness sandboxes subagent file/shell ops to the project root, so anything under a sibling path is
unwritable. (Related: gotcha-22 — subagents also can't run `git commit`; the orchestrator commits.)

## Decision

Do **not** use sibling-directory git worktrees for parallel subagent dispatch in this harness.
Instead, to parallelize independent tasks:

1. Dispatch the implementers **in the main checkout**, scoped to **disjoint file sets**.
2. Tell each to run **only its own test file** (`pnpm test <file>`) — never full `pnpm typecheck`
   or full `pnpm test`, which would trip over another agent's half-written files.
3. Tell each **not to touch git**; the orchestrator commits each task's paths sequentially, then
   runs the full typecheck/lint/test/build gate once at integration.

This keeps real parallelism (3 implementers ran concurrently, ~40s each) without the sandbox wall.
If true on-disk isolation is ever required, the worktree would have to live **inside** the project
root (and be gitignored) — untested, and it reintroduces shared-index races on commit.

## Consequences

- The "parallel batches → worktree per agent" line in plans is aspirational under this harness;
  treat "disjoint files in the main checkout + orchestrator-serialized commits" as the working
  equivalent.
- Cross-task type errors (e.g. a query returning `status: string` vs a narrowed prop union) surface
  only at the orchestrator's integration typecheck, not in any single agent — expect to fix them there.
