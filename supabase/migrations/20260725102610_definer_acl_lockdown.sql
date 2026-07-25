-- 20260725102610_definer_acl_lockdown.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
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
