---
type: adr
status: accepted
date: 2026-06-21
tags: [adr, gotcha, supabase, migrations, ledger, rls]
related:
  - "[[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]"
  - "[[2026-06-19-gotcha-18-create-or-replace-function-overload]]"
---

# Gotcha 29 — Migration-ledger drift from throwaway cloud applies; reconcile with `migration repair`, not a re-push

## Context

`pnpm exec supabase db push --linked` started failing with:

```
Remote migration versions not found in local migrations directory: 20260621044028 20260621044145 20260621044711
```

`supabase migration list --linked` showed the drift:

- `20260621000000_board_access_require_membership_and_returning` — **LOCAL only**, not applied remote
- `20260621044028`, `20260621044145`, `20260621044711` — **REMOTE only**, no local `.sql` files
- everything else in sync

The three `.sql` files were gone from every git ref, worktree, stash, and dangling commit
(`git log --all`, `git fsck`, `git worktree list` all checked) — the SQL was not recoverable from
git.

### What the three orphaned versions actually were

Supabase stores every applied migration's SQL in `supabase_migrations.schema_migrations.statements`
(a `text[]`). Even with the files gone, the SQL is recoverable from the remote ledger:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
where version in ('20260621044028','20260621044145','20260621044711');
```

They were three **iterative cloud-applied attempts** at the same board-access RLS fix that develop's
committed `20260621000000` migration represents in clean final form:

1. `044028` `fix_boards_select_policy_insert_returning` — first stab: rewrote only the `boards`
   select policy to `created_by OR (inline board_members subquery)`. No `is_org_member` gate.
2. `044145` `fix_boards_select_policy_insert_returning_v2` — added the `is_board_member()` definer
   helper; policy → `created_by OR is_board_member(id)`. Still no membership gate.
3. `044711` `board_access_require_membership_and_returning` — the complete final form:
   `is_org_member` gate restored inside `can_read_board`/`can_edit_board`, boards policy →
   `is_org_member(org_id) AND (created_by OR is_board_member(id))`.

`044711`'s SQL is **byte-for-byte identical** to develop's committed
`20260621000000_board_access_require_membership_and_returning.sql`. The committed migration is simply
that last throwaway promoted to a clean, earlier-timestamped file. Its schema effect was **already
live** (applied via the three cloud applies); it showed as unapplied only because its version string
wasn't in the ledger. Verified the live `is_board_member` / `can_read_board` / `can_edit_board`
definitions and the `boards: read if can read` policy all match `000000` exactly before touching
anything.

## Decision

When the ledger drifts because throwaway iterations were applied straight to the cloud and the clean
final form is already committed (and already live), reconcile the **ledger only** — do not re-push,
`db pull`, or drop/recreate anything:

```bash
# delete the superseded throwaway rows
supabase migration repair --status reverted 20260621044028 20260621044145 20260621044711 --linked
# record the canonical migration whose effect is already live
supabase migration repair --status applied 20260621000000 --linked
```

`migration repair` edits only `supabase_migrations.schema_migrations`; it runs no DDL and changes no
schema or data. Result: `migration list` shows `000000` as LOCAL == REMOTE, the `0440xx` rows are
gone, and `db push --dry-run` reports "Remote database is up to date."

**Precondition (must verify, never assume):** the live schema already equals what the committed
migration defines. If it doesn't, this is the wrong path — `db pull` the remote delta into a new
migration, reconcile by hand, and get human review before committing. Here every object matched, so
the repair was safe.

## Consequences

- This repair is **ledger-only**: no migration file is added or changed. The only committed artifact
  is this note — `000000` already exists on develop.
- The recovery technique generalizes: lost migration SQL is forensically recoverable from
  `schema_migrations.statements` even when it's gone from git. Reach for that before assuming SQL is
  unrecoverable.
- Root cause is process: RLS iterations were applied to the cloud directly instead of as versioned
  files committed first. Author the migration **file**, commit, then `db push` — don't hand-apply
  experimental DDL to the linked project, or the ledger and git history diverge.
