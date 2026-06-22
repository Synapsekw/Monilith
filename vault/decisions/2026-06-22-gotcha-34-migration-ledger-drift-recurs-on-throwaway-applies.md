---
type: adr
status: accepted
date: 2026-06-22
tags: [adr, gotcha, supabase, migrations, ledger, parallel-sessions]
related:
  - "[[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]]"
  - "[[2026-06-21-1037-migration-ledger-drift-fix]]"
  - "[[2026-06-22-0832-phase-7b-goals-okrs]]"
---

# Gotcha 34 — Ledger drift recurs whenever a migration is cloud-applied under an auto-timestamp; relabel the version, don't re-push

## Context

Building 7b, the migration-apply step ran `supabase migration list --linked` as a pre-push safety
gate and found drift again (same class as [[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]]):

- **Local-only (committed, showing unapplied):** `20260621120000`–`150000` (advisor indexes,
  definer lockdown, mirror_enum, cell-activity-fix) — all on `develop`, all actually live.
- **Remote-only (no local file):** `20260621092204`, `100326`, `155052`, `164526`.

Querying `supabase_migrations.schema_migrations.name` for the orphans showed they were **the same
four committed migrations**, recorded under their _application-time_ timestamps instead of the
committed file's chosen version. So the schema was fully applied; only the ledger's version strings
had drifted. A blind `db push` would have tried to re-run `120000`–`150000` (e.g. `create type`
that already exists) and failed.

## Decision

When the only difference is a version-string mismatch (orphan remote name == a committed file's
name), **relabel the ledger row in place** rather than the revert+re-apply dance:

```sql
update supabase_migrations.schema_migrations
set version = '<committed-file-version>'
where version = '<orphan-application-time-version>';
```

One UPDATE per drifted pair (run via the Supabase MCP `execute_sql`, or `migration repair` if the
CLI is authed). `migration list` then shows every committed migration LOCAL==REMOTE and only the
genuinely-new migration pending; `db push` applies just that one. Verify the schema is actually
present first (`pg_enum`/`pg_proc` spot-checks) so "mark applied" is truthful.

## Consequences

- **Always gate the push.** Run `supabase migration list --linked` before any `db push` and STOP if
  anything other than your new migration is pending, or any remote-only-without-local appears. The
  gate caught this before it could fail or apply unintended migrations against the shared DB.
- **Root cause is the anti-pattern, not the fix.** Throwaway cloud applies (MCP `apply_migration`,
  ad-hoc `db execute`, or a CLI apply from a checkout with a different filename) write
  application-time version rows. Keep schema changes to committed `supabase/migrations/` files
  pushed via `db push` so file-version == ledger-version.
- **Parallel sessions on one cloud DB amplify this.** Diagnose (read `schema_migrations.name`)
  before repairing, and confirm no in-flight session owns an orphan version. Here all four orphans
  were `develop`'s own migrations — zero entanglement with the concurrent 6d-3 session — so the
  relabel was safe and zero-schema-change.
