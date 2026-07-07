---
type: adr
status: accepted
date: 2026-07-07
tags: [project/pulse, adr, gotcha, supabase, migrations]
related:
  - "[[2026-07-07-1022-batch-a-soft-delete-avatar-kbar-search]]"
---

# Gotcha 52 — managed Postgres denies `SET <param>` in a function header; use transaction-local `set_config`

## Context

The ⌘K similarity-search RPC (`search_items`) needs a lowered `pg_trgm.word_similarity_threshold`
(0.3 instead of the 0.6 default) so a typo like `desing` still matches `Design spec`. The natural
SQL is a function-header GUC:

```sql
create function public.search_items(...) returns ... language sql stable
  set pg_trgm.word_similarity_threshold = '0.3'   -- ← denied
  set search_path = '' as $$ ... $$;
```

On Supabase's managed Postgres this fails at migration time with **`permission denied to set
parameter "pg_trgm.word_similarity_threshold"`** — the role can't set that GUC via `ALTER
FUNCTION ... SET`. (Note `set search_path = ''` in the same position is fine; the denial is
parameter-specific.)

## Decision

Set the parameter **transaction-locally inside a `plpgsql` body** instead of in the header:

```sql
create function public.search_items(...) returns ... language plpgsql stable
  set search_path = '' as $$
begin
  perform set_config('pg_trgm.word_similarity_threshold', '0.3', true);  -- true = local to txn
  return query select ... where name %> p_query or name ilike ... ;
end $$;
```

The `true` third arg makes it **transaction-local**: it resets when the statement's implicit
transaction ends, so it never leaks across PgBouncer-pooled connections into other queries. The
tradeoff is `sql` → `plpgsql` (a hair more overhead), which is negligible for this path.

Verified with `EXPLAIN` (`enable_seqscan=off`): both WHERE branches still `Bitmap Index Scan` on
`items_name_trgm_idx` (BitmapOr), so the lowered threshold does not cost the trigram index.

## Consequences

- Any migration that wants a non-default GUC scoped to one function on managed Supabase should reach
  for `set_config(name, value, true)` in a `plpgsql` body, **not** `ALTER FUNCTION ... SET <param>` —
  the latter silently works for a whitelist (`search_path`, `role`, …) but is denied for many
  extension GUCs (`pg_trgm.*`).
- Applies equally to future ranked/fuzzy RPCs and to any per-call planner/extension tuning.
