-- Guest confinement follow-up. Run AFTER the migration
-- 20261114201906_guest_confinement_followup.sql, in the same execute_sql call.
-- There is deliberately no explicit BEGIN/COMMIT/ROLLBACK: the whole call is
-- one implicit transaction and the script ENDS BY RAISING AN EXCEPTION, so
-- Postgres rolls back everything the migration and this script did. Results
-- travel in that exception's message:
--   GUEST2_DRY {"ok_...": true, ..., "ALL_PASSED": true, "notes": {...}}
-- An error that does not start with GUEST2_DRY means something failed earlier;
-- it rolls back too. Prints only check names, booleans and notes, never ids,
-- names or emails. Fixtures are built inside the transaction from existing
-- rows (no auth users are created); a fixture that cannot be built records
-- false with note 'fixture missing'.
--
-- Cast: O = an org; M = an active plain member of O who is a guest or bot
-- nowhere; A = an active owner/admin of O; G = an active guest of O (an
-- existing one, or another plain member turned into a guest here); C = the
-- creator of a board B in O that M is made unable to read.

create temp table guest2_dry_results (name text primary key, value jsonb, note text);

do $dry$
declare
  v_org uuid; v_ws uuid; v_m uuid; v_a uuid; v_g uuid; v_g_email text;
  v_board uuid; v_creator uuid; v_report uuid; v_rb uuid; v_folder uuid;
  v_bot uuid; v_bot_org uuid; v_bot_owner uuid; v_owner_role public.org_role;
  v_rows int; v_n bigint; v_c bigint; v_raised boolean; v_code text; v_msg text;
  v_b1 boolean; v_b2 boolean; v_b3 boolean;
  v_new_d bigint; v_new_f bigint; v_new_r bigint;
  v_old_d bigint; v_old_f bigint; v_old_r bigint;
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- Fixture org and cast -----------------------------------------------------
  select om.org_id, om.user_id into v_org, v_m
    from public.org_members om
   where om.role = 'member' and om.deactivated_at is null
     and not exists (select 1 from public.org_members x
                      where x.user_id = om.user_id and x.role in ('guest', 'agent'))
     and exists (select 1 from public.workspaces w where w.org_id = om.org_id)
     and exists (select 1 from public.boards b
                  join public.org_members bc on bc.org_id = b.org_id and bc.user_id = b.created_by
                   and bc.deactivated_at is null and bc.role not in ('guest', 'agent')
                  where b.org_id = om.org_id and b.created_by <> om.user_id)
     and exists (select 1 from public.org_members a
                  where a.org_id = om.org_id and a.user_id <> om.user_id
                    and a.deactivated_at is null and a.role in ('owner', 'admin'))
     and exists (select 1 from public.org_members g join auth.users u on u.id = g.user_id
                  where g.org_id = om.org_id and g.user_id <> om.user_id
                    and g.deactivated_at is null and g.role in ('guest', 'member')
                    and u.email is not null
                    and not exists (select 1 from public.monos mo where mo.owner_id = g.user_id))
   order by (exists (select 1 from public.org_members g
                      where g.org_id = om.org_id and g.role = 'guest'
                        and g.deactivated_at is null)) desc,
            om.org_id, om.user_id
   limit 1;

  if v_org is null then
    insert into guest2_dry_results values
      ('ok_guest_cannot_update_workspace', 'false', 'fixture missing'),
      ('ok_member_can_update_workspace', 'false', 'fixture missing'),
      ('ok_guest_reads_no_report_boards', 'false', 'fixture missing'),
      ('ok_member_reads_report_boards', 'false', 'fixture missing'),
      ('ok_guest_cannot_insert_report_boards', 'false', 'fixture missing'),
      ('ok_guest_cannot_delete_report_boards', 'false', 'fixture missing'),
      ('ok_non_reader_sees_no_board_agents', 'false', 'fixture missing'),
      ('ok_reader_sees_board_agents', 'false', 'fixture missing'),
      ('ok_create_mono_refuses_guest', 'false', 'fixture missing'),
      ('ok_create_mono_member_not_refused_as_guest', 'false', 'fixture missing'),
      ('ok_removal_fixture_present', 'false', 'fixture missing'),
      ('ok_removal_drops_folder_members', 'false', 'fixture missing'),
      ('ok_removal_revokes_folder_invitation', 'false', 'fixture missing'),
      ('ok_member_dashboards_unchanged', 'false', 'fixture missing'),
      ('ok_member_folders_unchanged', 'false', 'fixture missing'),
      ('ok_member_report_boards_unchanged', 'false', 'fixture missing');
  else
    select w.id into v_ws from public.workspaces w where w.org_id = v_org order by w.id limit 1;
    select a.user_id into v_a from public.org_members a
     where a.org_id = v_org and a.user_id <> v_m and a.deactivated_at is null
       and a.role in ('owner', 'admin')
     order by (a.role = 'owner') desc, a.user_id limit 1;
    -- G: an existing active guest, else another plain member made a guest here.
    select g.user_id, lower(u.email::text) into v_g, v_g_email
      from public.org_members g join auth.users u on u.id = g.user_id
     where g.org_id = v_org and g.user_id <> v_m and g.user_id <> v_a
       and g.deactivated_at is null and g.role in ('guest', 'member') and u.email is not null
       and not exists (select 1 from public.monos mo where mo.owner_id = g.user_id)
     order by (g.role = 'guest') desc, g.user_id limit 1;
    if v_g is not null then
      update public.org_members set role = 'guest'
       where org_id = v_org and user_id = v_g and role <> 'guest';
    end if;
    select b.id, b.created_by into v_board, v_creator
      from public.boards b
      join public.org_members bc on bc.org_id = b.org_id and bc.user_id = b.created_by
       and bc.deactivated_at is null and bc.role not in ('guest', 'agent')
     where b.org_id = v_org and b.created_by <> v_m
       and b.created_by is distinct from v_g
     order by b.id limit 1;

    -- 1. Workspaces --------------------------------------------------------
    if v_g is null then
      insert into guest2_dry_results values
        ('ok_guest_cannot_update_workspace', 'false', 'fixture missing');
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      update public.workspaces set name = name where id = v_ws;
      get diagnostics v_rows = row_count;
      perform set_config('role', 'none', true);
      insert into guest2_dry_results values
        ('ok_guest_cannot_update_workspace', to_jsonb(v_rows = 0), null);
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.workspaces set name = name where id = v_ws;
    get diagnostics v_rows = row_count;
    perform set_config('role', 'none', true);
    insert into guest2_dry_results values
      ('ok_member_can_update_workspace', to_jsonb(v_rows = 1), null);

    -- 2. report_boards -----------------------------------------------------
    perform set_config('request.jwt.claims', '', true);
    if v_board is null then
      insert into guest2_dry_results values
        ('ok_guest_reads_no_report_boards', 'false', 'fixture missing'),
        ('ok_member_reads_report_boards', 'false', 'fixture missing'),
        ('ok_guest_cannot_insert_report_boards', 'false', 'fixture missing'),
        ('ok_guest_cannot_delete_report_boards', 'false', 'fixture missing');
    else
      insert into public.reports (org_id) values (v_org) returning id into v_report;
      insert into public.report_boards (org_id, report_id, board_id)
      values (v_org, v_report, v_board) returning id into v_rb;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into v_c from public.report_boards where id = v_rb;
      perform set_config('role', 'none', true);
      insert into guest2_dry_results values
        ('ok_member_reads_report_boards', to_jsonb(v_c = 1), null);

      if v_g is null then
        insert into guest2_dry_results values
          ('ok_guest_reads_no_report_boards', 'false', 'fixture missing'),
          ('ok_guest_cannot_insert_report_boards', 'false', 'fixture missing'),
          ('ok_guest_cannot_delete_report_boards', 'false', 'fixture missing');
      else
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
        perform set_config('role', 'authenticated', true);
        select count(*) into v_n from public.report_boards where org_id = v_org;
        perform set_config('role', 'none', true);
        insert into guest2_dry_results values
          ('ok_guest_reads_no_report_boards', to_jsonb(v_n = 0), null);

        v_raised := false; v_code := null;
        begin
          perform set_config('role', 'authenticated', true);
          insert into public.report_boards (org_id, report_id, board_id, position)
          values (v_org, v_report, v_board, 1);
        exception when others then
          v_raised := true; v_code := sqlstate;
        end;
        perform set_config('role', 'none', true);
        insert into guest2_dry_results values
          ('ok_guest_cannot_insert_report_boards', to_jsonb(v_raised and v_code = '42501'), null);

        perform set_config('role', 'authenticated', true);
        delete from public.report_boards where id = v_rb;
        get diagnostics v_rows = row_count;
        perform set_config('role', 'none', true);
        insert into guest2_dry_results values
          ('ok_guest_cannot_delete_report_boards',
           to_jsonb(v_rows = 0 and exists (select 1 from public.report_boards where id = v_rb)), null);
      end if;
    end if;

    -- 3. board_agents: M is made unable to read B; C (its creator) can. -----
    perform set_config('request.jwt.claims', '', true);
    if v_board is null then
      insert into guest2_dry_results values
        ('ok_non_reader_sees_no_board_agents', 'false', 'fixture missing'),
        ('ok_reader_sees_board_agents', 'false', 'fixture missing');
    else
      delete from public.board_members where board_id = v_board and user_id = v_m;
      delete from public.folder_members fm
       using public.folder_boards fb
       where fb.folder_id = fm.folder_id and fb.board_id = v_board and fm.user_id = v_m;
      insert into public.board_agents (org_id, board_id, created_by)
      values (v_org, v_board, v_creator)
      on conflict (board_id) do nothing;

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      v_b1 := public.can_read_board(v_board);
      select count(*) into v_n from public.board_agents where board_id = v_board;
      perform set_config('role', 'none', true);
      insert into guest2_dry_results values
        ('ok_non_reader_sees_no_board_agents', to_jsonb(not v_b1 and v_n = 0), null);

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into v_c from public.board_agents where board_id = v_board;
      perform set_config('role', 'none', true);
      insert into guest2_dry_results values
        ('ok_reader_sees_board_agents', to_jsonb(v_c = 1), null);
    end if;

    -- 4a. create_mono (service-role path: no JWT) ---------------------------
    perform set_config('request.jwt.claims', '', true);
    if v_g is null then
      insert into guest2_dry_results values
        ('ok_create_mono_refuses_guest', 'false', 'fixture missing');
    else
      v_raised := false; v_code := null; v_msg := null;
      begin
        perform public.create_mono(v_org, v_g, gen_random_uuid(), 'dry', '#000000');
      exception when others then
        v_raised := true; v_code := sqlstate; v_msg := sqlerrm;
      end;
      insert into guest2_dry_results values
        ('ok_create_mono_refuses_guest',
         to_jsonb(v_raised and v_code = '42501' and v_msg = 'guests cannot create a Mono'), null);
    end if;
    -- Control: a plain member is not refused as a guest (a random bot id fails
    -- later, as 'not a Mono bot user', or their existing Mono is returned).
    v_msg := null;
    begin
      perform public.create_mono(v_org, v_m, gen_random_uuid(), 'dry', '#000000');
    exception when others then
      v_msg := sqlerrm;
    end;
    insert into guest2_dry_results values
      ('ok_create_mono_member_not_refused_as_guest',
       to_jsonb(v_msg is distinct from 'guests cannot create a Mono'), null);

    -- 5. Removal through remove_member drops folder access -----------------
    perform set_config('request.jwt.claims', '', true);
    if v_g is null or v_a is null then
      insert into guest2_dry_results values
        ('ok_removal_fixture_present', 'false', 'fixture missing'),
        ('ok_removal_drops_folder_members', 'false', 'fixture missing'),
        ('ok_removal_revokes_folder_invitation', 'false', 'fixture missing');
    else
      insert into public.folders (org_id, workspace_id, name, created_by)
      values (v_org, v_ws, 'guest2-dry-' || gen_random_uuid()::text, v_a)
      returning id into v_folder;
      insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
      values (v_folder, v_org, v_g, 'viewer', v_a)
      on conflict (folder_id, user_id) do nothing;
      insert into public.folder_invitations (folder_id, org_id, email, access_level, invited_by)
      values (v_folder, v_org, v_g_email, 'viewer', v_a);
      insert into guest2_dry_results values
        ('ok_removal_fixture_present', to_jsonb(
          exists (select 1 from public.folder_members where org_id = v_org and user_id = v_g)
          and exists (select 1 from public.folder_invitations
                       where folder_id = v_folder and status = 'pending')), null);

      perform set_config('request.jwt.claims',
        json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      perform public.remove_member(v_org, v_g);
      perform set_config('role', 'none', true);
      perform set_config('request.jwt.claims', '', true);

      insert into guest2_dry_results values
        ('ok_removal_drops_folder_members', to_jsonb(
          not exists (select 1 from public.folder_members where org_id = v_org and user_id = v_g)
          and not exists (select 1 from public.org_members where org_id = v_org and user_id = v_g)), null),
        ('ok_removal_revokes_folder_invitation', to_jsonb(
          exists (select 1 from public.folder_invitations where folder_id = v_folder and status = 'revoked')
          and not exists (select 1 from public.folder_invitations
                           where org_id = v_org and lower(email) = v_g_email and status = 'pending')), null);
    end if;

    -- 6. A regular member's visible counts match the pre-migration predicates.
    -- M is guest/bot nowhere, so the old is_org_guest was false for M in every
    -- org and the old auth_user_full_orgs was M's active non-guest orgs.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_new_d from public.dashboards;
    select count(*) into v_new_f from public.folders;
    select count(*) into v_new_r from public.report_boards;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);

    select count(*) into v_old_d from public.dashboards d
     where d.org_id in (select org_id from public.org_members
                         where user_id = v_m and deactivated_at is null and role <> 'guest')
        or (d.org_id in (select org_id from public.org_members
                          where user_id = v_m and deactivated_at is null)
            and d.folder_id is not null
            and exists (select 1 from public.folder_members fm
                         where fm.folder_id = d.folder_id and fm.user_id = v_m));
    select count(*) into v_old_f from public.folders f
     where f.org_id in (select org_id from public.org_members
                         where user_id = v_m and deactivated_at is null)
       and (not exists (select 1 from public.org_members g
                         where g.org_id = f.org_id and g.user_id = v_m
                           and g.role = 'guest' and g.deactivated_at is null)
            or exists (select 1 from public.folder_members fm
                        where fm.folder_id = f.id and fm.user_id = v_m));
    select count(*) into v_old_r from public.report_boards r
     where r.org_id in (select org_id from public.org_members
                         where user_id = v_m and deactivated_at is null);
    insert into guest2_dry_results values
      ('ok_member_dashboards_unchanged', to_jsonb(v_new_d = v_old_d), null),
      ('ok_member_folders_unchanged', to_jsonb(v_new_f = v_old_f and v_new_f > 0), null),
      ('ok_member_report_boards_unchanged', to_jsonb(v_new_r = v_old_r and v_new_r > 0), null);
  end if;

  -- 4b/4c. is_org_guest / auth_user_full_orgs / tg_block_guest_insert for a bot.
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  select m.user_id, m.org_id, m.owner_id, oo.role
    into v_bot, v_bot_org, v_bot_owner, v_owner_role
    from public.monos m
    join public.org_members am on am.user_id = m.user_id and am.org_id = m.org_id
     and am.role = 'agent' and am.deactivated_at is null
    join public.org_members oo on oo.org_id = m.org_id and oo.user_id = m.owner_id
     and oo.role not in ('guest', 'agent')
   order by m.user_id limit 1;
  if v_bot is null then
    insert into guest2_dry_results values
      ('ok_bot_of_member_is_not_guest', 'false', 'fixture missing'),
      ('ok_bot_of_guest_is_guest', 'false', 'fixture missing'),
      ('ok_bot_of_guest_not_in_full_orgs', 'false', 'fixture missing'),
      ('ok_bot_of_guest_blocked_from_insert', 'false', 'fixture missing');
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_bot, 'role', 'authenticated')::text, true);
    v_b1 := public.is_org_guest(v_bot_org);
    v_b2 := v_bot_org in (select public.auth_user_full_orgs());
    perform set_config('request.jwt.claims', '', true);
    insert into guest2_dry_results values
      ('ok_bot_of_member_is_not_guest', to_jsonb(not v_b1 and v_b2), null);

    -- Turn the owner into a guest (rolled back with everything else).
    update public.org_members set role = 'guest'
     where org_id = v_bot_org and user_id = v_bot_owner;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_bot, 'role', 'authenticated')::text, true);
    v_b1 := public.is_org_guest(v_bot_org);
    v_b2 := v_bot_org in (select public.auth_user_full_orgs());
    v_raised := false; v_msg := null;
    begin
      insert into public.workspaces (org_id, name, created_by)
      values (v_bot_org, 'guest2-dry', v_bot);
    exception when others then
      v_raised := true; v_msg := sqlerrm;
    end;
    perform set_config('request.jwt.claims', '', true);
    update public.org_members set role = v_owner_role
     where org_id = v_bot_org and user_id = v_bot_owner;
    insert into guest2_dry_results values
      ('ok_bot_of_guest_is_guest', to_jsonb(v_b1), null),
      ('ok_bot_of_guest_not_in_full_orgs', to_jsonb(not v_b2), null),
      ('ok_bot_of_guest_blocked_from_insert',
       to_jsonb(v_raised and v_msg = 'guests cannot create this here'), null);
  end if;
end
$dry$;

insert into guest2_dry_results (name, value)
select 'ALL_PASSED', to_jsonb(not exists (
  select 1 from guest2_dry_results r where r.value is distinct from 'true'::jsonb));

do $report$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_object_agg(name, value), '{}'::jsonb)
         || jsonb_build_object('notes', coalesce(
              (select jsonb_object_agg(name, note) from guest2_dry_results where note is not null),
              '{}'::jsonb))
    into v_out
  from guest2_dry_results;
  raise exception 'GUEST2_DRY %', v_out::text;
end
$report$;
