---
type: adr
status: accepted
date: 2026-07-25
tags: [project/pulse, adr, gotcha, supabase, migrations, sync-prod, security]
related:
  - "[[2026-07-25-0821-develop-sync-acl-migration-backfill]]"
  - "[[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]"
  - "[[2026-07-24-1950-mcp-server-oauth]]"
---

# Gotcha 57 — a DEV-applied migration with no committed file is invisible to every gate; check the ledger against `supabase/migrations/`, not just versions against PROD

## Context

Routine post-pull hygiene on 2026-07-25 compared the `supabase-dev` ledger against
`supabase/migrations/`. DEV had `20260724134101_mcp_oauth_vault_cleanup_acl` **applied with no file in
the repo** — two statements hardening an ACL the main MCP-OAuth migration missed:

```sql
revoke all on function public.oauth_tokens_vault_cleanup() from public, anon, authenticated;
grant execute on function public.oauth_tokens_vault_cleanup() to service_role;
```

`oauth_tokens_vault_cleanup()` is the `SECURITY DEFINER` before-delete trigger on `oauth_tokens` that
deletes from `vault.secrets`. `20260724133321_mcp_oauth.sql` revokes + re-grants its two sibling
bridge helpers but left this one on Postgres's default `execute to public`. The fix was applied to DEV
during the build session and never committed.

Nothing catches this:

- **`typecheck`/`lint`/`test`/`build`** never look at the ledger.
- **`finish-task.sh`** gates on duplicate migration versions, not on DEV-only ones.
- **`reconcile-migration-version.sh`** ([[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]])
  assumes the committed file **exists** and only the version label drifted — it exits with
  "the committed file is the source of truth" and cannot help when there is no file.
- **`/sync-prod`'s DEV↔PROD version parity** would flag it only as "DEV ahead", the same shape as any
  not-yet-pushed migration — and `supabase db push` works off **files**, so it can never resolve it.

So DEV drifts silently and the promotion ships prod a definer function that deletes Vault rows,
publicly executable. The gap is a **security regression that hides as ordinary pending-migration
noise**.

## Decision

The ledger↔files comparison is its own check, run in **both** directions:

1. `mcp__supabase-dev__list_migrations` vs `ls supabase/migrations/` — any DEV version with no file is
   a drift, not a pending push.
2. Recover the DDL from the ledger before writing anything:
   `select version, name, array_to_string(statements, E'\n') from supabase_migrations.schema_migrations where version = '<v>'`.
3. **Backfill the file at the DEV version, do not mint a new stamp.** `new-migration.sh` is for _new_
   DDL; the DDL here is already applied. A fresh stamp would mean two versions for one change plus a
   gotcha-55 reconcile. This is the one sanctioned exception to "never hand-write a version stamp" —
   the stamp isn't invented, it's copied from the ledger.
4. Prefer idempotent statements in the backfilled file (`revoke`/`grant`, `create or replace`) so
   re-application anywhere is a no-op, and verify the live ACL afterward:
   `select proname, prosecdef, proacl from pg_proc … where proname like '<prefix>%'`.

Run the check at the end of any session that applied migrations via MCP, and before any `/promote`
or `/sync-prod`.

## Rationale

- Version parity against PROD answers "is prod behind?", never "is this change in git at all?" —
  a DEV-only migration is indistinguishable from a healthy pending one by version set alone.
- The `revoke`/`grant` shape makes this class of miss especially quiet: no table, no type, no column,
  so `db:types` output is byte-identical and the regenerate-types habit gives false reassurance.
- Backfilling at the ledger version keeps filename == ledger version true, which is the invariant the
  whole migration toolchain (and gotcha-55's reconcile) depends on.

## Consequences

- Positive: the ACL rides the next `/sync-prod` instead of being lost; a repeatable recovery path
  (read statements from the ledger → backfill at that version) for any future DEV-only migration.
- **Automated 2026-07-25** — `scripts/check-migration-ledger.mjs` (`pnpm db:ledger-check`) diffs the
  live ledger against `supabase/migrations/` in both directions. A ledger row with no committed file
  exits 2; a committed-but-unapplied file is a warning at exit 0. `finish-task.sh` **blocks** on
  drift (and warns-but-continues when the DB is unreachable — exit 3 — so the gate can never wedge a
  merge); `/sync-prod` step 1b checks DEV **and** PROD and stops on any non-zero, including
  unavailable; `/promote` preflight stops on DEV drift. The gotcha-43 duplicate-version guard moved
  out of `finish-task.sh` into the same script, so migration hygiene has one implementation.
  Design: `docs/superpowers/specs/2026-07-25-migration-ledger-drift-check-design.md`.
- Known limit: a ledger-only version whose file exists in a **sibling worktree** is reported as
  unmerged parallel work, not drift — necessary to stop the shared-DEV false positive from disabling
  the gate, and safe because that DDL is in git.
- Not automated in CI: `.env.prod.local` is gitignored, so a workflow needs `DEV_SUPABASE_DB_URL` as
  a repository secret. Deliberately deferred.
- Open follow-up: audit the other definer functions added around 2026-07-24 for the same missed ACL.

## Related

- [[2026-07-25-0821-develop-sync-acl-migration-backfill]] — the session that found it
- [[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]] — the version-label
  sibling of this drift; its script covers the file-exists case only
- [[2026-07-24-1950-mcp-server-oauth]] — the build session whose ACL patch went uncommitted
