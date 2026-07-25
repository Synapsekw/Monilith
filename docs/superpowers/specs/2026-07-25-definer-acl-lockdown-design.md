# Definer ACL Lockdown — revoke anon/PUBLIC EXECUTE on the 8 remaining `SECURITY DEFINER` functions

- **Date:** 2026-07-25
- **Status:** Draft — awaiting owner review
- **Origin:** Follow-up flagged in `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`
  ("worth auditing the other definer functions added around the same date for the same missed ACL")
- **Author:** scoping agent (`task/definer-acl-lockdown`)
- **Branch:** `task/definer-acl-lockdown`

## 1. Problem & intent

`20260621130000_lockdown_definer_execution_and_perf.sql` established the invariant for this
codebase in writing:

> `anon` executes **NOTHING** — no logged-out RPC exists; the browser client only acts as `anon`
> when signed out.

Eight `SECURITY DEFINER` functions in schema `public` violate that invariant **right now, on both
DEV and PROD**. Each is directly invocable off the PostgREST `/rest/v1/rpc/<name>` endpoint by a
logged-out caller holding only the publishable anon key. Two of them delete rows from
`vault.secrets` — the exact shape of the gotcha-57 incident.

Success = on both DEV and PROD, `has_function_privilege('anon', <oid>, 'EXECUTE')` is **false for
every `prosecdef` function in `public`**, the app's authenticated hot paths (board reads, item
insert/update, goal linking, notification fan-out) are provably unchanged, and the migration
**self-verifies** so the next occurrence fails loudly at apply time instead of shipping silently.

## 2. Verified findings (live DEV + PROD, read-only)

Verified independently of the hand-off list, via `pg_proc.proacl` + `has_function_privilege` on
both projects (`supabase-dev` = `hjqcahbbbdaknbbnfnvl`, `supabase-prod` = `jzsyqhxynswolgijkktn`).

**Count: exactly 8.** The hand-off list is correct on membership — no false positives, no
additional exposed definer functions. Of the **110** `prosecdef` functions in `public`, the query
`… where prosecdef and has_function_privilege('anon', oid, 'EXECUTE')` returns exactly these 8 on
DEV and the **identical 8, with identical ACL shapes, on PROD**. DEV and PROD are in exact parity
on this finding, so one migration fixes both.

### 2.1 The one correction to the hand-off: there are **two** exposure mechanisms, not one

The hand-off states all 8 "carry the bare `=X/postgres` PUBLIC grant". That is **wrong for two of
them**, and the difference is load-bearing: a `revoke … from public` alone would leave them exposed.

| Function                                | Live `proacl`                                           | PUBLIC `=X`? | Explicit `anon=X`? |
| --------------------------------------- | ------------------------------------------------------- | ------------ | ------------------ |
| `readable_board_ids()`                  | `{postgres=X,anon=X,authenticated=X,service_role=X}`    | **no**       | **yes**            |
| `set_goal_links(uuid,jsonb)`            | `{postgres=X,anon=X,authenticated=X,service_role=X}`    | **no**       | **yes**            |
| `items_set_creation_metadata()`         | `{=X,postgres=X,anon=X,authenticated=X,service_role=X}` | yes          | yes                |
| `items_protect_creation_metadata()`     | `{=X,postgres=X,anon=X,authenticated=X,service_role=X}` | yes          | yes                |
| `tg_goals_validate_hierarchy()`         | `{=X,postgres=X,anon=X,authenticated=X,service_role=X}` | yes          | yes                |
| `ai_credential_delete_vault_secret()`   | `{=X,postgres=X,authenticated=X,service_role=X}`        | yes          | no                 |
| `org_ai_settings_delete_vault_secret()` | `{=X,postgres=X,authenticated=X,service_role=X}`        | yes          | no                 |
| `gate_notification_by_pref()`           | `{=X,postgres=X,authenticated=X,service_role=X}`        | yes          | no                 |

Why the shapes differ, traced to the creating migrations:

- `readable_board_ids` (`20260702120000:71-72`) and `set_goal_links` (`20260621160000:215-216`)
  **already ran `revoke … from public`** and granted `authenticated`. That removed the PUBLIC entry
  and nothing else. The `anon=X` entry is a _separate, explicit_ grant inherited from the
  pre-`20260704114000` default privileges for role `postgres` — untouched by a
  `revoke … from public`. **These two are the proof that `from public` is not sufficient**; the
  established pattern's `from public, anon, …` is required.
- `items_*` (`20260625120000`) and `tg_goals_validate_hierarchy` (`20260621160000`) shipped with
  **no ACL statement at all**, so they kept both the `CREATE FUNCTION` PUBLIC grant and the
  default-privileges `anon` grant.
- The three newest (`20260706165521`, `20260712153317`, `20260716090205`) also shipped with **no
  ACL statement**; they have PUBLIC but no `anon` entry, because by then `20260704114000` had
  stripped `anon` from the `postgres` default privileges for functions.

### 2.2 Severity ranking (worst first)

1. `ai_credential_delete_vault_secret()` and `org_ai_settings_delete_vault_secret()` — definer
   `BEFORE DELETE` triggers that `delete from vault.secrets`. Identical shape to
   `oauth_tokens_vault_cleanup()`, the gotcha-57 finding. Anon-reachable.
2. `gate_notification_by_pref()` — definer `BEFORE INSERT` trigger on `notifications` that reads
   another user's `notification_preferences`.
3. `readable_board_ids()` — the definer read-authority helper behind **15 SELECT policies**. Anon
   invocation returns an empty set today (`auth.uid()` is null), so this is an exposed surface
   rather than a live leak — but it is the single most authority-bearing function in the schema.
4. `items_*`, `tg_goals_validate_hierarchy` — definer trigger functions; direct invocation fails
   with `0A000 trigger functions can only be called as triggers`, i.e. currently harmless, but the
   permission check happens _before_ that error, so the entrypoint is real.
5. `set_goal_links(uuid,jsonb)` — a genuine RPC; fails closed today (its body calls
   `can_read_board`), but should not be in `anon`'s schema cache at all.

### 2.3 Recurrence analysis — the existing guard is **not** load-bearing (new risk)

`20260704114000:16-17` added, as the durable fix:

```sql
alter default privileges in schema public revoke execute on functions from public, anon;
```

That entry **is** live (`pg_default_acl` for `postgres`/`public`/`f` =
`{postgres=X,authenticated=X,service_role=X}` — no PUBLIC, no `anon`). Yet all three definer
functions created _after_ it (`20260706165521`, `20260712153317`, `20260716090205`) still shipped
with the bare `=X` PUBLIC grant, while other post-lockdown functions (`check_rate_limit`,
`tg_enqueue_item_embed`, `oauth_tokens_vault_cleanup`) did not. All eight are owned by `postgres`,
so ownership does not explain the split, and no migration re-grants `public`/`anon`.

**Conclusion:** the mechanism is undetermined, but empirically the `ALTER DEFAULT PRIVILEGES` guard
**cannot be relied on**. It has now failed three times in ten days. Therefore the only trustworthy
controls are (a) an explicit per-function `revoke` in every migration that creates a definer
function, and (b) a **post-DDL assertion that queries live state and raises** — see §5.

A static lint over `supabase/migrations/*.sql` was evaluated and **rejected**: a regex sweep for
"definer function created after the lockdown with no per-function revoke naming public/anon" yields
20 hits, of which 12 are covered by `20260704114000`'s name-list `DO` block and 6 are already
`anon_exec = false` via default privileges. The file corpus is not a reliable oracle; the live
catalog is. This is why the assertion lives **in the migration**, not in Vitest.

## 3. Grant-surface decisions (each justified against how the function is actually called)

Getting this wrong breaks RLS, so each row below is backed by a live-catalog check, not by naming
convention.

### D1 — the six trigger functions: **no direct grants at all**

`ai_credential_delete_vault_secret`, `org_ai_settings_delete_vault_secret`,
`gate_notification_by_pref`, `items_set_creation_metadata`, `items_protect_creation_metadata`,
`tg_goals_validate_hierarchy`.

Evidence:

- All six are attached as triggers and **only** as triggers — confirmed via `pg_trigger`
  (`user_ai_credentials_delete_vault_secret` BEFORE DELETE, `org_ai_settings_delete_vault_secret`
  BEFORE DELETE, `gate_notification_by_pref` BEFORE INSERT on `notifications`,
  `items_set_creation_metadata` BEFORE INSERT on `items`, `items_protect_creation_metadata`
  BEFORE UPDATE on `items`, `goals_validate_hierarchy` BEFORE INSERT OR UPDATE on `goals`).
- No other routine calls them: a `pg_proc.prosrc ~ '<name>'` sweep across all of `public` returns
  **zero** callers, and no policy expression mentions them.
- Postgres fires trigger functions **without** an EXECUTE privilege check on the invoking role.
- **Same-table precedent, live:** on `items`, four sibling trigger functions
  (`tg_enqueue_item_embed`, `tg_items_single_level`, `tg_log_item_activity`,
  `tg_run_item_automations`) already sit at `{postgres,service_role}` with `authenticated` revoked,
  and item insert/update — the hottest write path in the app — works. Same for
  `tg_log_cell_activity`/`tg_run_automations` on `cell_values`, `tg_log_update_activity` /
  `item_updates_protect_attribution` on `item_updates`, `tg_automations_guard_webhook` on
  `automations`, and `oauth_tokens_vault_cleanup` on `oauth_tokens`.

End state, matching `20260724134101_mcp_oauth_vault_cleanup_acl.sql` byte-for-byte in shape:

```sql
revoke all on function public.<fn>() from public, anon, authenticated;
grant execute on function public.<fn>() to service_role;
```

### D2 — `readable_board_ids()`: **`authenticated` retained**, `anon` + PUBLIC revoked

`authenticated` **must** keep EXECUTE. The function is referenced in the `USING` expression of
**15 SELECT policies** (`attachments`, `automation_runs`, `automations`, `board_members`,
`board_views`, `cell_values`, `columns`, `groups`, `item_activities`, `item_dependencies`,
`item_embeddings`, `item_updates`, `items`, `relation_links`, `time_entries`). Policy expressions
are evaluated with the querying role's privileges, so revoking `authenticated` would turn every
board read in the product into `42501 permission denied for function readable_board_ids`. This is
the single highest-blast-radius mistake available in this task.

`anon` does not need it — see D3 for the one edge case. End state restores exactly what
`20260702120000:71-72` intended:

```sql
revoke all on function public.readable_board_ids() from public, anon;
grant execute on function public.readable_board_ids() to authenticated, service_role;
```

### D3 — the `item_embeddings_select` policy is role-`PUBLIC` (the one real behavior change)

Of the 15 policies calling `readable_board_ids()`, **14 are `TO authenticated`**. One is not:

```sql
-- 20260720090620_pgvector_item_embeddings.sql:50
create policy item_embeddings_select on public.item_embeddings
  for select using (board_id in (select public.readable_board_ids()));   -- no TO clause ⇒ PUBLIC
```

`anon` holds table-level `SELECT` on `item_embeddings` (Supabase's default table grants). So today
an anon `GET /rest/v1/item_embeddings` evaluates the policy, calls `readable_board_ids()`, and
returns `[]`. After the revoke it would return **`42501 permission denied for function
readable_board_ids`** instead of `[]`.

No app path is affected: `src/lib/ai/embeddings/search.ts` reads `item_embeddings` with the
signed-in cookie client (`authenticated`); `index-actions.ts` writes with the service client, and
`service_role` has `rolbypassrls = true` so policies never apply to it. But an error where there
was an empty array is still a behavior change, and the policy's own comment states its intent was
to "mirror the board-scoped semijoin posture of the **other authenticated tables**".

**Decision: fix the policy in the same migration** — restore the omitted `TO authenticated`:

```sql
drop policy if exists item_embeddings_select on public.item_embeddings;
create policy item_embeddings_select on public.item_embeddings
  for select to authenticated
  using (board_id in (select public.readable_board_ids()));
```

Post-change, `anon` never evaluates the policy at all → **0 rows, no error** (default-deny), which
is both the pre-existing observable behavior and strictly safer. `authenticated` is unchanged;
`service_role` bypasses RLS. Rejected alternative: leave the policy and accept the `42501`. It
"works", but it leaves a definer-authority call reachable from an unauthenticated role's query plan
and diverges from the 14 sibling policies for no benefit.

### D4 — `set_goal_links(uuid,jsonb)`: **`authenticated` retained**, `anon` + PUBLIC revoked

Called from `src/lib/goals/actions.ts:133` via `typedRpc` on the signed-in cookie client, and from
two integration suites (`src/lib/goals/goals.rls.integration.test.ts:191`,
`src/lib/boards/archived-aggregates.integration.test.ts:226`). Note: those suites name their client
`aAnon` — that is the _anon-key_ client **with a session**, i.e. Postgres role `authenticated`, not
`anon`. Retaining `authenticated` keeps both suites green. End state restores
`20260621160000:215-216`'s intent:

```sql
revoke all on function public.set_goal_links(uuid, jsonb) from public, anon;
grant execute on function public.set_goal_links(uuid, jsonb) to authenticated, service_role;
```

### Summary table

| Function                                | `public` | `anon` | `authenticated` | `service_role` | Why                                        |
| --------------------------------------- | -------- | ------ | --------------- | -------------- | ------------------------------------------ |
| `ai_credential_delete_vault_secret()`   | revoke   | revoke | **revoke**      | grant          | trigger-only (D1); touches `vault.secrets` |
| `org_ai_settings_delete_vault_secret()` | revoke   | revoke | **revoke**      | grant          | trigger-only (D1); touches `vault.secrets` |
| `gate_notification_by_pref()`           | revoke   | revoke | **revoke**      | grant          | trigger-only (D1)                          |
| `items_set_creation_metadata()`         | revoke   | revoke | **revoke**      | grant          | trigger-only (D1)                          |
| `items_protect_creation_metadata()`     | revoke   | revoke | **revoke**      | grant          | trigger-only (D1)                          |
| `tg_goals_validate_hierarchy()`         | revoke   | revoke | **revoke**      | grant          | trigger-only (D1)                          |
| `readable_board_ids()`                  | revoke   | revoke | **KEEP**        | grant          | called by 15 RLS policies (D2)             |
| `set_goal_links(uuid,jsonb)`            | revoke   | revoke | **KEEP**        | grant          | user-facing RPC (D4)                       |

## 4. Pattern to match (do not invent a new style)

Three precedents, read in full:

- `20260621130000_lockdown_definer_execution_and_perf.sql` — states the invariant; blanket
  `revoke … from public` + `from anon`, `grant … to authenticated, service_role`, then a `DO` block
  stripping `authenticated` from `tg_*` / `_*` / `handle_new_user`.
- `20260704114000_definer_execution_lockdown_hygiene.sql` — a named-list `DO` block doing
  `revoke execute on function %s from public, anon` per signature, "so every overload is covered
  without hardcoding (possibly drifting) argument signatures".
- `20260724134101_mcp_oauth_vault_cleanup_acl.sql` — the closest analogue (single definer
  vault-cleanup trigger): two statements, `revoke all … from public, anon, authenticated;` then
  `grant execute … to service_role;`, with a comment explaining that trigger execution is
  unaffected.

**Style decision:** use the explicit two-statement-per-function form from `20260724134101` rather
than a `DO` block. Rationale: all 8 signatures are known, non-overloaded, and verified against the
live catalog; explicit DDL is reviewable in the diff, deterministic, and idempotent. The `DO`-block
form exists in the precedents to cover _unknown overload sets_, which is not the case here. Every
statement is a `revoke`/`grant`, so re-application anywhere is a no-op (gotcha-57 §Decision 4).

## 5. Verification strategy (working agreement #4 — this is a grant, not code)

There is no application code to unit-test. Four layers, all executed:

1. **In-migration assertion (the primary automated gate).** Appended to the migration _after_ the
   DDL, so it runs at apply time on DEV **and again on PROD during `/sync-prod`**, and on any
   future re-application (including the throwaway TEST project via `supabase db push`):

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

   This is deliberately **class-wide, not name-listed**: it fails on any future regression, which
   is the control §2.3 says is missing. The `to_regrole` guard keeps it portable to a bare Postgres
   with no Supabase roles.

2. **Live before/after evidence on DEV** (`has_function_privilege` + `proacl`), captured verbatim
   into the session note. Before = the 8 rows in §2.1; after = zero rows.

3. **Behavioral no-regression proof for the retained grants**, in a rolled-back transaction on DEV
   (`begin; set local role authenticated; set local request.jwt.claims = …; select … ; rollback;`):
   a board-scoped `select` through a `readable_board_ids()` policy still returns rows, and an
   `insert into items` still fires `items_set_creation_metadata` and stamps `created_by`.

4. **The four gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected to be
   unaffected (no TS changes); `pnpm test` is unit-only without `.env.test`. If `.env.test` is
   configured, `goals.rls.integration.test.ts` and the `item_embeddings` / `search` RLS suites are
   the ones that would catch a mistaken revoke of `authenticated` — note that they exercise the
   **test** project, which must have the migration applied (`supabase db push`) to be meaningful.

**Explicitly not doing:** a Vitest test that greps the migration file (tautological), or a static
migration lint (rejected in §2.3 — 20 false-ish hits, the file corpus is not the oracle).

## 6. Performance & data-fetching budget (working agreement #5)

Trivial — no UI, no views, tabs, filters, sorts, or new reads. Stated for completeness because one
change does touch the hot path:

- **First paint / interactions:** unchanged. Zero new server round-trips; no client state, no
  History API involvement, no `<Link>`/router navigation added.
- **Does anything change server data?** No — the migration changes only privileges plus one policy
  `TO` clause. No rows are written.
- **Hot-path reads bounded over indexed columns?** Unchanged. `readable_board_ids()` remains
  `SECURITY DEFINER` + `stable`, so Postgres still hoists it to a once-per-query InitPlan in all 15
  policies (the whole point of `20260702120000`); an ACL entry is not part of the plan. The
  `item_embeddings_select` policy keeps its identical `USING` expression over the indexed
  `item_embeddings.board_id`; adding `TO authenticated` **removes** policy evaluation for
  non-`authenticated` roles, so it is a strict (if immeasurable) reduction. No index changes.

## 7. Independent units (input to the plan's Execution DAG — working agreement #6)

Honest assessment: this is **one migration file plus a DB-state sequence**, so it is inherently
near-sequential — mint → write DDL → apply to DEV → verify live → gate → close. Naming fake
parallelism here would be worse than admitting the chain.

The genuinely independent units are:

- **U1 — the DDL** (one file; one writer).
- **U2 — DEV application + live verification** (depends on U1; must be serialized against U1's
  final content).
- **U3 — the four repo gates** (depends only on the file existing, not on DEV state).
- **U4 — dev-memory documentation**: an ADR for the §2.3 finding ("the `ALTER DEFAULT PRIVILEGES`
  guard is not load-bearing") plus the `/sync-prod` follow-up note. Depends on U2's evidence for
  its content, but touches only `vault/` — no overlap with U1/U3.

U3 and U4 can run concurrently once U2 is done. That is the only real batch.

## 8. Delivery mechanics (non-negotiable)

- **Mint the migration only via `scripts/new-migration.sh definer_acl_lockdown`.** Never hand-write
  a version stamp (`AGENTS.md`; hour-24/25 stamps have shipped). The gotcha-57 backfill exception
  does **not** apply here — that exception is for DDL _already applied_ to DEV with no file. This
  DDL is new and unapplied, so it is an ordinary mint.
- **Apply to DEV via the `supabase-dev` MCP `apply_migration` with the SAME version + name as the
  committed file** (`name: "<stamp>_definer_acl_lockdown"`), then verify the ledger with
  `list_migrations` / `select version, name from supabase_migrations.schema_migrations order by
version desc limit 3`. On any drift run `scripts/reconcile-migration-version.sh <ledger-version>
<file-version>` (gotcha-55). Do **not** let the MCP stamp its own version.
- **Ledger↔files check both directions before closing** (gotcha-57 §Decision): every DEV version
  has a file, every file has a DEV version.
- **Types:** a `revoke`/`grant` produces byte-identical `database.types.ts`, and the policy `TO`
  clause is not in the type surface — so the expected outcome of regenerating is **no diff**. A diff
  would mean something unintended happened; investigate rather than commit. In a worktree
  `pnpm db:types` throws `LegacyProjectNotLinkedError` — use the `supabase-dev` MCP
  `generate_typescript_types` + prettier if a check is wanted.
- **PROD reaches parity only via `/sync-prod`, not via a `develop → main` promotion.** Promotion
  deploys the Vercel app; it does not push migrations. PROD carries the identical 8-function
  exposure today (§2), so **the security gap stays open on production until `/sync-prod` runs**.
  This must be stated in the closing message and the session note as an explicit outstanding action,
  not implied.

## 9. Out of scope

- A broader sweep for other role-`PUBLIC` policies elsewhere in the schema. Only
  `item_embeddings_select` is touched, and only because it is the one policy whose behavior would
  change as a direct result of D2.
- `SECURITY INVOKER` functions callable by `anon` (e.g. `match_items`). They respect RLS by
  definition and the advisor does not flag them.
- Revoking `anon`'s table-level grants on `public` tables (Supabase's default posture; a much larger
  change with its own blast radius).
- Automating the ledger↔files diff in `finish-task.sh` / `/sync-prod` — gotcha-57's open follow-up.
  Recorded as a follow-up, not built here.
- Root-causing _why_ the `ALTER DEFAULT PRIVILEGES` guard failed for three functions (§2.3). The
  assertion in §5 makes the failure loud, which is the value; the forensics are a separate task.

## 10. Risks

| Risk                                                                                                                        | Likelihood               | Mitigation                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Revoking `authenticated` on `readable_board_ids()` by pattern-matching "it's a definer helper" → **every board read 42501** | low but catastrophic     | D2 is explicit; the plan's DDL is written out verbatim; §5 layer 3 proves a board read still works before closing |
| `revoke … from public` only, leaving the two explicit `anon=X` grants (§2.1)                                                | medium                   | Every statement names `anon` explicitly; the §5 assertion fails the migration if any remain                       |
| Anon `select` on `item_embeddings` starts returning `42501`                                                                 | certain if D3 is skipped | D3 restores the omitted `TO authenticated`, so anon gets `[]` as before                                           |
| Migration lands on `develop`, everyone assumes prod is fixed                                                                | **high**                 | §8: `/sync-prod` is called out as the only path to PROD, in the closing message and session note                  |
| The ledger stamps a different version than the file (gotcha-55)                                                             | medium                   | Apply with the same version + name; verify `list_migrations`; reconcile script on drift                           |
| This class regresses again on the next definer function                                                                     | high (3× in 10 days)     | The class-wide `raise exception` assertion in §5 fails any future migration that reintroduces it                  |
