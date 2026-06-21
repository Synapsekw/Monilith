---
type: session
date: 2026-06-21-1037
branch: develop
trigger: wrapup
status: complete
tags: [session, supabase, migrations, ledger]
related:
  - "[[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]]"
---

# Migration-ledger drift fix (throwaway cloud applies)

## What changed

- Resolved a Supabase migration-ledger drift: `db push --linked` failed on three REMOTE-only
  versions (`20260621044028/044145/044711`) with no local files, while `20260621000000_board_access_*`
  showed LOCAL-only-unapplied.
- Recovered the lost orphan SQL from `supabase_migrations.schema_migrations.statements` (files were
  gone from all of git): they were three iterative board-access RLS attempts; the last (`044711`) is
  byte-for-byte identical to the committed `000000` and its schema was already live.
- Verified live defs (`is_board_member`/`can_read_board`/`can_edit_board` + `boards: read if can read`
  policy) match `000000` exactly, then ledger-only repair: `reverted` the three `0440xx`, `applied`
  `000000`. No schema/data change.
- Added ADR [[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]] + commit `dc51ba7`
  (the only file change), merged to develop via finish-task.sh (`77828be`, gate green, pushed).
- Incidentally reconciled a diverged local `develop` (3 docs commits ahead / 9 behind) by rebasing
  onto `origin/develop` before the merge — those 3 phase-7a docs commits are now pushed.

## Why

`db push` was blocked, so no further migrations could ship. The drift came from hand-applying
experimental RLS DDL straight to the cloud instead of as committed versioned files — the canonical
final form was already committed and already live, so only the ledger needed reconciling.

## Open threads

- Worktree friction (noted, not blocking): `start-task.sh` worktrees have no `node_modules`;
  symlinking breaks Turbopack `next build` ("symlink points out of filesystem root") — use a real
  `pnpm install` in the worktree (~5s via the pnpm store). Candidate improvement to `start-task.sh`.
- The `060000/060001` relations pair remains LOCAL-only-pending on `task/relations-6d1` (untouched,
  expected).

## Next session entry point

Migration ledger is fully consistent (`migration list` all LOCAL==REMOTE, `db push --dry-run` clean).
Resume Phase 6d — relations + mirror (`task/relations-6d1`).
