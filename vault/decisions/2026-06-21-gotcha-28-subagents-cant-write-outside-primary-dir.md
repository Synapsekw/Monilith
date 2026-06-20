---
type: adr
status: accepted
date: 2026-06-21
tags: [adr, gotcha, subagents, worktrees, parallel]
related:
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
  - "[[2026-06-21-0020-in-app-invite-acceptance]]"
---

# Gotcha 28 — Subagents can't Write/Bash outside the primary working dir → git-worktree parallel dispatch fails

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
