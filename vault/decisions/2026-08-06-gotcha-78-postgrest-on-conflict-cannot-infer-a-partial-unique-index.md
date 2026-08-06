---
type: decision
date: 2026-08-06
tags: [decision, gotcha, supabase, postgrest, migrations, time-tracking]
related:
  - "[[2026-08-06-1343-mcp-full-surface-22-tools]]"
---

# Gotcha 78 — PostgREST's `on_conflict` cannot infer a partial unique index

## What happened

Manual time entry had **never worked**. Not "regressed" — never. `public.time_allocations` held
**0 rows** on DEV, which is the database the production deployment serves.

`upsertTimeAllocation` (`src/lib/time/actions.ts`) did what every other upsert in the repo does:

```ts
supabase.from("time_allocations").upsert(row, { onConflict: "user_id,work_date,item_id" })
```

That call fails at **plan time**, before touching a row:

```
42P10  there is no unique or exclusion constraint matching the ON CONFLICT specification
```

Both unique indexes on the table are **partial**:

```sql
create unique index time_allocations_user_day_item_uidx
  on time_allocations (user_id, work_date, item_id) where (item_id is not null);
create unique index time_allocations_user_day_category_uidx
  on time_allocations (user_id, work_date, category) where (category is not null);
```

PostgreSQL can only infer a partial unique index when the arbiter **repeats the index predicate**.
PostgREST's `on_conflict=` parameter — what `supabase-js`'s `{ onConflict }` compiles to — emits
only a column list. It has no syntax for a `WHERE` clause, so inference can never succeed.

Proven on DEV in one transaction:

| arbiter | result |
| --- | --- |
| `on conflict (user_id, work_date, item_id)` | `42P10` — no matching constraint |
| `on conflict (user_id, work_date, item_id) where item_id is not null` | `23503` FK violation — i.e. it **planned** |
| `on conflict (user_id, work_date, category)` | `42P10` |

The second row is the whole proof: adding the predicate changes the error from "cannot plan" to a
constraint the planner only reaches *after* planning succeeded.

## Why it hid for months

Every failure mode conspired to look like "nobody used the feature":

- The action returns `ActionResult`, so the 42P10 surfaced as a toast, not a crash or an alert.
- The time card reconciles writes into a **durable local overlay** and deliberately skips
  `revalidatePath("/time")`, so the number a user typed stayed on screen after a failed save.
- An empty table reads as an unused feature, not a broken one.

No test caught it because every suite mocks the Supabase client — a fake `.upsert()` resolves fine.
This class of bug is invisible to any test that does not execute real SQL.

## The fix

Write the upsert in SQL, where the predicate **is** expressible, and have both callers share it —
migration `20260806060855_upsert_time_allocation_rpc.sql`:

```sql
create function public.upsert_time_allocation(...) returns public.time_allocations
language plpgsql security invoker set search_path = ''
```

- `SECURITY INVOKER`, so RLS remains the boundary (verified deployed: `prosecdef = false`).
- `user_id` is derived from `auth.uid()` **inside** the function rather than passed as a parameter,
  which makes writing another user's time structurally impossible instead of merely policy-enforced.
- `anon` has no `EXECUTE`; `authenticated` does.
- Both branches carry their predicate: `on conflict (...) where item_id is not null` / `where
  category is not null`.
- `coalesce(excluded.board_id, ta.board_id)` stops an MCP correction (which sends no board) from
  demoting a stored `board_id` to null and silently breaking `/workload` attribution.
- `p_duration_secs = 0` deletes the row, mirroring the UI's "clear the cell to remove time".

## The generalisable rule

**A partial unique index is not reachable through PostgREST's `on_conflict`.** If a table's
uniqueness is conditional, its upsert must live in SQL — an RPC, or a full unique index over a
`coalesce`d key. Reach for `{ onConflict }` only against a full unique constraint.

And the broader one, which is the reason this survived: **a write path whose only test mocks the
database is untested.** The single cheapest check would have been one row in the table.

## Where else this could bite

`time_allocations` is the only table in the repo whose upsert arbiter targets a partial index —
checked at the time of the fix. Any future partial unique index needs the same treatment; grep for
`onConflict` before adding one.
