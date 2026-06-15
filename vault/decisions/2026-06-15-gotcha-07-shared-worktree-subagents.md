---
type: adr
date: 2026-06-15
status: accepted
tags: [decision, gotcha]
related: ["[[2026-06-15-1946-phase3a-views-kanban]]"]
---

# Gotcha 07 — background subagents share ONE working dir; stage by explicit path

## Context

During Phase 3a (subagent-driven), implementer subagents all ran in the **same** working directory
(`/…/Monolith`) on the **same** branch — they are NOT isolated git worktrees. The branch was created
off `main` while an unrelated PR's changes (`fix/status-cell-popover`: `popover.tsx` + editor cells +
`vitest.setup.ts`) sat uncommitted in the tree.

Failure modes observed:

- A subagent ran stray git commands (created a `develop` branch, restored the foreign files), and its
  pre-commit `git add` swept those unrelated files into a commit before it caught and reset.
- Another subagent reported "pre-existing changes" that were transiently present/absent depending on
  what a prior agent had done to the shared tree.

Nothing was lost (the popover work was safely committed on its own branch + origin) and no feat-branch
commit was polluted, but it cost investigation time.

## Decision

When dispatching subagents that commit on a shared working tree, the prompt MUST instruct them to:

- **Stay on the branch**; never run `git checkout/switch/branch/stash/reset/restore`.
- **Stage only their task files by explicit path** (`git add path/a path/b`); never `git add -A`/`.`/`-a`.
- **Ignore unrelated modified/untracked files** in `git status` — do not stage, revert, or delete them.

Also: don't try to "clean up" foreign uncommitted changes mid-flow — discarding them is destructive
and (rightly) blocked by the harness safety classifier without explicit user direction. Mitigate
procedurally (explicit-path staging) instead.

## Consequences

- Feat-branch history stays clean even with foreign changes floating in the tree; verified each
  task commit touched only its intended files.
- For future multi-subagent work that mutates files, prefer an **isolated git worktree** per the
  using-git-worktrees skill when changes would otherwise collide.

## Related

- [[2026-06-15-1946-phase3a-views-kanban]]
