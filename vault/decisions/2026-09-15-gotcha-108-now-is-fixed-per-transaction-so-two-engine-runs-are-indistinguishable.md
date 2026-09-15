# gotcha-108 — `now()` is fixed per transaction, so two engine runs in one transaction are indistinguishable

**Date:** 2026-09-15
**Surfaced by:** verifying the `assign_person` automation action against the live DEV engine
**Class:** measurement trap — the code was right, the reading was wrong

## The trap

`automation_runs.created_at` defaults to `now()`. In Postgres, `now()` is
`transaction_timestamp()` — **fixed for the entire transaction**, not evaluated
per statement. So several `_automation_run` calls inside one transaction write
rows with *identical* `created_at` values.

A verification that reads the outcome with

```sql
select actions from public.automation_runs
where automation_id = v_auto
order by created_at desc limit 1
```

therefore does not read "the latest run". It reads an arbitrary row among the
equal keys — in practice the first one inserted. The first pass of this
verification ran five cases and reported `outcome = "set"` for **all five**,
including the three that must be refused. The guards were working the whole
time; the measurement could not see them.

What gave it away was a second signal disagreeing with the first: the bad-target
cases reported `set` while simultaneously reporting `0` rows written. An outcome
that claims a write, next to a count that says nothing was written, is the
reading being wrong rather than the engine.

## How to read per-run outcomes inside one transaction

Isolate each call. Clear the ledger rows for the automation before each
invocation and then read the single row back:

```sql
delete from public.automation_runs where automation_id = v_auto;
perform public._automation_run(...);
select actions->0->>'outcome' into v_out
  from public.automation_runs where automation_id = v_auto;
```

`clock_timestamp()` would also distinguish them, but it is not what the column
defaults to, so ordering by the stored value stays wrong no matter what you
compare it against. Isolation is the fix; a tiebreaker is not.

## Why this pattern exists here at all

Tier-1 `*.integration.test.ts` suites cannot run against DEV or PROD:
`isSafeTestTarget()` in `src/test/integration-env.ts` forbids those refs
regardless of `PULSE_TEST_DB`, and per decision-25 none of the ~70 such suites
has ever executed against a live database. A plan that assumes "run it red,
then green" against DEV is assuming something the repo forbids — and if nobody
checks, SQL guards ship verified by nothing while the suite reports "skipped"
and every gate stays green.

The substitute is a **rolled-back transaction** on DEV: build fixtures, exercise
the function, capture the readings, then abort so nothing persists. Raising an
exception carrying the results is what returns them, since a rollback discards
any result set:

```sql
RAISE EXCEPTION 'VERIFY_RESULT >>> %', v_log;
```

## Evidence this recorded for `assign_person`

Verified against the live DEV `_automation_run` on 2026-09-15, each call
isolated, whole transaction rolled back, with a post-check confirming zero
leftover boards, automations or columns:

| Case | Outcome | Cell after |
| --- | --- | --- |
| people column + org member | `set` | `{"userIds":["<member>"]}` |
| identical value again | `skipped_equal` | unchanged, no second write |
| people column on **another** board | `skipped_bad_target` | 0 writes to that column |
| `status` column on the firing board | `skipped_bad_target` | 0 writes |
| uuid outside the org | `skipped_not_member` | unchanged |
| cell already holding **two** people | `set` | `{"userIds":["<one>"]}` — replaced, not appended |

The last row matters on its own: `assign_person` REPLACES the people cell, which
is what Intelligence's own `reassign` does (`src/lib/ai/board-intelligence/apply.ts`).
Two paths writing one column must agree on what writing it means.

One guard subtlety worth keeping: the branch tests
`if v_kind is distinct from 'people'`, **not** the sibling `set_option`
branch's `if v_kind is null`. Copying the sibling would have been a real hole —
a `status` column on the firing board has a non-null kind and would have fallen
straight through to the write path.

## Related

- [[2026-08-02-decision-32-production-runs-the-dev-database]] — why DEV is the
  database that matters, and why a rolled-back transaction there is the
  honest place to verify live behaviour.
