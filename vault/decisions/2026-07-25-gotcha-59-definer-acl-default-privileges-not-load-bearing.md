---
type: adr
status: accepted
date: 2026-07-25
tags: [project/monolith, adr, gotcha, supabase, migrations, security, rls, definer]
related:
  - "[[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]"
  - "[[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]"
---

# Gotcha 59 — `alter default privileges … revoke execute on functions from public, anon` does NOT stop new functions getting a PUBLIC grant; only a per-function `revoke` does

## Context

`20260621130000_lockdown_definer_execution_and_perf.sql` states the invariant this codebase runs on:

> `anon` executes **NOTHING** — no logged-out RPC exists; the browser client only acts as `anon`
> when signed out.

On 2026-07-25, an audit prompted by gotcha-57's open follow-up ("worth auditing the other definer
functions added around the same date for the same missed ACL") found **8** `SECURITY DEFINER`
functions in schema `public` that were still `EXECUTE`-able by `anon` — on **both** DEV and PROD,
with identical ACL shapes. Two of them (`ai_credential_delete_vault_secret`,
`org_ai_settings_delete_vault_secret`) are `BEFORE DELETE` triggers that `delete from vault.secrets`
— the exact shape of the gotcha-57 incident. Fixed by
`supabase/migrations/20260725102610_definer_acl_lockdown.sql`.

The interesting part is **why** they escaped, because `20260704114000_definer_execution_lockdown_hygiene.sql`
lines 16-17 had already installed what everyone assumed was the durable, structural guard:

```sql
alter default privileges in schema public revoke execute on functions from public, anon;
```

That entry **is live**. `pg_default_acl` for `postgres` / `public` / `f` reads
`{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` — no PUBLIC, no `anon`.
And yet all three definer functions created _after_ it (`20260706165521`, `20260712153317`,
`20260716090205`) shipped with the bare `=X/postgres` PUBLIC grant anyway.

### The guard is not merely unreliable — it is structurally incapable of working

Previous notes left the mechanism "undetermined". It is now **determined and reproducible**. In a
rolled-back transaction on DEV, as `postgres` (which is what both `supabase db push` and the
`supabase-dev` MCP connect as — `current_user = session_user = postgres`):

```sql
begin;
alter default privileges in schema public revoke execute on functions from public, anon;  -- re-assert it
create function public.__acl_probe3() returns void language sql security definer as $$ select 1 $$;
select proacl, has_function_privilege('anon', oid, 'EXECUTE') from pg_proc where proname='__acl_probe3';
rollback;
```

Result — **even with the guard re-asserted in the very same transaction**:

```
proacl    = {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
anon_exec = true
```

The leading `=X` is the built-in `EXECUTE TO PUBLIC` grant, and `anon` inherits it because every
role is implicitly a member of `PUBLIC`. So a brand-new definer function in `public`, created today,
by the same role our tooling uses, is anon-executable **regardless** of the `ALTER DEFAULT
PRIVILEGES` entry.

Two candidate explanations were tested and **eliminated**:

- **Event triggers.** All six event triggers on the project (`pgrst_ddl_watch`, `pgrst_drop_watch`,
  `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`,
  `issue_graphql_placeholder`) were read in full. None grants EXECUTE to `public`/`anon` on functions
  in schema `public`.
- **Ownership.** All 110 definer functions in `public` are owned by `postgres`, the same role the
  `pg_default_acl` entry is keyed to, so a "created by a different role" split does not explain it.

A second `pg_default_acl` row exists for the same schema+objtype under a different grantor —
`supabase_admin` / `public` / `f` = `{postgres=X,anon=X,authenticated=X,service_role=X}`, which
**does** include `anon`. Whatever the exact catalog-resolution rule, the empirical outcome is
unambiguous: the stored `postgres` default-ACL entry does not suppress the built-in PUBLIC grant.

### The second trap: `revoke … from public` is not a superset of `revoke … from anon`

`readable_board_ids()` and `set_goal_links(uuid,jsonb)` **already ran** `revoke … from public` in
their own creating migrations (`20260702120000:71-72`, `20260621160000:215-216`) and _still_ sat at
`anon=X` for weeks. Their live ACL carried **no** PUBLIC entry at all:

```
readable_board_ids()          {postgres=X,anon=X,authenticated=X,service_role=X}
set_goal_links(uuid,jsonb)    {postgres=X,anon=X,authenticated=X,service_role=X}
```

The `anon=X` is a **separate, explicit** grant (inherited from the pre-`20260704114000` default
privileges), and `revoke … from public` cannot touch an explicit role grant. A revoke that names
only `public` would have left both of these fully exposed while looking like a complete fix.

## Decision

1. **Every migration that creates a `SECURITY DEFINER` function ships an explicit per-function
   `revoke` in the same file**, and that revoke **names `anon` literally** (plus `authenticated`
   for trigger-only functions):

   ```sql
   revoke all on function public.<fn>(<args>) from public, anon, authenticated;  -- trigger-only
   grant execute on function public.<fn>(<args>) to service_role;
   ```

   `ALTER DEFAULT PRIVILEGES` is a backstop that demonstrably does not fire. It is **not** the
   control. Never rely on it, and never write `from public` alone.

2. **Migrations that touch definer ACLs end with the class-wide assertion** introduced by
   `20260725102610_definer_acl_lockdown.sql` — deliberately not name-scoped, so any future
   regression fails loudly at apply time on every environment (DEV, PROD via `/sync-prod`, and the
   throwaway TEST project on `supabase db push`):

   ```sql
   do $$
   declare leaked text;
   begin
     if to_regrole('anon') is null then
       raise notice 'role anon absent — skipping definer-ACL assertion';
       return;
     end if;
     select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
       into leaked
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and has_function_privilege('anon', p.oid, 'EXECUTE');
     if leaked is not null then
       raise exception 'SECURITY DEFINER functions in public still EXECUTE-able by anon: %', leaked;
     end if;
   end $$;
   ```

3. **Check the live catalog, not the migration corpus.** A static regex lint over
   `supabase/migrations/*.sql` was evaluated and rejected: it yields 20 hits, of which 12 are
   already covered by `20260704114000`'s name-list `DO` block and 6 are fine anyway. The files are
   not a reliable oracle; `has_function_privilege` is.

4. **Revoking `authenticated` from a trigger-only definer function is safe** — Postgres fires
   trigger functions without an EXECUTE privilege check on the invoking role. Verified live: an
   `insert into public.items` as role `authenticated` still stamped `created_by` via
   `items_set_creation_metadata()` **after** `authenticated` lost EXECUTE on it. But it is **not**
   safe for a function referenced in a policy `USING` expression: `readable_board_ids()` is in 15
   SELECT policies and policy expressions are evaluated with the querying role's privileges, so
   revoking `authenticated` there turns every board read into
   `42501 permission denied for function readable_board_ids`.

5. **When revoking `anon`'s EXECUTE on a policy helper, check for role-`PUBLIC` policies first.**
   A `create policy` with **no `to` clause** applies to `PUBLIC`, so `anon` evaluates it and hits the
   helper. `item_embeddings_select` (`20260720090620:50`) was the one such policy of the 15; without
   restoring its omitted `to authenticated`, an anon `GET /rest/v1/item_embeddings` would have gone
   from `[]` to `42501`. Fixed in the same migration.

## Rationale

- The failure rate is the argument: **three definer functions in ten days** shipped anon-executable
  _after_ the guard was installed, and the guard was live the whole time. A control that has never
  once fired is not a control.
- A `revoke`/`grant` migration produces byte-identical `database.types.ts`, so the
  regenerate-types-and-review habit gives false reassurance for exactly this class (same observation
  as gotcha-57).
- Putting the assertion **in the migration** rather than in Vitest means it runs against the live
  catalog of whatever environment it is applied to, including PROD — which no repo-side test can do.

## Consequences

- **Positive:** the class now fails loudly at apply time instead of silently shipping. The two
  `vault.secrets`-deleting triggers are closed. Nothing in the app changed: `readable_board_ids()`
  and `set_goal_links()` kept `authenticated`, the six trigger functions keep `service_role` only,
  and `item_embeddings_select` matches its 14 sibling policies.
- **Negative:** the assertion only re-runs when a migration **containing it** is applied, so a
  definer function added in a migration that omits it still escapes until the next such migration.
  It is a tripwire, not a continuous monitor.
- **Open follow-ups:**
  - gotcha-57's outstanding item — teach `finish-task.sh` (or a `/sync-prod` pre-check) to diff
    `list_migrations` against `supabase/migrations/` in both directions.
  - Add a `/sync-prod` step that runs the anon-exposure query read-only against PROD and reports
    the count, so the invariant is checked even on migrations that don't carry the assertion.
  - Consider `alter default privileges … revoke execute on functions from public` under the
    `supabase_admin` grantor too, and re-test the probe above — the `postgres` entry alone provably
    does not suffice.

## Related

- [[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]] — the ACL miss whose
  follow-up prompted this audit; same `vault.secrets`-deleting-trigger shape
- [[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]] — hit again here:
  the MCP stamped `20260725102813` for a file minted at `20260725102610`; repaired with
  `scripts/reconcile-migration-version.sh`
- `docs/superpowers/specs/2026-07-25-definer-acl-lockdown-design.md` — the spec, incl. the
  per-function grant-surface decisions and the live before/after evidence
- `supabase/migrations/20260725102610_definer_acl_lockdown.sql` — the fix and the assertion
