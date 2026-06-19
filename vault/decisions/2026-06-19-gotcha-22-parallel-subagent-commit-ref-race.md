---
type: adr
status: accepted
date: 2026-06-19
tags: [adr, gotcha, git, subagents, workflow]
related:
  - "[[2026-06-19-2152-org-admin-platform-console]]"
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
---

# Gotcha 22 — Parallel implementer subagents committing to one branch race on the branch ref

## Context

Subagent-driven execution of the org-admin plan dispatched Batch A (two independent tasks, T1 DB +
T2 Zod) as **parallel implementers in the shared `develop` checkout**, each instructed to commit its
own files by explicit path. Files were fully disjoint, so this looked safe.

## The trap

Both agents branched their commit from the same `HEAD` (`27db623`) and committed at nearly the same
time. Git's branch ref is a single pointer with a last-writer-wins update: T1 committed `9423ab9`
(advancing `develop`), then T2 committed `9091afd` **with parent `27db623`** (the HEAD it had read
before T1's commit landed) — moving `develop` to `9091afd` and **orphaning `9423ab9`**. The result:
T1's migration + regenerated types were no longer in `develop`'s history (they survived only as a
dangling commit + re-staged working-tree files), even though the agent reported success.

A second symptom from the same root: a concurrent **external** session had a file _staged_ in the
shared index when T2's `git commit` ran, so that unrelated file got swept into T2's commit under the
wrong message. `git commit` commits the whole index, not just what you `git add`ed this instant.

## The fix / rule

- **Never run two committing implementers concurrently in one shared checkout.** A shared checkout =
  one working tree + one index + one branch ref; concurrent commits race on all three.
- For genuinely parallel work, give each agent an isolated **git worktree** (separate index + ref) —
  this is exactly why AGENTS.md #6 pairs parallel batches with worktree isolation
  ([[2026-06-19-decision-21-plans-must-state-execution-dag]]).
- Otherwise **serialize**: one implementer commits, then the next. To exploit batch parallelism
  without worktrees, have agents implement on disjoint files but **leave changes uncommitted**, and
  let the controller commit each by explicit path, one at a time.
- Always `git add <explicit paths>` (never `git add -A`/`.`) so an external session's staged files
  aren't swept in — but note this does not fix the ref race, only the index-sweep symptom.

## Recovery

When a commit is orphaned this way, its tree usually remains staged in the working index (or is
reachable via `git reflog` / the dangling SHA). Re-commit the staged files into the live `HEAD` with
a plain `git commit` (it captures the staged index). Confirm with `git log --oneline` that the files
are now ancestors of `HEAD`, not just present in a dangling commit.
