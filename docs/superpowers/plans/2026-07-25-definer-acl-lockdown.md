# Definer ACL Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revoke `PUBLIC`/`anon` EXECUTE on the 8 `SECURITY DEFINER` functions in schema `public` that are still callable off the REST API by a logged-out caller, without breaking the RLS policies and RPCs that legitimately need `authenticated`.

**Architecture:** One migration file. For each of the 6 trigger-only functions: `revoke all … from public, anon, authenticated` + `grant execute … to service_role` (the exact shape of `20260724134101_mcp_oauth_vault_cleanup_acl.sql`). For the 2 functions with real callers (`readable_board_ids()` — 15 RLS policies; `set_goal_links()` — a user-facing RPC): `revoke all … from public, anon` + `grant execute … to authenticated, service_role`. One policy fix (`item_embeddings_select` regains its omitted `TO authenticated`) so revoking `anon` on `readable_board_ids()` cannot turn an anon read into a `42501`. The file ends with a class-wide `DO` block that raises if **any** definer function in `public` is still anon-executable — that assertion is the test, and it re-runs on PROD during `/sync-prod`.

**Tech Stack:** PostgreSQL 15 (Supabase), `supabase/migrations/` versioned SQL, `scripts/new-migration.sh`, `supabase-dev` MCP (`apply_migration`, `execute_sql`, `list_migrations`), Vitest (unaffected), `/sync-prod`.

---

## Spec reference

`docs/superpowers/specs/2026-07-25-definer-acl-lockdown-design.md`. **Read §3 (grant-surface
decisions) before writing a single `revoke`** — revoking `authenticated` on `readable_board_ids()`
would break every board read in the product. The spec's §2.1 correction also matters: two of the
eight have **no** `PUBLIC` grant, only an explicit `anon=X` grant, so `revoke … from public` alone
does not fix them.

## Grounded conventions (do not reinvent)

- **Migrations are minted only via `scripts/new-migration.sh <slug>`.** Never hand-write a version
  stamp (hour-24/25 stamps have shipped — `AGENTS.md`). The gotcha-57 "backfill at the ledger
  version" exception does **not** apply: that is for DDL already applied to DEV with no committed
  file. This DDL is new and unapplied → ordinary mint.
- **Apply to DEV via the `supabase-dev` MCP `apply_migration` with the SAME version + name as the
  committed file** so `filename == ledger version` stays true (gotcha-55). Verify with
  `list_migrations`. On drift: `scripts/reconcile-migration-version.sh <ledger-version> <file-version>`.
- Every statement in this migration is a `revoke`/`grant` or a `drop policy if exists` +
  `create policy`, so re-application anywhere is a no-op (gotcha-57 §Decision 4).
- **`pnpm db:types` throws `LegacyProjectNotLinkedError` inside a worktree.** Use the `supabase-dev`
  MCP `generate_typescript_types` if a types check is wanted. Expected result here: **no diff** —
  grants and policy `TO` clauses are not in the type surface.
- Conventional Commits, enforced by a Husky `commit-msg` hook. Scope: `db`.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a`.
- Commit identity is pinned to `Danijel Jovanovic <info@synapse-solutions.ai>` by
  `start-task.sh`; do not override.
- `pnpm test` is **unit-only** without `.env.test`; integration suites skip cleanly.

## File structure

| File                                                                                      | Create/Modify       | Responsibility                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_definer_acl_lockdown.sql`                                    | Create (via script) | All 8 ACL fixes + the `item_embeddings_select` policy `TO` clause + the class-wide anon-exposure assertion            |
| `vault/decisions/2026-07-25-gotcha-58-definer-acl-default-privileges-not-load-bearing.md` | Create              | ADR: three definer functions created _after_ the `ALTER DEFAULT PRIVILEGES` guard still shipped with the PUBLIC grant |
| `src/types/database.types.ts`                                                             | **Unchanged**       | Verified no-diff (a grant is not in the type surface) — do not commit a regenerated copy                              |

No `src/` code changes. No test files: see §"Why there is no Vitest test" below.

## Why there is no Vitest test (and what replaces it)

Working agreement #4 requires tests that are written **and executed**. This change is a privilege
grant, so the test lives in SQL and runs against the live catalog:

1. **The in-migration assertion (Task 1, Step 4)** is a class-wide `raise exception` that fails the
   migration if any `prosecdef` function in `public` is anon-executable. It executes on DEV at apply
   time (Task 2), again on PROD during `/sync-prod`, and again on the throwaway TEST project on any
   `supabase db push`. It is the regression guard the spec §2.3 says is missing.
2. **Live before/after `has_function_privilege` evidence** on DEV (Task 2, Steps 3 and 5).
3. **Behavioral no-regression proof in a rolled-back transaction** on DEV for the two retained
   `authenticated` grants (Task 3).
4. **The four gates** (Task 5).

Rejected: a Vitest test that greps the migration file (tautological), and a static lint over
`supabase/migrations/*.sql` (spec §2.3 — a regex sweep produces 20 hits of which 12 are covered by a
`DO`-block name list and 6 are already fine via default privileges; the file corpus is not a reliable
oracle, the live catalog is).

## Execution DAG (working agreement #6)

**Interfaces**

- **Task 1 (write the migration)** — Produces: `supabase/migrations/<stamp>_definer_acl_lockdown.sql`
  and the `<stamp>` value. Consumes: nothing.
- **Task 2 (apply to DEV + live verification)** — Consumes: Task 1's file + `<stamp>`.
  Produces: the DEV ledger row, and the before/after `has_function_privilege` evidence.
- **Task 3 (behavioral no-regression proof on DEV)** — Consumes: Task 2 (the ACLs must already be
  changed). Produces: evidence that a policy-gated board read and an `items` insert still work.
- **Task 4 (ADR for the default-privileges finding)** — Consumes: Task 2's evidence.
  Produces: the vault ADR.
- **Task 5 (four gates + close out)** — Consumes: Task 1's file (gates read the repo, not DEV) and,
  for the closing report, Tasks 2–4.

**Dependency graph**

```
T1 ──> T2 ──┬──> T3 ──┐
            └──> T4 ──┴──> T5
```

**Parallel batches**

- **Batch A:** T1 alone (single file, single writer — nothing to parallelise).
- **Batch B:** T2 alone (must follow T1's final file content; mutates DEV, so it cannot overlap
  with anything that reads DEV ACLs).
- **Batch C (2 concurrent agents):** T3 and T4. T3 only reads/rolls-back on DEV; T4 only writes
  `vault/` — disjoint files, disjoint resources.
- **Batch D:** T5 alone (needs T3 + T4 for the closing report).

**Critical path:** T1 → T2 → T3 → T5 (4 tasks). This task is genuinely near-sequential: it is one
file plus an ordered DB-state transition. Batch C is the only real concurrency; the spec (§7) says
so explicitly rather than inventing fake parallelism.

**Parallel file writes:** none. T1 is the only writer of the migration; T4 is the only writer of
`vault/`. No two tasks in a batch touch the same file.

---

## Task 1: Write the migration

**Files:**

- Create: `supabase/migrations/<stamp>_definer_acl_lockdown.sql` (mint via script — do **not**
  create this file by hand)

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh definer_acl_lockdown
```

Expected: `✓ created supabase/migrations/<stamp>_definer_acl_lockdown.sql` plus printed next-steps.
Record the exact `<stamp>` — Task 2 needs it verbatim. If the script warns that another worktree
carries unmerged migrations, note it (gotcha-43 merge ordering) but continue; this migration is
order-independent because every statement is idempotent.

- [ ] **Step 2: Replace the file's contents with the header comment + the 6 trigger-function revokes**

Overwrite the whole file. Keep the script's generated header **exactly** as written — the three
lines from `-- <stamp>_definer_acl_lockdown.sql` through
`-- the version; the filename must match the remote ledger row (gotcha-55).` plus the blank `--`
line — then replace the script's `-- What this migration does:` / `--   TODO: describe the change.`
stub with the following:

```sql
-- What this migration does:
--   Revokes PUBLIC/anon EXECUTE on the last 8 SECURITY DEFINER functions in
--   schema public that were still callable off the REST API as `anon`, and
--   restores the omitted `to authenticated` on the one policy that would
--   otherwise start erroring for anon as a result.
--
-- 20260621130000_lockdown_definer_execution_and_perf.sql states the invariant:
-- "anon executes NOTHING — no logged-out RPC exists; the browser client only
-- acts as `anon` when signed out." These 8 escaped it. Verified on 2026-07-25
-- against pg_proc.proacl + has_function_privilege on BOTH dev and prod (the
-- exposure and the ACL shapes are identical on each).
--
-- TWO exposure shapes, which is why every statement below names `anon`
-- explicitly and not just `public`:
--   * readable_board_ids() and set_goal_links() have NO PUBLIC grant — their
--     creating migrations already ran `revoke … from public`. Their anon access
--     is a separate EXPLICIT `anon=X` grant inherited from the
--     pre-20260704114000 default privileges, which `revoke … from public`
--     cannot touch.
--   * the other six carry the CREATE FUNCTION PUBLIC grant (`=X/postgres`),
--     three of them plus an explicit anon grant as well.
--
-- Shape follows 20260724134101_mcp_oauth_vault_cleanup_acl.sql (the same fix
-- for oauth_tokens_vault_cleanup(), gotcha-57) and the hygiene pass in
-- 20260704114000_definer_execution_lockdown_hygiene.sql.

-- 1. Trigger-only definer functions: no direct grant surface at all.
--
-- All six are attached as triggers and ONLY as triggers (verified via
-- pg_trigger), and no other routine or policy references them (verified via a
-- pg_proc.prosrc sweep over all of public and pg_policy expressions). Postgres
-- fires trigger functions WITHOUT an EXECUTE privilege check on the invoking
-- role, so revoking authenticated changes no app path. Live precedent on the
-- same tables: tg_enqueue_item_embed / tg_items_single_level /
-- tg_log_item_activity / tg_run_item_automations on public.items already sit at
-- {postgres,service_role} and the item write path — the hottest in the app —
-- works.

-- BEFORE DELETE on public.user_ai_credentials; deletes from vault.secrets.
revoke all on function public.ai_credential_delete_vault_secret()
  from public, anon, authenticated;
grant execute on function public.ai_credential_delete_vault_secret()
  to service_role;

-- BEFORE DELETE on public.org_ai_settings; deletes from vault.secrets.
revoke all on function public.org_ai_settings_delete_vault_secret()
  from public, anon, authenticated;
grant execute on function public.org_ai_settings_delete_vault_secret()
  to service_role;

-- BEFORE INSERT on public.notifications; reads the recipient's prefs.
revoke all on function public.gate_notification_by_pref()
  from public, anon, authenticated;
grant execute on function public.gate_notification_by_pref()
  to service_role;

-- BEFORE INSERT on public.items.
revoke all on function public.items_set_creation_metadata()
  from public, anon, authenticated;
grant execute on function public.items_set_creation_metadata()
  to service_role;

-- BEFORE UPDATE on public.items.
revoke all on function public.items_protect_creation_metadata()
  from public, anon, authenticated;
grant execute on function public.items_protect_creation_metadata()
  to service_role;

-- BEFORE INSERT OR UPDATE on public.goals.
revoke all on function public.tg_goals_validate_hierarchy()
  from public, anon, authenticated;
grant execute on function public.tg_goals_validate_hierarchy()
  to service_role;
```

- [ ] **Step 3: Append the 2 functions that KEEP `authenticated`, plus the policy fix**

Append to the same file:

```sql
-- 2. readable_board_ids(): authenticated MUST be retained.
--
-- It is referenced in the USING expression of 15 SELECT policies (attachments,
-- automation_runs, automations, board_members, board_views, cell_values,
-- columns, groups, item_activities, item_dependencies, item_embeddings,
-- item_updates, items, relation_links, time_entries). Policy expressions are
-- evaluated with the querying role's privileges, so revoking `authenticated`
-- here would turn EVERY board read in the product into
-- `42501 permission denied for function readable_board_ids`. This restores
-- exactly the posture 20260702120000:71-72 intended (it revoked `public` but
-- the explicit `anon` grant survived).
revoke all on function public.readable_board_ids() from public, anon;
grant execute on function public.readable_board_ids()
  to authenticated, service_role;

-- 3. set_goal_links(uuid,jsonb): a user-facing RPC — authenticated retained.
--
-- Called from src/lib/goals/actions.ts:133 via typedRpc on the signed-in cookie
-- client (Postgres role `authenticated`). Restores 20260621160000:215-216's
-- intent; only the leftover explicit anon grant is removed.
revoke all on function public.set_goal_links(uuid, jsonb) from public, anon;
grant execute on function public.set_goal_links(uuid, jsonb)
  to authenticated, service_role;

-- 4. item_embeddings_select was created WITHOUT a `to` clause
--    (20260720090620:50), so it applies to role PUBLIC — i.e. it is the one of
--    the 15 readable_board_ids() policies that `anon` actually evaluates
--    (anon holds table-level SELECT on public.item_embeddings). Without this
--    fix, revoking anon's EXECUTE above would change an anon
--    `GET /rest/v1/item_embeddings` from `[]` to
--    `42501 permission denied for function readable_board_ids`.
--
--    Restore the omitted `to authenticated`, matching the 14 sibling policies
--    and the policy's own stated intent ("mirrors the board-scoped semijoin
--    posture of the other authenticated tables"). Post-change anon never
--    evaluates the policy → default-deny → 0 rows, exactly as before.
--    `authenticated` is unchanged; service_role has rolbypassrls so policies
--    never applied to it (the service embed writer is unaffected).
drop policy if exists item_embeddings_select on public.item_embeddings;
create policy item_embeddings_select on public.item_embeddings
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));
```

- [ ] **Step 4: Append the class-wide assertion — this is the test**

Append to the same file:

```sql
-- 5. Assert the invariant class-wide, not by name list. This is the automated
--    verification for a change that has no application code to unit-test: it
--    runs here on DEV, again on PROD during /sync-prod, and again on any future
--    `supabase db push`. Deliberately not name-scoped, so ANY future migration
--    that reintroduces an anon-executable definer function fails loudly at
--    apply time.
--
--    Rationale for needing it: the `alter default privileges … revoke execute
--    on functions from public, anon` guard added by
--    20260704114000_definer_execution_lockdown_hygiene.sql IS live in
--    pg_default_acl, yet all three definer functions created after it
--    (20260706165521, 20260712153317, 20260716090205) still shipped with the
--    bare PUBLIC grant. The guard is not load-bearing; this assertion is.
do $$
declare leaked text;
begin
  if to_regrole('anon') is null then
    raise notice 'role anon absent — skipping definer-ACL assertion';
    return;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if leaked is not null then
    raise exception
      'SECURITY DEFINER functions in public still EXECUTE-able by anon: %', leaked;
  end if;
end $$;
```

- [ ] **Step 5: Self-check the file before applying anything**

```bash
grep -c "^revoke\|^grant\|^drop policy\|^create policy" supabase/migrations/*_definer_acl_lockdown.sql
```

Expected: `18` (8 revokes + 8 grants + 1 `drop policy` + 1 `create policy`).

```bash
grep -n "from public, anon" supabase/migrations/*_definer_acl_lockdown.sql | wc -l
```

Expected: `8` — every one of the 8 revokes names `anon` explicitly. **If this is not 8, stop**: the
two functions with no PUBLIC grant (§2.1 of the spec) would remain exposed.

```bash
grep -n "readable_board_ids() from public, anon, authenticated\|set_goal_links(uuid, jsonb) from public, anon, authenticated" supabase/migrations/*_definer_acl_lockdown.sql
```

Expected: **no output.** Any match means `authenticated` is being revoked from a function that needs
it — that breaks every board read (`readable_board_ids`) or the goals RPC (`set_goal_links`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_definer_acl_lockdown.sql
git status   # confirm ONLY that path is staged
git commit -m "fix(db): revoke anon/PUBLIC execute on the last 8 SECURITY DEFINER functions

The definer-execution lockdown (20260621130000) states anon executes nothing,
but 8 definer functions in public were still callable off the REST API as anon
on both dev and prod - including two BEFORE DELETE triggers that delete from
vault.secrets (the gotcha-57 shape). Two of the 8 carried no PUBLIC grant at
all, only an explicit anon grant, so every revoke names anon explicitly.

readable_board_ids() keeps authenticated (15 RLS policies call it) and
set_goal_links() keeps authenticated (user-facing RPC); the six trigger-only
functions keep no grant but service_role. item_embeddings_select regains the
'to authenticated' it was created without, so anon reads stay 0-rows instead of
becoming 42501. A class-wide assertion fails the migration if any definer
function in public is ever anon-executable again."
```

---

## Task 2: Apply to DEV and verify the live ACLs

**Files:** none (DB state + evidence only)

- [ ] **Step 1: Capture the BEFORE state on DEV**

Via the `supabase-dev` MCP `execute_sql`:

```sql
select p.oid::regprocedure::text as sig,
       p.proacl::text as acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
```

Expected: **8 rows**, matching the spec §2.1 table. Save the output verbatim — it goes in the
session note. If the count is not 8, stop and reconcile against the spec before applying anything.

- [ ] **Step 2: Apply the migration to DEV with the SAME version + name as the file**

Via the `supabase-dev` MCP `apply_migration`:

- `name`: `<stamp>_definer_acl_lockdown` — the **exact** filename stem from Task 1 Step 1.
- `query`: the full contents of the migration file, verbatim.

Expected: success. If the assertion in section 5 raises, the DDL above it did not cover everything —
read the raised list of signatures, fix the file, re-run Task 1 Step 5, and re-apply.

- [ ] **Step 3: Verify the ledger row matches the filename (gotcha-55)**

Via `supabase-dev` MCP `execute_sql`:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 3;
```

Expected: the top row's `version` equals the `<stamp>` in the filename. If it does not:

```bash
scripts/reconcile-migration-version.sh <ledger-version> <file-version>
```

- [ ] **Step 4: Verify the ledger↔files check in BOTH directions (gotcha-57)**

```bash
ls supabase/migrations/ | sed 's/_.*//' | sort > /tmp/files.txt
```

Then, via `supabase-dev` MCP `execute_sql`:

```sql
select version from supabase_migrations.schema_migrations order by version;
```

Compare: every DEV version must have a file, and every file must have a DEV version. A DEV version
with no file is a gotcha-57 drift, **not** a pending push — stop and report it.

- [ ] **Step 5: Capture the AFTER state — the primary evidence**

Via `supabase-dev` MCP `execute_sql`:

```sql
-- (a) the invariant: must return zero rows
select p.oid::regprocedure::text as still_exposed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- (b) the 8 targets' end state
select p.oid::regprocedure::text as sig, p.proacl::text as acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as sr_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ai_credential_delete_vault_secret','org_ai_settings_delete_vault_secret',
                    'gate_notification_by_pref','items_set_creation_metadata',
                    'items_protect_creation_metadata','tg_goals_validate_hierarchy',
                    'readable_board_ids','set_goal_links')
order by 1;

-- (c) the policy fix
select polname,
       (select array_agg(r.rolname::text) from pg_roles r where r.oid = any(pol.polroles)) as roles,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from pg_policy pol join pg_class c on c.oid = pol.polrelid
where c.relname = 'item_embeddings';
```

Expected:

- (a) **zero rows.**
- (b) `anon_exec = false` for all 8. `auth_exec = false` for the six trigger functions,
  **`true` for `readable_board_ids()` and `set_goal_links(uuid,jsonb)`**. `sr_exec = true` for all 8.
  ACLs: `{postgres=X/postgres,service_role=X/postgres}` for the six;
  `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` for the two.
- (c) `roles = {authenticated}` (was `PUBLIC`), `using_expr` unchanged.

- [ ] **Step 6: Confirm no type drift**

Via the `supabase-dev` MCP `generate_typescript_types`, then diff against the committed file. Expected:
**no meaningful diff** — a grant is not in the type surface, and the policy `TO` clause is not either.
Do **not** commit a regenerated copy. If there _is_ a diff, stop: something unintended was applied.

- [ ] **Step 7: Check the advisors**

Run the Supabase security advisor for the DEV project. Expected: the
`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable`
warnings for these 8 are gone, and no new warning appeared for `item_embeddings`.

_(No commit — this task changes DB state, not files.)_

---

## Task 3: Prove the retained `authenticated` grants still work (rolled-back transaction on DEV)

**Files:** none (evidence only)

This is the behavioral no-regression proof for the two `KEEP authenticated` decisions and for the
six trigger functions whose `authenticated` grant was removed. Every statement runs inside a
transaction that is **rolled back**, so DEV data is untouched.

- [ ] **Step 1: Pick a real DEV board + org to test against**

Via `supabase-dev` MCP `execute_sql`:

```sql
select b.id as board_id, b.org_id, b.created_by, g.id as group_id
from public.boards b
join public.groups g on g.board_id = b.id
where b.deleted_at is null
order by b.created_at desc
limit 1;
```

Record `board_id`, `org_id`, `created_by` (this is the user id to impersonate) and `group_id`.

- [ ] **Step 2: Prove a policy-gated board read still works as `authenticated`**

Substitute the values from Step 1:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<created_by>","role":"authenticated"}';
-- Exercises the readable_board_ids() SELECT policy on public.items.
select count(*) as visible_items from public.items where board_id = '<board_id>';
-- Exercises the same helper directly (the retained authenticated grant).
select count(*) as readable_boards from public.readable_board_ids();
rollback;
```

Expected: both counts execute **without error** and `readable_boards >= 1`. A
`42501 permission denied for function readable_board_ids` here means `authenticated` was wrongly
revoked — revert Task 1's `readable_board_ids` block to `from public, anon` and re-apply.

- [ ] **Step 3: Prove the `items` triggers still fire with no `authenticated` EXECUTE grant**

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<created_by>","role":"authenticated"}';
insert into public.items (board_id, group_id, org_id, name)
values ('<board_id>', '<group_id>', '<org_id>', 'acl-lockdown probe')
returning id, created_by, created_at;
rollback;
```

Expected: the insert **succeeds** and `created_by` is stamped with `<created_by>` — i.e.
`items_set_creation_metadata()` fired even though `authenticated` now has no EXECUTE on it, which is
the whole premise of decision D1. A `42501 permission denied for function
items_set_creation_metadata` would falsify D1 — in that case revert that function to
`from public, anon` (keeping `authenticated`) and re-apply.

- [ ] **Step 4: Prove `anon` no longer sees the functions and `item_embeddings` still returns empty, not an error**

```sql
begin;
set local role anon;
-- Must be 0 rows, NOT an error (this is the item_embeddings_select policy fix).
select count(*) as anon_visible_embeddings from public.item_embeddings;
rollback;
```

Expected: `0`, with **no error**. A `42501 permission denied for function readable_board_ids` means
the `item_embeddings_select` policy fix (Task 1 Step 3, section 4) did not apply — re-check it.

```sql
begin;
set local role anon;
select public.readable_board_ids();
rollback;
```

Expected: **`42501 permission denied for function readable_board_ids`** — this error is the desired
outcome here; it proves the revoke landed.

- [ ] **Step 5: Record all four results in the session-note draft**

Paste the actual outputs (not a summary) into `vault/sessions/_draft-…` under "Evidence". Evidence
before claims — a "verified" with no pasted output is not verification.

_(No commit — no files changed.)_

---

## Task 4: ADR — the `ALTER DEFAULT PRIVILEGES` guard is not load-bearing

**Files:**

- Create: `vault/decisions/2026-07-25-gotcha-58-definer-acl-default-privileges-not-load-bearing.md`

- [ ] **Step 1: Write the ADR**

Match the front-matter and section shape of
`vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`
(`type: adr`, `status: accepted`, `date`, `tags`, `related`, then `# Gotcha NN — …`, `## Context`,
`## Decision`, `## Rationale`, `## Consequences`, `## Related`). Content, all of it verified during
this task:

- **Context:** `20260704114000:16-17` added
  `alter default privileges in schema public revoke execute on functions from public, anon;` as the
  durable guard. That entry **is** live — `pg_default_acl` for `postgres`/`public`/`f` is
  `{postgres=X,authenticated=X,service_role=X}`, with no PUBLIC and no `anon`. Yet all three definer
  functions created after it — `ai_credential_delete_vault_secret` (`20260706165521`),
  `org_ai_settings_delete_vault_secret` (`20260712153317`), `gate_notification_by_pref`
  (`20260716090205`) — still shipped with the bare `=X/postgres` PUBLIC grant, while other
  post-lockdown functions (`check_rate_limit`, `tg_enqueue_item_embed`,
  `oauth_tokens_vault_cleanup`) did not. All are owned by `postgres`, so ownership does not explain
  the split, and no migration re-grants `public`/`anon`. Mechanism undetermined; the failure rate is
  what matters: **three times in ten days.**
- **Also record the second trap:** `revoke … from public` is **not** a superset of
  `revoke … from anon`. `readable_board_ids()` and `set_goal_links()` both ran
  `revoke … from public` in their own migrations and remained anon-executable for weeks via a
  separate explicit `anon=X` grant. Always name `anon` (and `authenticated` where appropriate)
  explicitly.
- **Decision:** (1) every migration that creates a `SECURITY DEFINER` function ships an explicit
  per-function `revoke … from public, anon[, authenticated]` in the same file — the default
  privileges are a backstop, not the control; (2) migrations that change definer ACLs end with the
  class-wide assertion introduced by `<stamp>_definer_acl_lockdown.sql`, so a regression fails at
  apply time on every environment including PROD via `/sync-prod`.
- **Consequences:** positive — the class now fails loudly instead of silently; negative — the
  assertion is only re-run when a migration containing it is applied, so a definer function added
  _without_ one still escapes until the next such migration. Open follow-up: gotcha-57's
  outstanding item (teach `finish-task.sh` or a `/sync-prod` pre-check to diff `list_migrations`
  against `supabase/migrations/`) plus a `/sync-prod` step that runs the anon-exposure query on
  PROD read-only.
- **Related:** `[[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]`,
  `[[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]`, and the spec
  `docs/superpowers/specs/2026-07-25-definer-acl-lockdown-design.md`.

Check the next free gotcha number before naming the file:

```bash
ls vault/decisions/ | grep -o 'gotcha-[0-9]*' | sort -t- -k2 -n | tail -1
```

If the highest existing is not `gotcha-57`, rename the ADR to the next free number and update its
`#` heading to match.

- [ ] **Step 2: Commit**

```bash
git add vault/decisions/2026-07-25-gotcha-*-definer-acl-default-privileges-not-load-bearing.md
git status   # confirm ONLY that path is staged
git commit -m "docs(vault): ADR — definer-ACL default privileges are not load-bearing"
```

---

## Task 5: Gates, merge, and close out

**Files:** none beyond what Tasks 1 and 4 committed

- [ ] **Step 1: Run the four gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. No TS changed, so a failure here is pre-existing or environmental, not
caused by this task — investigate before proceeding either way. `pnpm test` runs unit-only without
`.env.test`; that is expected and is why Tasks 2 and 3 carry the real verification.

- [ ] **Step 2: Merge via the helper (do not hand-merge)**

```bash
scripts/finish-task.sh
```

Run it **from inside the worktree**. It rebases `task/definer-acl-lockdown` onto the latest
`develop`, re-runs the gates against the merged state, merges, pushes, and removes the worktree +
branch. If it stops on a rebase conflict, resolve `git rebase develop` and re-run.

**The worktree no longer exists after this step** — Steps 3–5 run from the main checkout
(`/Users/danijeljovanovic/Dev/Monolith`), which is parked on `develop`.

- [ ] **Step 3: Write the "How to test this" walkthrough**

This change is **not user-observable** — no UI, no behavior change for any signed-in user. Say so in
one line, then give the operator-facing verification, because the security fix _is_ verifiable:

1. Pull `develop`.
2. Against DEV, run the invariant query and expect **zero rows**:
   ```sql
   select p.oid::regprocedure::text from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
   ```
3. Open a board in the app and confirm items/columns/groups still load (proves
   `readable_board_ids()` kept `authenticated`).
4. Create an item, then link a board to a goal in the goals UI (proves `items_set_creation_metadata`
   still fires and `set_goal_links` is still callable).
5. Confirm production is **still exposed** until the next step: run the same query against PROD via
   `supabase-prod` and expect the **8 rows** to still be there.

- [ ] **Step 4: Flag the PROD action explicitly — this is the step that actually closes the security gap**

State, in the closing message **and** in the `/wrapup` session note, verbatim in substance:

> **PROD is still exposed.** Merging to `develop` and promoting `develop → main` does **not** apply
> migrations — promotion only deploys the Vercel app. PROD carries the identical 8-function anon
> exposure verified on 2026-07-25. Run **`/sync-prod`** to close it, then re-run the invariant query
> against `supabase-prod` and confirm zero rows.

Do not report this task as "the vulnerability is fixed" while PROD still returns 8 rows — report it
as "fixed on DEV, pending `/sync-prod` for PROD".

- [ ] **Step 5: `/wrapup`**

Log the session note in `vault/sessions/` (including the pasted evidence from Tasks 2 and 3, the
"How to test" section, and the PROD/`/sync-prod` outstanding action) and bump
`vault/00-north-star.md`.

---

## Spec coverage check

| Spec section                                   | Task                                                          |
| ---------------------------------------------- | ------------------------------------------------------------- |
| §2.1 two exposure shapes → name `anon` always  | T1 Step 2/3 (all 8 revokes name `anon`), T1 Step 5 (grep = 8) |
| §3 D1 six trigger functions                    | T1 Step 2; falsification test T3 Step 3                       |
| §3 D2 `readable_board_ids` keeps authenticated | T1 Step 3; guard grep T1 Step 5; proof T3 Step 2              |
| §3 D3 `item_embeddings_select` policy fix      | T1 Step 3 section 4; proof T3 Step 4                          |
| §3 D4 `set_goal_links` keeps authenticated     | T1 Step 3; guard grep T1 Step 5; ACL check T2 Step 5(b)       |
| §4 match the established pattern               | T1 Step 2/3 (two-statement form from `20260724134101`)        |
| §5 verification layers 1–4                     | T1 Step 4 (assertion), T2 Steps 1/5, T3, T5 Step 1            |
| §6 performance budget                          | No task needed — no code, no reads, no index changes          |
| §8 mint via script, same version+name, ledger  | T1 Step 1, T2 Steps 2/3/4                                     |
| §8 types expected no-diff                      | T2 Step 6                                                     |
| §8 PROD only via `/sync-prod`                  | T5 Step 4                                                     |
| §2.3 recurrence finding                        | T1 Step 4 (assertion) + T4 (ADR)                              |
