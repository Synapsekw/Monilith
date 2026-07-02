---
type: session
date: 2026-06-26-1522
branch: develop
trigger: wrapup
status: complete
tags: [session, sync-prod, migrations, ops]
related: []
---

# /sync-prod — build, first real prod sync, and hardening

## What changed

- Built `/sync-prod` end-to-end via subagent-driven-development (6 tasks, per-task + final opus review), merged `task/sync-prod` → `develop` (`379a165`): pure logic in `src/lib/sync-prod/`, IO shells in `scripts/sync-prod/`, the `.claude/commands/sync-prod.md` runbook, and a `/promote` hand-off offer.
- Ran the **first real dev→prod publish**: bootstrapped prod schema (all migrations), restored data, copied 9 storage blobs. Parity verified equal (orgs 126, boards 102, items 269, cell_values 613, attachments 7, users 138, objects 9).
- Fixed a latent **duplicate-migration-version** bug — three 2026-06-23 files shared `20260623120000`; renamed to dev's real ledger versions (`f032be1`). Reconciled the partially-bootstrapped prod via a one-row ledger `UPDATE` + `db push --include-all`.
- Hardened the scripts (`6f79499`): Docker-free `pg_dump`/`psql` (honoring `PG_BIN`), corrected the `pg_dump -n`+`-t` gotcha that silently dropped `public`, and excluded `storage` from SQL (owned by `sync-storage.ts`; `storage.migrations` is supabase_storage_admin-owned).
- All of the above promoted to production in `#37` (`19e86e0`).

## Why

Prod was an empty mirror with no schema. `/sync-prod` makes dev → prod a one-command, full-replace publish (agent does read-only checks; user runs every prod write). The first run doubled as the rehearsal and surfaced real bugs (duplicate migrations, Docker-only dump, IPv6 direct connection, storage permissions) now fixed in the committed scripts.

## How to test (for the user)

1. Go to the **production** app URL.
2. Log in with your **dev credentials** (auth users were synced).
3. Confirm your dev **boards, items, and attachments** are present — prod mirrors dev.
4. To re-sync later: ensure `.env.prod.local` has session-pooler `*_DB_URL`s + `PG_BIN`, then run `/sync-prod` (or the scripts: `dump-dev.sh` → `restore-prod.sh <dump>` → `pnpm sync:storage`).

## Open threads

- **Dev ledger drift:** dev's `schema_migrations` under-counts (67 vs 69) — `20260625120000_item_created_by` applied to dev's schema but unrecorded. Harmless to schema; reconcile with `supabase migration repair --status applied` when convenient.
- `/sync-prod` was driven manually this run to debug; re-run it as the single orchestrator now that scripts are hardened.
- Security: prod DB password printed in-terminal during config; rotating it is advisable. (Leaked `.env.prod.local.bak` deleted.)

## Next session entry point

`/sync-prod` is live and prod is a verified mirror. Next: optionally reconcile dev's migration-ledger drift, and exercise `/sync-prod` as a one-shot to confirm the hardened scripts run clean unattended.
