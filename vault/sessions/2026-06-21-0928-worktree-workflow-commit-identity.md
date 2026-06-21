---
type: session
date: 2026-06-21-0928
branch: develop
trigger: wrapup
status: complete
tags: [session, process, git, workflow, vercel]
related:
  - "[[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]"
---

# Worktree-per-session workflow + pinned commit identity

## What changed

- Replaced working agreement #1 in `AGENTS.md`: every building session now runs in its own git worktree on a temporary `task/<name>` branch; a task is not "done" until merged into `develop` AND the worktree/branch are deleted. Trivial edits stay exempt.
- Added `scripts/start-task.sh` (cuts `task/<name>` off latest `origin/develop` in `../Monolith-<name>`, pins identity) and `scripts/finish-task.sh` (runs the 4 checks → merge to `develop` → push → remove worktree + delete branch).
- Pinned commit identity to `Danijel Jovanovic <info@synapse-solutions.ai>` via `git config` and re-asserted per worktree in `start-task.sh`.
- Recorded rationale as ADR [[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]; updated the `pulse-working-agreement` auto-memory.
- Commit `ccb5162` (4 files), pushed to `origin/develop`.

## Why

Running many parallel Claude sessions in one shared checkout kept colliding because a branch belongs to the folder, not the session — temp branches alone can't isolate them, only separate folders (worktrees) can. Separately, the commit-author email drifted between sessions (`danijel@…` vs `info@…`); Vercel matches the author email to a GitHub account with access, and `danijel@…` isn't verified on the `Synapsekw` account it deploys from, so those commits were getting their deploys silently skipped.

## Open threads

- Scripts verified by `bash -n` + path-resolution check, but not yet exercised end-to-end on a real task (first `start-task.sh`/`finish-task.sh` run will confirm the merge/cleanup path).
- `CONTRIBUTING.md` still describes the old "all on develop" model — not updated this session; reconcile when next touched.
- Three stale `_draft-*.md` (06-19/06-20) remain in `vault/sessions/` from prior sessions — left untouched.

## Next session entry point

Resume Phase 6d (relations + mirror). For any real build, start with `scripts/start-task.sh <name>`, work in the worktree, and close with `scripts/finish-task.sh`.
