-- dry-run-guest-roster.sql
--
-- Guest roster confinement. Run AFTER the migration
-- 20261115173759_guest_roster_confinement.sql, in the SAME supabase-dev
-- execute_sql call (migration text first, then this file). There is
-- deliberately no explicit BEGIN/COMMIT/ROLLBACK: the whole call is one
-- implicit transaction and the script ENDS BY RAISING AN EXCEPTION, so
-- Postgres rolls back everything the migration and this script did. Results
-- travel in that exception's message:
--   GUEST_ROSTER {"ok_...": true, ..., "ALL_PASSED": true, "notes": {...}}
-- An error that does not start with GUEST_ROSTER means something failed
-- earlier; it rolls back too. Prints only check names, booleans, counts and
-- notes, never ids, names or emails. Fixtures are built inside the
-- transaction from existing rows (no auth users are created); a fixture that
-- cannot be built records false with note 'fixture missing'.
--
-- Cast, all in one org O (the one with the most active people):
--   A = an active owner/admin, creator of the fixture folder F
--   G = a plain member with no boards of their own and no Mono, stripped of
--       every grant in O and turned into a guest here
--   C = another member, put on F next to G (the co-member)
--   H = a member the rule says G must NOT see, and who shares no other org
--       with G (so a profile read cannot reach them another way)
--   M = an active plain member who is a guest or a bot nowhere (the control)
--   B = a live board of O, placed in F; W2 = a second workspace with nothing
--       of G's in it
-- "The rule" is restated independently below (v_rule), as plain SQL run as
-- the table owner, and compared with what G reads through RLS.

create temp table guest_roster_results (name text primary key, value jsonb, note text);

do $dry$
declare
  v_org uuid; v_ws uuid; v_ws2 uuid; v_folder uuid; v_board uuid;
  v_rule uuid[];
  v_a uuid; v_g uuid; v_c uuid; v_h uuid; v_m uuid; v_mono uuid;
  v_n bigint; v_n2 bigint; v_k bigint; v_b1 boolean; v_b2 boolean; v_b3 boolean;
  v_new_om bigint; v_new_p bigint; v_new_w bigint; v_new_mo bigint; v_new_ai bigint;
  v_old_om bigint; v_old_p bigint; v_old_w bigint; v_old_mo bigint; v_old_ai bigint;
  v_names text[] := array[
    'ok_guest_org_members_match_rule', 'ok_guest_sees_self', 'ok_guest_sees_co_member',
    'ok_guest_sees_folder_creator', 'ok_guest_sees_board_people',
    'ok_guest_does_not_see_hidden_member', 'ok_guest_sees_fewer_than_the_org',
    'ok_guest_profiles_match_rule', 'ok_guest_cannot_read_hidden_profile',
    'ok_guest_can_read_co_member_profile',
    'ok_guest_workspaces_only_shared', 'ok_guest_does_not_see_other_workspace',
    'ok_guest_monos_match_rule', 'ok_guest_reads_no_org_ai_settings',
    'ok_guest_without_access_sees_only_self', 'ok_guest_without_access_sees_no_workspace',
    'ok_guest_without_access_sees_no_mono',
    'ok_admin_sees_guest_row', 'ok_member_reads_org_ai_settings',
    'ok_member_org_members_unchanged', 'ok_member_profiles_unchanged',
    'ok_member_workspaces_unchanged', 'ok_member_monos_unchanged',
    'ok_member_org_ai_settings_unchanged', 'ok_member_guest_helpers_empty'];
  v_name text;
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- Fixture org and cast -----------------------------------------------------
  select om.org_id into v_org
    from public.org_members om
   where om.deactivated_at is null and om.role <> 'agent'
     and exists (select 1 from public.workspaces w where w.org_id = om.org_id)
     and exists (select 1 from public.boards b
                  where b.org_id = om.org_id and b.archived_at is null)
     and exists (select 1 from public.org_members a
                  where a.org_id = om.org_id and a.deactivated_at is null
                    and a.role in ('owner', 'admin'))
   group by om.org_id
  having count(*) >= 5
   order by count(*) desc, om.org_id
   limit 1;

  if v_org is not null then
    select w.id into v_ws from public.workspaces w where w.org_id = v_org order by w.id limit 1;
    select a.user_id into v_a from public.org_members a
     where a.org_id = v_org and a.deactivated_at is null and a.role in ('owner', 'admin')
     order by (a.role = 'owner') desc, a.user_id limit 1;
    select b.id into v_board from public.boards b
     where b.org_id = v_org and b.archived_at is null and b.workspace_id = v_ws
     order by b.id limit 1;
    -- G: a plain member, in no other org, with no board of their own and no Mono.
    select g.user_id into v_g from public.org_members g
     where g.org_id = v_org and g.user_id <> v_a
       and g.deactivated_at is null and g.role = 'member'
       and not exists (select 1 from public.org_members x
                        where x.user_id = g.user_id and x.org_id <> g.org_id)
       and not exists (select 1 from public.boards b
                        where b.org_id = v_org and b.created_by = g.user_id)
       and not exists (select 1 from public.folders f
                        where f.org_id = v_org and f.created_by = g.user_id)
       and not exists (select 1 from public.monos mo where mo.owner_id = g.user_id)
     order by g.user_id limit 1;
    select c.user_id into v_c from public.org_members c
     where c.org_id = v_org and c.user_id not in (v_a, v_g)
       and c.deactivated_at is null and c.role = 'member'
     order by c.user_id limit 1;
    select m.user_id into v_m from public.org_members m
     where m.org_id = v_org and m.user_id not in (v_a, v_g, v_c)
       and m.deactivated_at is null and m.role = 'member'
       and not exists (select 1 from public.org_members x
                        where x.user_id = m.user_id and x.role in ('guest', 'agent'))
     order by m.user_id limit 1;
  end if;

  if v_org is null or v_ws is null or v_a is null or v_board is null
     or v_g is null or v_c is null or v_m is null then
    foreach v_name in array v_names loop
      insert into guest_roster_results values (v_name, 'false', 'fixture missing');
    end loop;
    return;
  end if;

  -- Build: G is stripped of every grant in O and becomes a guest; F holds B
  -- and has two members, G and C; W2 is a workspace G has nothing in.
  delete from public.board_members where org_id = v_org and user_id = v_g;
  delete from public.folder_members where org_id = v_org and user_id = v_g;
  update public.org_members set role = 'guest' where org_id = v_org and user_id = v_g;
  insert into public.workspaces (org_id, name, created_by)
  values (v_org, 'guest-roster-dry-' || gen_random_uuid()::text, v_a)
  returning id into v_ws2;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'guest-roster-dry-' || gen_random_uuid()::text, v_a)
  returning id into v_folder;
  insert into public.folder_boards (folder_id, board_id)
  values (v_folder, v_board)
  on conflict (board_id) do update set folder_id = excluded.folder_id;
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_folder, v_org, v_g, 'viewer', v_a), (v_folder, v_org, v_c, 'viewer', v_a);
  insert into public.org_ai_settings (org_id) values (v_org) on conflict (org_id) do nothing;

  -- The rule, restated as the table owner (no RLS, no helper from the migration).
  with my_folders as (
    select fm.folder_id from public.folder_members fm
     where fm.user_id = v_g and fm.org_id = v_org
  ), my_boards as (
    select b.id, b.created_by from public.boards b
     where b.org_id = v_org and (
       b.created_by = v_g
       or exists (select 1 from public.board_members bm
                   where bm.board_id = b.id and bm.user_id = v_g)
       or exists (select 1 from public.folder_boards fb
                   where fb.board_id = b.id and fb.folder_id in (select folder_id from my_folders)))
  )
  select array_agg(r.user_id) into v_rule from (
  select v_g as user_id
  union select fm.user_id from public.folder_members fm
         where fm.folder_id in (select folder_id from my_folders)
  union select f.created_by from public.folders f
         where f.id in (select folder_id from my_folders) and f.created_by is not null
  union select b.created_by from my_boards b where b.created_by is not null
  union select bm.user_id from public.board_members bm where bm.board_id in (select id from my_boards)
  union select fm.user_id from public.folder_boards fb
          join public.folder_members fm on fm.folder_id = fb.folder_id
         where fb.board_id in (select id from my_boards)
  ) r;

  -- H: someone in O the rule hides, reachable by G through no other org.
  select h.user_id into v_h from public.org_members h
   where h.org_id = v_org and h.deactivated_at is null and h.role <> 'agent'
     and h.user_id <> all (v_rule)
     and not exists (select 1 from public.org_members a
                       join public.org_members b on b.org_id = a.org_id
                      where a.user_id = v_g and b.user_id = h.user_id and a.org_id <> v_org)
   order by h.user_id limit 1;
  select mo.user_id into v_mono from public.monos mo where mo.org_id = v_org
   order by mo.user_id limit 1;

  -- 1. The guest's org_members -------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  -- seen but not allowed
  select count(*) into v_n from public.org_members om
   where om.org_id = v_org and om.user_id <> all (v_rule);
  -- seen in all
  select count(*) into v_n2 from public.org_members om where om.org_id = v_org;
  v_b1 := exists (select 1 from public.org_members where org_id = v_org and user_id = v_g);
  v_b2 := exists (select 1 from public.org_members where org_id = v_org and user_id = v_c);
  v_b3 := exists (select 1 from public.org_members where org_id = v_org and user_id = v_a);
  perform set_config('role', 'none', true);
  -- allowed members of O (the rule may name people who have since left O)
  select count(*) into v_k from public.org_members om
   where om.org_id = v_org and om.user_id = any (v_rule);
  insert into guest_roster_results values
    ('ok_guest_org_members_match_rule', to_jsonb(v_n = 0 and v_n2 = v_k), null),
    ('ok_guest_sees_self', to_jsonb(v_b1), null),
    ('ok_guest_sees_co_member', to_jsonb(v_b2), null),
    ('ok_guest_sees_folder_creator', to_jsonb(v_b3), null),
    ('ok_guest_sees_fewer_than_the_org', to_jsonb(
       v_n2 < (select count(*) from public.org_members where org_id = v_org)), null);

  -- The creator of B and everyone with a direct grant on it are visible.
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.org_members om where om.org_id = v_org;
  perform set_config('role', 'none', true);
  select count(*) into v_k from (
    select b.created_by as user_id from public.boards b where b.id = v_board and b.created_by is not null
    union select bm.user_id from public.board_members bm where bm.board_id = v_board
  ) p where p.user_id in (select user_id from public.org_members where org_id = v_org)
        and p.user_id <> all (v_rule);
  insert into guest_roster_results values
    ('ok_guest_sees_board_people', to_jsonb(v_k = 0 and v_n >= 3), null);

  if v_h is null then
    insert into guest_roster_results values
      ('ok_guest_does_not_see_hidden_member', 'false', 'fixture missing'),
      ('ok_guest_cannot_read_hidden_profile', 'false', 'fixture missing');
  else
    perform set_config('role', 'authenticated', true);
    v_b1 := exists (select 1 from public.org_members where user_id = v_h);
    v_b2 := exists (select 1 from public.profiles where id = v_h);
    perform set_config('role', 'none', true);
    insert into guest_roster_results values
      ('ok_guest_does_not_see_hidden_member', to_jsonb(not v_b1), null),
      ('ok_guest_cannot_read_hidden_profile', to_jsonb(not v_b2), null);
  end if;

  -- 2. The guest's profiles ------------------------------------------------
  -- G is in no other org, so every profile G reads must be in the rule.
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.profiles p
   where p.id <> all (v_rule);
  select count(*) into v_n2 from public.profiles p;
  v_b1 := exists (select 1 from public.profiles where id = v_c);
  perform set_config('role', 'none', true);
  select count(*) into v_k from public.profiles p
   where p.id = any (v_rule);
  insert into guest_roster_results values
    ('ok_guest_profiles_match_rule', to_jsonb(v_n = 0 and v_n2 = v_k), null),
    ('ok_guest_can_read_co_member_profile', to_jsonb(v_b1), null);

  -- 3. The guest's workspaces --------------------------------------------
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.workspaces w where w.org_id = v_org;
  v_b1 := exists (select 1 from public.workspaces where id = v_ws);
  v_b2 := exists (select 1 from public.workspaces where id = v_ws2);
  perform set_config('role', 'none', true);
  insert into guest_roster_results values
    ('ok_guest_workspaces_only_shared', to_jsonb(v_b1 and v_n = 1), null),
    ('ok_guest_does_not_see_other_workspace', to_jsonb(not v_b2), null);

  -- 4. The guest's Monos (table and the security_invoker view) -------------
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.monos mo
   where mo.org_id = v_org and mo.user_id <> all (v_rule);
  select count(*) into v_n2 from public.monos mo where mo.org_id = v_org;
  select count(*) into v_new_mo from public.org_monos mo where mo.org_id = v_org;
  perform set_config('role', 'none', true);
  select count(*) into v_k from public.monos mo
   where mo.org_id = v_org and mo.user_id = any (v_rule);
  insert into guest_roster_results values
    ('ok_guest_monos_match_rule',
     to_jsonb(v_n = 0 and v_n2 = v_k and v_new_mo = v_k),
     case when v_mono is null then 'no Mono in the fixture org: vacuous'
          when v_k = 0 then 'the org''s Mono is on no board the guest reads: hidden case'
          else 'a Mono is on a board the guest reads: visible case' end);

  -- 5. The guest's org_ai_settings ----------------------------------------
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.org_ai_settings;
  perform set_config('role', 'none', true);
  insert into guest_roster_results values
    ('ok_guest_reads_no_org_ai_settings', to_jsonb(
       v_n = 0 and exists (select 1 from public.org_ai_settings where org_id = v_org)), null);

  -- 6. A guest who has been given nothing sees only themselves --------------
  delete from public.folder_members where folder_id = v_folder and user_id = v_g;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.org_members;
  v_b1 := exists (select 1 from public.org_members where org_id = v_org and user_id = v_g);
  select count(*) into v_n2 from public.workspaces;
  select count(*) into v_k from public.monos;
  perform set_config('role', 'none', true);
  insert into guest_roster_results values
    ('ok_guest_without_access_sees_only_self', to_jsonb(v_n = 1 and v_b1), null),
    ('ok_guest_without_access_sees_no_workspace', to_jsonb(v_n2 = 0), null),
    ('ok_guest_without_access_sees_no_mono', to_jsonb(v_k = 0), null);
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_folder, v_org, v_g, 'viewer', v_a);

  -- 7. An admin still sees the guest ---------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_b1 := exists (select 1 from public.org_members
                   where org_id = v_org and user_id = v_g and role = 'guest');
  v_b2 := exists (select 1 from public.profiles where id = v_g);
  perform set_config('role', 'none', true);
  insert into guest_roster_results values
    ('ok_admin_sees_guest_row', to_jsonb(v_b1 and v_b2), null);

  -- 8. A regular member reads exactly what the pre-migration policies gave.
  -- M is a guest or bot nowhere, so the old predicates are: org_members,
  -- workspaces, monos and org_ai_settings of M's active orgs; profiles of
  -- everyone M shares any org row with (shares_org_with has no active filter).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_new_om from public.org_members;
  select count(*) into v_new_p from public.profiles;
  select count(*) into v_new_w from public.workspaces;
  select count(*) into v_new_mo from public.monos;
  select count(*) into v_new_ai from public.org_ai_settings;
  select count(*) into v_n from public.guest_visible_members();
  select count(*) into v_n2 from public.guest_visible_workspace_ids();
  v_b1 := exists (select 1 from public.org_ai_settings where org_id = v_org);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_old_om from public.org_members om
   where om.org_id in (select org_id from public.org_members
                        where user_id = v_m and deactivated_at is null);
  select count(*) into v_old_p from public.profiles p
   where p.id = v_m
      or exists (select 1 from public.org_members me
                   join public.org_members them on them.org_id = me.org_id
                  where me.user_id = v_m and them.user_id = p.id);
  select count(*) into v_old_w from public.workspaces w
   where w.org_id in (select org_id from public.org_members
                       where user_id = v_m and deactivated_at is null);
  select count(*) into v_old_mo from public.monos mo
   where mo.org_id in (select org_id from public.org_members
                        where user_id = v_m and deactivated_at is null);
  select count(*) into v_old_ai from public.org_ai_settings s
   where s.org_id in (select org_id from public.org_members
                       where user_id = v_m and deactivated_at is null);
  insert into guest_roster_results values
    ('ok_member_reads_org_ai_settings', to_jsonb(v_b1), null),
    ('ok_member_org_members_unchanged', to_jsonb(v_new_om = v_old_om and v_new_om > 1), null),
    ('ok_member_profiles_unchanged', to_jsonb(v_new_p = v_old_p and v_new_p > 1), null),
    ('ok_member_workspaces_unchanged', to_jsonb(v_new_w = v_old_w and v_new_w > 1), null),
    ('ok_member_monos_unchanged', to_jsonb(v_new_mo = v_old_mo),
     case when v_old_mo = 0 then 'no Mono in the member''s orgs: vacuous' end),
    ('ok_member_org_ai_settings_unchanged', to_jsonb(v_new_ai = v_old_ai and v_new_ai > 0), null),
    ('ok_member_guest_helpers_empty', to_jsonb(v_n = 0 and v_n2 = 0), null);
end
$dry$;

-- 9. Grants on the new helpers: never anon, never public.
insert into guest_roster_results (name, value)
select 'ok_helpers_not_executable_by_anon', to_jsonb(
  not has_function_privilege('anon', 'public.auth_user_guest_orgs()', 'execute')
  and not has_function_privilege('anon', 'public.guest_visible_members()', 'execute')
  and not has_function_privilege('anon', 'public.guest_visible_workspace_ids()', 'execute')
  and not has_function_privilege('anon', 'public.shares_full_org_with(uuid)', 'execute'))
union all
select 'ok_helpers_executable_by_authenticated', to_jsonb(
  has_function_privilege('authenticated', 'public.auth_user_guest_orgs()', 'execute')
  and has_function_privilege('authenticated', 'public.guest_visible_members()', 'execute')
  and has_function_privilege('authenticated', 'public.guest_visible_workspace_ids()', 'execute')
  and has_function_privilege('authenticated', 'public.shares_full_org_with(uuid)', 'execute'));

insert into guest_roster_results (name, value)
select 'ALL_PASSED', to_jsonb(not exists (
  select 1 from guest_roster_results r where r.value is distinct from 'true'::jsonb));

do $report$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_object_agg(name, value), '{}'::jsonb)
         || jsonb_build_object('notes', coalesce(
              (select jsonb_object_agg(name, note) from guest_roster_results where note is not null),
              '{}'::jsonb))
    into v_out
  from guest_roster_results;
  raise exception 'GUEST_ROSTER %', v_out::text;
end
$report$;
