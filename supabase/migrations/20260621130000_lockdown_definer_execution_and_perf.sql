-- Security + performance advisor cleanup, pass 2.
--
-- SECURITY — anon/authenticated_security_definer_function_executable (125 WARN):
-- Postgres grants EXECUTE on every function to PUBLIC (plus Supabase grants the
-- anon/authenticated/service_role roles explicitly), so all SECURITY DEFINER
-- functions are callable straight off the REST API by logged-out (`anon`) and
-- logged-in (`authenticated`) users — bypassing RLS as the owner. Lock that down
-- to the end-state an earlier migration already established for
-- platform_user_sole_owned_orgs (explicit authenticated/service_role grants, no
-- PUBLIC, no anon):
--   * anon executes NOTHING — no logged-out RPC exists; the browser client only
--     acts as `anon` when signed out.
--   * authenticated keeps EXECUTE on RLS helpers (called inside policies) and the
--     user-facing RPCs the app invokes, but loses it on trigger functions and
--     internal `_`-prefixed helpers, which only ever run via triggers, pg_cron,
--     or the service-role backend (verified: no production code .rpc()s them).
--   * service_role keeps everything.

-- 1. Drop the blanket PUBLIC grant and the explicit anon grant on all current
--    public functions, then re-assert the trusted roles explicitly.
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;

-- 2. Strip authenticated EXECUTE from trigger + internal functions. Trigger
--    functions fire regardless of the caller's EXECUTE privilege, and the
--    internal helpers are service-role/cron-only, so this changes no app path —
--    it only removes the direct REST entrypoint the advisor flags.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (p.proname like 'tg\_%' or p.proname like '\_%' or p.proname = 'handle_new_user')
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end $$;

-- PERFORMANCE — unindexed_foreign_keys (the 4 missed last pass): these FK columns
-- only appeared "covered" by a composite index where they are NOT the leading
-- column, so the advisor (correctly) still flags them. Add leading-column indexes.
create index if not exists attachments_column_id_idx on public.attachments (column_id);
create index if not exists automation_date_fires_item_id_idx on public.automation_date_fires (item_id);
create index if not exists relation_links_column_id_idx on public.relation_links (column_id);
create index if not exists time_entries_column_id_idx on public.time_entries (column_id);

-- PERFORMANCE — multiple_permissive_policies: board_members & relation_links each
-- had a FOR ALL "write" policy whose SELECT arm overlapped the dedicated read
-- policy, so two permissive policies ran per SELECT. Split the write policy into
-- INSERT/UPDATE/DELETE (identical predicates) so SELECT has exactly one policy.
-- Read access is unchanged: owners/editors still satisfy the read policy's
-- can_read_board() check.

drop policy "board_members: owner manages" on public.board_members;
create policy "board_members: owner inserts" on public.board_members
  for insert to authenticated
  with check (
    is_org_member(org_id) and exists (
      select 1 from boards b
      where b.id = board_members.board_id and b.created_by = (select auth.uid())));
create policy "board_members: owner updates" on public.board_members
  for update to authenticated
  using (exists (
    select 1 from boards b
    where b.id = board_members.board_id and b.created_by = (select auth.uid())))
  with check (
    is_org_member(org_id) and exists (
      select 1 from boards b
      where b.id = board_members.board_id and b.created_by = (select auth.uid())));
create policy "board_members: owner deletes" on public.board_members
  for delete to authenticated
  using (exists (
    select 1 from boards b
    where b.id = board_members.board_id and b.created_by = (select auth.uid())));

drop policy "relation_links: write if can edit board" on public.relation_links;
create policy "relation_links: insert if can edit board" on public.relation_links
  for insert to authenticated
  with check (is_org_member(org_id) and can_edit_board(board_id));
create policy "relation_links: update if can edit board" on public.relation_links
  for update to authenticated
  using (can_edit_board(board_id))
  with check (is_org_member(org_id) and can_edit_board(board_id));
create policy "relation_links: delete if can edit board" on public.relation_links
  for delete to authenticated
  using (can_edit_board(board_id));
