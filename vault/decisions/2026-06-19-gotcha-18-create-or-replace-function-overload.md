---
type: adr
status: accepted
date: 2026-06-19
tags: [adr, gotcha, supabase, postgres, migrations, security-definer]
related:
  - "[[2026-06-19-phase-5c1-automations-design]]"
  - "[[2026-06-19-0957-phase5c1-run-history]]"
---

# Gotcha 18 — `CREATE OR REPLACE FUNCTION` with a changed argument list adds an overload, it does not replace

## Context

Phase 5c-1 needed to extend the in-DB engine entry point `_automation_run` with a new
`p_trigger_type text` parameter (for run-history logging). The migration "recreated" it the obvious
way:

```sql
create or replace function public._automation_run(
  p_automation_id uuid, p_actions jsonb, p_condition jsonb,
  p_item_id uuid, p_org_id uuid, p_board_id uuid, p_actor uuid,
  p_trigger_type text   -- new 8th arg
) returns void ...
```

## The trap

In PostgreSQL a function's **identity includes its argument list**. `CREATE OR REPLACE FUNCTION`
only replaces a function with the **same name AND same signature**. Add (or change) a parameter and
you have a _different_ signature — so Postgres **creates a second overload** and silently leaves the
old one in place. After this migration the DB had **two** `_automation_run` functions (the original
7-arg and the new 8-arg), both `SECURITY DEFINER`.

It is functionally harmless only by luck here: the same migration recreated all three callers to pass
8 args, so the 7-arg copy was orphaned (zero callers). But a dangling `SECURITY DEFINER` function is
needless attack surface, and the generated `database.types.ts` then carries a confusing
union-of-overloads for the RPC. The planning self-review missed it because it reasoned about "the
8-arg signature is used identically in all callers" — true, but it never asked what happened to the
old signature.

## Resolution / rule

- **When changing a function's argument list, drop the old signature explicitly.** Either
  `DROP FUNCTION ... (oldargs)` before the `CREATE`, or ship a follow-up cleanup migration. 5c-1
  shipped `20260619100001`:

  ```sql
  drop function if exists public._automation_run(uuid, jsonb, jsonb, uuid, uuid, uuid, uuid);
  ```

- **Verify after any signature change:**
  `select oid::regprocedure from pg_proc where proname = '_fn_name';` — expect exactly one row.
- Only the body/return-type can be edited in place with `CREATE OR REPLACE`; the parameter list
  cannot. (Changing return type also requires `DROP` first — a separate but related constraint.)
- Caught by the holistic review + a live `pg_proc` query; the drop is safe only after confirming no
  remaining callers reference the old arity (`prosrc ilike '%_fn_name(%'`).
