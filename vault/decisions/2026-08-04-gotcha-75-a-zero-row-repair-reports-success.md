---
type: decision
date: 2026-08-04
tags: [decision, gotcha, tooling, migrations]
related:
  - "[[2026-08-04-1907-promote-and-ai-write-followups]]"
  - "[[2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation]]"
---

# Gotcha 75 — a repair that matches zero rows reports success

## What happened

`gotcha-55` (the `supabase-dev` MCP's `apply_migration` stamping its own version rather than the
filename it was handed) is no longer occasional — it fired on **4 of 4** migrations on 2026-08-03 and
again on the one migration of 2026-08-04. **5 of 5.** The sanctioned repair is
`scripts/reconcile-migration-version.sh`, which relabels the ledger row to the committed filename's
version.

The script prints an `UPDATE ... WHERE name = '<slug>'` — the bare slug, e.g.
`board_thread_org_coupling`. But the ledger row's `name` column holds the **full stamped filename**.
So the `UPDATE` matches **zero rows**, Postgres reports `UPDATE 0`, and the script exits 0. The
repair looks like it worked. The drift is still there.

It was caught only because `pnpm db:ledger-check` was run afterwards and disagreed. Had that step
been skipped — and it is easy to skip, since the repair "succeeded" — a migration would sit on DEV
under a version no committed file claims, which is precisely the state `finish-task.sh` blocks on
(gotcha-57) and precisely the state that makes a promotion ship code whose schema is unreproducible.

## Why it matters here

This is the same shape as [[2026-08-04-gotcha-74-a-mitigation-that-never-executes-is-not-a-mitigation]],
one layer down. There, a named control never ran. Here, a named repair runs and does nothing. In both
cases the *absence of an error* was read as evidence of the *presence of an effect*.

A no-op `UPDATE` is not an error condition in SQL. Nothing surfaces it unless you look at the affected
row count, and neither the script nor the operator was looking. The failure is invisible in exactly
the way that matters: it is silent, it is on the critical path of every future schema change, and the
thing it breaks (ledger integrity) is itself only checked by a separate step that the false success
encourages you to skip.

## The rule

**A repair must assert what it repaired.** Any script that mutates state to fix a known drift must
verify the row count it touched and fail loudly on zero. "Ran without error" is not "did something".

Concretely, for this path:

- `reconcile-migration-version.sh` must match on the ledger's actual `name` (the stamped filename),
  and must exit non-zero if the `UPDATE` affects zero rows.
- **Always follow the repair with `pnpm db:ledger-check`** — it diffs the live ledger against
  `supabase/migrations/` in both directions and is the only thing that actually caught this.
- Budget the reconcile step as routine, not exceptional. At 5 for 5 it is part of applying a
  migration, not a surprise.

## Also seen this session (same family, already recorded)

Three schema assertions in the `dock-org-check` plan regexed **raw migration text**, and these
migrations argue in their header comments about the delete action they deliberately did *not* choose.
So the guard rejecting a bare `on delete set null` **failed on correct SQL**, and the positive
assertion would have **passed vacuously off a comment**. Fixed with a `sqlOnly()` helper that strips
`--` comments before matching. That is the third instance of
[[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]]'s underlying lesson —
a matcher that has gone blind is indistinguishable from a codebase that is clean — and it does not
need its own ADR, only the discipline gotcha-72 already states: prove the guard FAILS.
