---
type: adr
date: 2026-06-21
status: accepted
aliases: [worktree-temp-branches, task-branch-lifecycle, pinned-commit-identity]
tags: [decision, process, git, worktrees, branching, vercel, deploy]
related:
  - "[[00-north-star]]"
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
  - "[[2026-06-15-gotcha-07-shared-worktree-subagents]]"
  - "[[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]"
  - "[[2026-06-20-gotcha-25-auth-email-prod-deploy]]"
  - "[[2026-06-17-1947-develop-main-promotion]]"
---

# Decision 22 — Worktree + temporary `task/<name>` branches per session; pinned commit identity

## Context

The previous branch model (decision of 2026-06-16) was **two long-lived branches, all work on
`develop`, no per-feature branches** — adopted because the old `feat/…`-off-`main` per-feature-PR
flow caused multi-session collisions. But the single developer routinely runs **many parallel
Claude sessions in the same checkout**, building different things at once. With everyone on
`develop` in one folder, those sessions edit and commit the same working tree simultaneously and
keep colliding. "Just turn temp branches back on" does **not** fix this on its own: a git branch
belongs to the _folder_, not the session, so a `git checkout -b` in the shared checkout switches
every session at once — strictly worse. The only thing that gives real parallel isolation is
**separate folders on disk**, i.e. git **worktrees**.

Separately, a deploy problem surfaced. Pushes authenticate correctly (macOS keychain → the
`Synapsekw` GitHub account, which owns `Synapsekw/Monilith` and is the account Vercel deploys
from). But the **commit author email drifted between sessions** — some commits as
`Synapse-Solutions <info@synapse-solutions.ai>`, others as `Danijel Jovanovic
<danijel@synapse-solutions.ai>`. Vercel decides whether to build a commit by matching the **author
email** to a GitHub account with project access. `info@synapse-solutions.ai` is verified on
Synapsekw; `danijel@…` is not — so the `danijel@…` commits were getting their deploys **silently
skipped**.

## Decision

Replace working agreement #1. Two changes, one workflow:

1. **One worktree + one temporary `task/<name>` branch per building session.** The main checkout
   stays parked on `develop` as the **integration home** (no building in it). Each building session
   runs `scripts/start-task.sh <name>`, which cuts `task/<name>` off the latest `origin/develop` in
   a worktree nested at `.claude/worktrees/<name>` and pins the commit identity. Separate folders =
   separate files = no live stomping between parallel sessions. (Nested — not a sibling
   `../Monolith-<name>` — so the worktree stays inside the subagent sandbox and subagent-driven
   development can write into it; see [[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]].
   `.claude/worktrees/` is gitignored; a subagent-driven session re-roots via `EnterWorktree({ path })`.)
   **A task is not complete until it is
   merged into `develop` AND cleaned up:** the four green checks pass → `task/<name>` merges
   **directly into `develop`** (local merge; CI on `develop` is the safety net) → the worktree is
   removed and the branch deleted. `scripts/finish-task.sh` does all of this. An agent that leaves
   a `task/*` branch un-merged or a worktree behind has **not finished and must say so** — it may
   not report completion. Trivial one-liners/typos are exempt and may go straight on `develop`.

2. **Pin the commit identity to `Danijel Jovanovic <info@synapse-solutions.ai>`** — the email
   verified on the Synapsekw account Vercel deploys from. `start-task.sh` re-asserts it in every
   worktree so no session can drift back to `danijel@…` and get its deploy skipped. (Display name
   is cosmetic; the email is what Vercel keys on. Pushes were already correct and need no change.)

`develop → main` promotion (the only thing that deploys production) is unchanged. Enforcement lives
in `AGENTS.md`, which outranks skills and survives Superpowers plugin updates.

## Consequences

- Parallel sessions stop stomping each other's files; independent work merges into `develop` with
  zero conflict. Two sessions editing the **same lines** still produce a normal merge conflict, but
  at one controlled moment (the merge) instead of mid-work chaos.
- Vercel stops silently skipping deploys caused by author-email drift; every commit is authored by
  an email Vercel recognizes.
- Slightly more git plumbing per session, fully absorbed by the two helper scripts — one command to
  start, one to finish.
- This supersedes the 2026-06-16 "no per-feature branches, all on `develop`" decision; the worktrees
  it always allowed for isolated parallel work are now the default for every building session.

## How to apply

Start a building session with `scripts/start-task.sh <name>` and `cd` into the worktree it prints.
Build, commit (identity is already pinned), keep work bounded to that folder. When the four checks
are green, run `scripts/finish-task.sh` from inside the worktree — it merges into `develop`, pushes,
removes the worktree, and deletes the branch. Do not call a task done while its branch or worktree
still exists. For trivial edits, skip the worktree and commit on `develop` in the main checkout.
