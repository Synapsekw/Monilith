---
type: adr
status: accepted
date: 2026-07-11
tags: [project/pulse, adr, gotcha, supabase, migrations, sync-prod]
related:
  - "[[2026-07-11-1816-auth-reset-ux-and-optionpill-dry]]"
  - "[[tests-write-to-remote-db]]"
  - "[[finish-task-cachelife-typecheck-before-build]]"
---

# Gotcha 55 — MCP `apply_migration` version drifts from the committed file; reconcile the DEV ledger before `/sync-prod`

## Context

`/sync-prod` step 1 gates on **migration-version-set parity** between DEV and PROD
(`supabase_migrations.schema_migrations`). During the 2026-07-11 sync it hard-stopped: DEV had
version `20260709174837` that PROD lacked, and the repo had a file `20260709090000_write_confinement
_cross_org_guards.sql` that DEV's ledger lacked — the **same migration under two version labels**.

Root cause: when a migration is applied to DEV via the **`supabase-dev` MCP `apply_migration`**, the
MCP stamps its own `now()`-based version (`20260709174837`), but the migration was later committed to
`supabase/migrations/` under a hand-chosen version (`20260709090000`). The DDL is byte-identical
(verified: same `name`, every `create/drop policy` + function statement matches verbatim; only the
version label and comment verbosity differ) — but the two ledgers disagree on the version string, so
the set-parity check sees a phantom divergence and refuses to sync.

`supabase db push` works off the **files**, so it applies the migration to PROD as `090000`. Left
unreconciled, DEV (`174837`) and PROD (`090000`) would still mismatch after the push and `/sync-prod`
would stop again on the same phantom.

## Decision

When `/sync-prod` (or any parity check) flags a version present on DEV but absent as a file — and the
DDL is confirmed identical to a differently-versioned committed file — **reconcile the DEV ledger to
the committed file's version** (the file is the source of truth), then push + sync:

```sql
-- on DEV, metadata-only; touches the migration ledger, not one schema object
UPDATE supabase_migrations.schema_migrations
SET version = '<committed-file-version>'
WHERE version = '<mcp-stamped-version>' AND name = '<migration-name>';
```

Confirm identity **before** relabelling — compare `name` and the actual statements
(`SELECT array_to_string(statements, E'\n') …`) against the file, not just a hash (Supabase strips
comments and re-normalizes whitespace, so raw hashes won't match even for identical DDL).

## Rationale

- The committed file is the versioned source of truth; the DEV ledger should conform to it, not the
  reverse. Relabelling PROD to the MCP version instead would create a _new_ file-vs-PROD drift.
- It's metadata-only and idempotent — no schema object changes, the applied functions/policies stay.
- Prevention is cheaper upstream: apply feature migrations by **committing the file first and letting
  `db push` apply it**, or immediately relabel the MCP-stamped row to the file version. Ad-hoc
  `apply_migration` without reconciling is what seeds the drift.

## Consequences

- Positive: parity clears, `/sync-prod` proceeds; the drift is fixed permanently (not re-papered each
  sync); future syncs of this migration are clean.
- Negative: a manual verify+relabel step whenever the drift exists; requires a DEV ledger write
  (low-risk but a write).
- Open follow-ups: consider a `/sync-prod` pre-check that, on a version-only mismatch, auto-detects an
  identical-DDL file and offers the relabel inline instead of a hard stop. Also relevant:
  `push-schema.sh` was committed non-executable (fixed `3f5829e`) — a separate hygiene miss surfaced
  the same day.

## Related

- [[2026-07-11-1816-auth-reset-ux-and-optionpill-dry]] — the session where this surfaced during promote → sync-prod
- Schema-change discipline: feature migrations via `supabase-dev` MCP, verify in a rolled-back txn ([[tests-write-to-remote-db]])
