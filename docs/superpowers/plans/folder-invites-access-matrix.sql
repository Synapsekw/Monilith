-- Folder invites access matrix. Run AFTER the migration SQL, in the same
-- execute_sql call. There is deliberately no explicit BEGIN/ROLLBACK: an
-- explicit BEGIN would leave the session in an aborted transaction, still
-- holding table locks, if any statement failed part-way. Instead the whole
-- call runs as one implicit transaction and the script ENDS BY RAISING AN
-- EXCEPTION, so Postgres rolls back everything the migration and this script
-- did. The results travel in that exception's message:
--   ACCESS_MATRIX {"<check>": {"value": <value>, "note": <note>}, ...}
-- An error that does not start with ACCESS_MATRIX means something failed
-- earlier; it too rolls back.
-- Output: one entry per check, (name, value, note). A check passes when value = true.
-- Names starting with t_ are timings in ms; 'fixture' = NO_FIXTURE means no
-- usable data. ALL_PASSED is true only when every check value is true; a check
-- whose fixture could not be built is false with note 'fixture missing'. It prints only check names and booleans/numbers, never ids,
-- names or emails.

create temp table matrix_results (name text primary key, value jsonb, note text);

do $matrix$
declare
  v_org uuid; v_owner uuid; v_other uuid; v_board uuid; v_ws uuid;
  v_board2 uuid; v_third uuid; v_folder2 uuid;
  v_folder uuid; v_tmp_folder uuid;
  v_email text; v_org_inv uuid;
  r jsonb := '{}'::jsonb; nt jsonb := '{}'::jsonb;
  v_raised boolean; v_n int; v_m int;
  v_plan json; v_ms numeric; v_best numeric; i int;
begin
  -- A board B created by U, and another active plain member V of the same org.
  select b.org_id, b.created_by, om.user_id, b.id, b.workspace_id
    into v_org, v_owner, v_other, v_board, v_ws
  from public.boards b
  join public.org_members oc
    on oc.org_id = b.org_id and oc.user_id = b.created_by and oc.deactivated_at is null
  join public.org_members om
    on om.org_id = b.org_id and om.user_id <> b.created_by
   and om.deactivated_at is null and om.role = 'member'
  where b.archived_at is null
  order by (select count(*) from public.items it where it.board_id = b.id) desc
  limit 1;
  if v_board is null then
    insert into matrix_results values ('fixture', '"NO_FIXTURE"');
    return;
  end if;

  -- Own fixtures: a second board, and a third plain member (an existing
  -- approved auth user added to the org; no auth users are created).
  perform set_config('request.jwt.claims', '', true);
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-board2', v_owner)
  returning id into v_board2;
  select om.user_id into v_third from public.org_members om
   where om.org_id = v_org and om.role = 'member' and om.deactivated_at is null
     and om.user_id <> v_other
   order by (om.user_id = v_owner) limit 1;
  if v_third is null then
    begin
      insert into public.org_members (org_id, user_id, role)
      select v_org, u.id, 'member'
        from auth.users u
        join public.account_approvals a on a.user_id = u.id and a.status = 'approved'
       where not exists (select 1 from public.org_members x where x.org_id = v_org and x.user_id = u.id)
       limit 1
      returning user_id into v_third;
    exception when others then v_third := null;
    end;
  end if;

  -- V starts with no access: drop any direct grant, take the board out of any
  -- folder, then file it in a fresh folder created by U. (All rolled back.)
  perform set_config('request.jwt.claims', '', true);
  delete from public.board_members where board_id = v_board and user_id = v_other;
  delete from public.folder_boards where board_id = v_board;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-' || gen_random_uuid()::text, v_owner)
  returning id into v_folder;
  insert into public.folder_boards (folder_id, board_id, position) values (v_folder, v_board, 0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);

  r := r || jsonb_build_object('01_no_access_before', not public.can_read_board(v_board));

  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_folder, v_org, v_other, 'viewer', v_owner);
  r := r || jsonb_build_object(
    '02_viewer_can_read', public.can_read_board(v_board),
    '03_viewer_cannot_edit', not public.can_edit_board(v_board),
    '04_in_readable_ids', exists (select 1 from public.readable_board_ids() x where x = v_board),
    '05_is_board_member', public.is_board_member(v_board),
    '06_level_rpc_viewer', coalesce((select access_level = 'viewer'
                              from public.my_folder_board_levels(array[v_board])), false)
  );

  -- RLS path, as the authenticated role: V reads the board's items. The
  -- fixture board must actually have items or the check proves nothing.
  select count(*) into v_m from public.items where board_id = v_board;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.items where board_id = v_board;
  perform set_config('role', 'none', true);
  r := r || jsonb_build_object('07_rls_items_visible', v_m > 0 and v_n = v_m);

  update public.folder_members set access_level = 'editor'
   where folder_id = v_folder and user_id = v_other;
  r := r || jsonb_build_object('08_editor_can_edit', public.can_edit_board(v_board));

  -- Higher-of rule: a direct viewer grant on top of the folder editor grant.
  perform set_config('request.jwt.claims', '', true);
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, v_board, v_other, 'viewer', v_owner);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  r := r || jsonb_build_object('26_direct_viewer_plus_folder_editor_can_edit',
                               public.can_edit_board(v_board));
  perform set_config('request.jwt.claims', '', true);
  delete from public.board_members where board_id = v_board and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);

  -- V is not the folder's creator and not an admin: cannot manage.
  v_raised := false;
  begin
    perform public.share_folder(v_folder, v_owner, 'viewer');
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object(
    '09_non_manager_cannot_share', v_raised,
    '10_non_manager_flag', not public.can_manage_folder(v_folder)
  );

  -- created_by is what can_manage_folder keys on: a member must not be able
  -- to rewrite it and then share the folder with themselves.
  v_raised := false;
  begin
    update public.folders set created_by = v_other where id = v_folder;
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object(
    '27_created_by_takeover_refused', v_raised,
    '27b_created_by_unchanged', exists (
      select 1 from public.folders where id = v_folder and created_by = v_owner)
  );

  -- V is not the board's creator: cannot take it out of a shared folder.
  v_raised := false;
  begin
    delete from public.folder_boards where board_id = v_board;
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object('11_non_owner_cannot_unfile_shared', v_raised);

  -- A reorder inside the folder is not a move.
  v_raised := false;
  begin
    update public.folder_boards set position = 5 where board_id = v_board;
  exception when insufficient_privilege then v_raised := true;
  end;
  r := r || jsonb_build_object('12_reorder_allowed', not v_raised);

  -- Re-pointing a placement at another board must be refused.
  if v_board2 is not null then
    v_raised := false;
    begin
      update public.folder_boards set board_id = v_board2 where board_id = v_board;
    exception when insufficient_privilege then v_raised := true;
    end;
    r := r || jsonb_build_object(
      '28_board_id_swap_refused', v_raised,
      '28b_placement_unchanged', exists (
        select 1 from public.folder_boards where folder_id = v_folder and board_id = v_board)
    );
  else
    r := r || jsonb_build_object('28_board_id_swap_refused', false);
    nt := nt || jsonb_build_object('28_board_id_swap_refused', 'fixture missing');
  end if;

  -- Deactivated org member with the folder row still present: no access.
  perform set_config('request.jwt.claims', '', true);
  update public.org_members set deactivated_at = now()
   where org_id = v_org and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  r := r || jsonb_build_object('13_deactivated_loses_access', not public.can_read_board(v_board));
  perform set_config('request.jwt.claims', '', true);
  update public.org_members set deactivated_at = null
   where org_id = v_org and user_id = v_other;

  -- Guest: sees the folder only as a member of it.
  update public.org_members set role = 'guest' where org_id = v_org and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  r := r || jsonb_build_object('14_guest_member_sees_folder', public.can_see_folder(v_folder));
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.folders where org_id = v_org;
  perform set_config('role', 'none', true);
  select count(*) into v_m from public.folder_members fm
   where fm.user_id = v_other and fm.org_id = v_org;
  r := r || jsonb_build_object('15_guest_rls_only_their_folders', v_n = v_m);
  -- The gallery RPC is security definer, so it needs its own check.
  select count(*) into v_n from public.folder_gallery(v_ws);
  r := r || jsonb_build_object('25_guest_gallery_only_their_folders', v_n = 1);

  v_raised := false;
  begin
    perform count(*) from public.folder_rollup(v_folder);
  exception when others then v_raised := true;
  end;
  r := r || jsonb_build_object('16_guest_member_can_rollup', not v_raised);

  -- Removed from the folder: nothing left.
  perform set_config('request.jwt.claims', '', true);
  delete from public.folder_members where folder_id = v_folder and user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_raised := false;
  begin
    perform count(*) from public.folder_rollup(v_folder);
  exception when others then v_raised := true;
  end;
  r := r || jsonb_build_object(
    '17_removed_loses_access', not public.can_read_board(v_board),
    '18_guest_non_member_cannot_see', not public.can_see_folder(v_folder),
    '19_guest_non_member_rollup_refused', v_raised
  );

  -- A guest who reaches the board through a direct grant, but is not in the
  -- folder, must learn nothing about the folder from board_folder_grants.
  -- The folder has another member, so the result would be non-empty without
  -- the can_see_folder predicate.
  perform set_config('request.jwt.claims', '', true);
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, v_board, v_other, 'viewer', v_owner);
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_folder, v_org, v_owner, 'viewer', v_owner);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  select count(*) into v_n from public.board_folder_grants(v_board);
  r := r || jsonb_build_object(
    '29_guest_board_read_ok', public.can_read_board(v_board),
    '29b_guest_non_member_gets_no_grants', v_n = 0 and exists (
      select 1 from public.folder_members where folder_id = v_folder)
  );
  perform set_config('request.jwt.claims', '', true);
  delete from public.board_members where board_id = v_board and user_id = v_other;
  delete from public.folder_members where folder_id = v_folder and user_id = v_owner;
  update public.org_members set role = 'member' where org_id = v_org and user_id = v_other;

  -- Pending invitation grants nothing; the creator can invite; revoke clears both rows.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  r := r || jsonb_build_object(
    '20_creator_can_manage', public.can_manage_folder(v_folder),
    '21_invite_unknown_email_returns_null',
      public.invite_to_folder(v_folder, 'matrix-' || gen_random_uuid()::text || '@example.com', 'viewer') is null
  );
  select count(*) into v_n from public.folder_invitations where folder_id = v_folder and status = 'pending';
  select count(*) into v_m from public.folder_members where folder_id = v_folder;
  r := r || jsonb_build_object('22_pending_invite_grants_nothing', v_n = 1 and v_m = 0);
  perform public.revoke_folder_invitation(
    (select id from public.folder_invitations where folder_id = v_folder and status = 'pending'));
  select count(*) into v_n from public.org_invitations oi
   where oi.org_id = v_org and oi.status = 'pending' and oi.email like 'matrix-%@example.com';
  r := r || jsonb_build_object('23_revoke_clears_guest_org_invite', v_n = 0);

  -- Revoking a folder invitation must leave an org invitation it did not
  -- create (here: a pre-existing guest invitation made by an admin) pending.
  v_email := 'matrix-' || gen_random_uuid()::text || '@example.com';
  perform set_config('request.jwt.claims', '', true);
  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, v_email, 'guest', v_owner)
  returning id into v_org_inv;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.invite_to_folder(v_folder, v_email, 'viewer');
  perform public.revoke_folder_invitation(
    (select id from public.folder_invitations
      where folder_id = v_folder and lower(email) = v_email and status = 'pending'));
  r := r || jsonb_build_object('30_revoke_keeps_foreign_org_invite',
    exists (select 1 from public.org_invitations where id = v_org_inv and status = 'pending'));

  -- Two folders invite the same new email (the second finds the guest org
  -- invitation the first created). Revoking the first must keep both the org
  -- invitation and the second folder invitation; revoking the second ends it.
  perform set_config('request.jwt.claims', '', true);
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-' || gen_random_uuid()::text, v_owner)
  returning id into v_folder2;
  v_email := 'matrix-' || gen_random_uuid()::text || '@example.com';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.invite_to_folder(v_folder, v_email, 'viewer');
  perform public.invite_to_folder(v_folder2, v_email, 'viewer');
  perform public.revoke_folder_invitation(
    (select id from public.folder_invitations
      where folder_id = v_folder and lower(email) = v_email and status = 'pending'));
  r := r || jsonb_build_object(
    '30b_first_revoke_keeps_org_invite', exists (
      select 1 from public.org_invitations
       where org_id = v_org and lower(email) = v_email and status = 'pending'),
    '30c_first_revoke_keeps_second_folder_invite', exists (
      select 1 from public.folder_invitations
       where folder_id = v_folder2 and lower(email) = v_email and status = 'pending')
  );
  perform public.revoke_folder_invitation(
    (select id from public.folder_invitations
      where folder_id = v_folder2 and lower(email) = v_email and status = 'pending'));
  r := r || jsonb_build_object('30d_last_revoke_revokes_org_invite', not exists (
    select 1 from public.org_invitations
     where org_id = v_org and lower(email) = v_email and status = 'pending'));

  -- Redemption: accepting the org invitation turns the pending folder
  -- invitation into a folder_members row.
  perform set_config('request.jwt.claims', '', true);
  select lower(u.email::text) into v_email from auth.users u where u.id = v_other;
  delete from public.org_invitations
   where org_id = v_org and lower(email) = v_email and status = 'pending';
  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, v_email, 'member', v_owner)
  returning id into v_org_inv;
  insert into public.folder_invitations (folder_id, org_id, email, access_level, invited_by)
  values (v_folder, v_org, v_email, 'viewer', v_owner);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  perform public.accept_invitation(v_org_inv);
  r := r || jsonb_build_object('31_accept_invitation_redeems_folder_invite', exists (
    select 1 from public.folder_members
     where folder_id = v_folder and user_id = v_other and access_level = 'viewer'));
  perform set_config('request.jwt.claims', '', true);
  delete from public.folder_members where folder_id = v_folder and user_id = v_other;

  -- Cascade and delete rights. A shared folder created by V holds a board V
  -- did not create. A non-manager member cannot delete it (RLS); its manager
  -- can, and the move guard must not fire on the cascade (trigger depth > 1).
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-' || gen_random_uuid()::text, v_other)
  returning id into v_tmp_folder;
  delete from public.folder_boards where board_id = v_board;
  insert into public.folder_boards (folder_id, board_id, position) values (v_tmp_folder, v_board, 0);
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_tmp_folder, v_org, v_owner, 'viewer', v_other);

  if v_third is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_third)::text, true);
    perform set_config('role', 'authenticated', true);
    v_raised := false; v_n := -1;
    begin
      delete from public.folders where id = v_tmp_folder;
      get diagnostics v_n = row_count;
    exception when others then v_raised := true;
    end;
    perform set_config('role', 'none', true);
    r := r || jsonb_build_object(
      '24a_non_manager_delete_refused',
        (v_raised or v_n = 0)
        and exists (select 1 from public.folders where id = v_tmp_folder)
    );
  else
    r := r || jsonb_build_object('24a_non_manager_delete_refused', false);
    nt := nt || jsonb_build_object('24a_non_manager_delete_refused', 'fixture missing');
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  perform set_config('role', 'authenticated', true);
  v_raised := false; v_n := -1;
  begin
    delete from public.folders where id = v_tmp_folder;
    get diagnostics v_n = row_count;
  exception when others then v_raised := true;
  end;
  perform set_config('role', 'none', true);
  r := r || jsonb_build_object(
    '24_manager_delete_cascades',
      not v_raised and v_n = 1
      and not exists (select 1 from public.folders where id = v_tmp_folder)
  );

  -- Timings for the stop condition (best of 3, milliseconds).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform set_config('role', 'authenticated', true);
  v_best := null;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select count(*) from public.items where board_id = %L', v_board) into v_plan;
    v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
  end loop;
  r := r || jsonb_build_object('t_items_ms', v_best);
  perform set_config('role', 'none', true);

  v_tmp_folder := null; v_best := null;
  select fb.folder_id into v_tmp_folder
    from public.folder_boards fb group by fb.folder_id order by count(*) desc limit 1;
  if v_tmp_folder is not null then
    select b.created_by into v_owner
      from public.folder_boards fb join public.boards b on b.id = fb.board_id
     where fb.folder_id = v_tmp_folder limit 1;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_rollup(%L)', v_tmp_folder) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
  end if;
  r := r || jsonb_build_object('t_folder_rollup_ms', v_best);

  insert into matrix_results select key, value, nt ->> key from jsonb_each(r);
end
$matrix$;

-- Guest confinement checks (migration B). Own fixtures, all inside this
-- transaction. Two existing boards of one org: b1 (the guest gets a direct
-- viewer grant) and b2 (the guest has no access). Run after the migrations.
do $guest$
declare
  v_org uuid; v_ws uuid; v_o uuid; v_g uuid; v_b1 uuid; v_b2 uuid;
  v_i1 uuid; v_i2 uuid; v_dash uuid; v_goal uuid; v_pf uuid;
  v_old int; v_new int; v_cnt int; v_ok1 boolean; v_ok2 boolean; v_ok3 boolean; v_ok4 boolean; v_own int; v_others int;
  v_raised boolean; v_msg text;
  v_names text[] := array[
    'g1_rollup_guest_only_own_rows', 'g2_create_widget_refused', 'g3_set_layouts_refused',
    'g4_guest_owned_goal_not_editable', 'g5_guest_cannot_read_goal_links',
    'g6_guest_cannot_insert_goal_links', 'g7_guest_created_portfolio_not_editable',
    'g8_guest_logs_time_on_readable_board', 'g9_guest_refused_time_on_unreadable_board',
    'g10_member_dashboard_count_unchanged'];
  n text;
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);

  select b1.org_id, b1.workspace_id, b1.created_by, b1.id, b2.id, i1.id, i2.id
    into v_org, v_ws, v_o, v_b1, v_b2, v_i1, v_i2
  from public.boards b1
  join public.org_members oc on oc.org_id = b1.org_id and oc.user_id = b1.created_by
   and oc.deactivated_at is null and oc.role in ('owner', 'admin', 'member')
  join public.boards b2 on b2.org_id = b1.org_id and b2.id <> b1.id and b2.archived_at is null
  join lateral (select id from public.items where board_id = b1.id limit 1) i1 on true
  join lateral (select id from public.items where board_id = b2.id limit 1) i2 on true
  where b1.archived_at is null and b2.created_by <> b1.created_by
  limit 1;

  if v_b1 is not null then
    select om.user_id into v_g from public.org_members om
     where om.org_id = v_org and om.role = 'member' and om.deactivated_at is null
       and om.user_id not in (select created_by from public.boards where id in (v_b1, v_b2))
     limit 1;
  end if;

  if v_g is null then
    foreach n in array v_names loop
      insert into matrix_results values (n, 'false'::jsonb, 'fixture missing');
    end loop;
    return;
  end if;

  -- The guest starts with no access to either board, then gets b1 directly.
  delete from public.board_members where user_id = v_g and board_id in (v_b1, v_b2);
  delete from public.folder_members fm
   where fm.user_id = v_g
     and fm.folder_id in (select folder_id from public.folder_boards where board_id in (v_b1, v_b2));
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, v_b1, v_g, 'viewer', v_o);

  -- Org-wide fixtures, created as postgres (no JWT, so the insert trigger is idle).
  insert into public.dashboards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-dash', v_o) returning id into v_dash;
  insert into public.goals (org_id, name, owner_id, progress_mode, created_by)
  values (v_org, 'matrix-goal', v_g, (enum_range(null::public.goal_progress_mode))[1], v_o)
  returning id into v_goal;
  insert into public.goal_links (org_id, goal_id, board_id) values (v_org, v_goal, v_b1);
  insert into public.portfolios (org_id, name, created_by)
  values (v_org, 'matrix-portfolio', v_g) returning id into v_pf;
  insert into public.time_allocations (org_id, user_id, board_id, item_id, work_date, duration_secs)
  values (v_org, v_o, v_b1, v_i1, current_date, 600);

  -- Regular member: dashboards read the same set as under the old predicate.
  perform set_config('request.jwt.claims', json_build_object('sub', v_o)::text, true);
  select count(*) into v_old from public.dashboards
   where org_id in (select public.auth_user_orgs());
  perform set_config('role', 'authenticated', true);
  select count(*) into v_new from public.dashboards;
  perform set_config('role', 'none', true);
  insert into matrix_results values ('g10_member_dashboard_count_unchanged',
    to_jsonb(v_old > 0 and v_new = v_old), null);

  -- From here on v_g is a guest.
  perform set_config('request.jwt.claims', '', true);
  update public.org_members set role = 'guest' where org_id = v_org and user_id = v_g;
  perform set_config('request.jwt.claims', json_build_object('sub', v_g)::text, true);

  -- Time logging: own row on a readable board works, an unreadable one is
  -- refused. Results go into variables; the temp table is only written as
  -- postgres (role none).
  perform set_config('role', 'authenticated', true);
  v_raised := false;
  begin
    insert into public.time_allocations (org_id, user_id, board_id, item_id, work_date, duration_secs)
    values (v_org, v_g, v_b1, v_i1, current_date, 300);
  exception when others then v_raised := true;
  end;
  v_ok1 := not v_raised;
  v_raised := false;
  begin
    insert into public.time_allocations (org_id, user_id, board_id, item_id, work_date, duration_secs)
    values (v_org, v_g, v_b2, v_i2, current_date, 300);
  exception when insufficient_privilege then v_raised := true;
  end;
  v_ok2 := v_raised;
  -- Goal links: not readable, not writable for a guest who owns the goal.
  select count(*) into v_cnt from public.goal_links where goal_id = v_goal;
  v_ok3 := v_cnt = 0;
  v_raised := false;
  begin
    insert into public.goal_links (org_id, goal_id, board_id) values (v_org, v_goal, v_b2);
  exception when insufficient_privilege then v_raised := true;
  end;
  v_ok4 := v_raised;
  perform set_config('role', 'none', true);

  insert into matrix_results values
    ('g8_guest_logs_time_on_readable_board', to_jsonb(v_ok1 and public.can_read_board(v_b1)), null),
    ('g9_guest_refused_time_on_unreadable_board', to_jsonb(v_ok2 and not public.can_read_board(v_b2)), null),
    ('g5_guest_cannot_read_goal_links', to_jsonb(v_ok3), null),
    ('g6_guest_cannot_insert_goal_links', to_jsonb(v_ok4), null),
    ('g4_guest_owned_goal_not_editable', to_jsonb(not public.can_edit_goal(v_goal)), null),
    ('g7_guest_created_portfolio_not_editable', to_jsonb(not public.can_edit_portfolio(v_pf)), null);

  -- Dashboard RPCs refuse a guest, with the guest message.
  v_raised := false;
  begin
    perform public.create_dashboard_widget(v_dash, (enum_range(null::public.widget_kind))[1], null);
  exception when insufficient_privilege then v_raised := sqlerrm like 'guests cannot change dashboards%';
  end;
  insert into matrix_results values ('g2_create_widget_refused', to_jsonb(v_raised), null);
  v_raised := false;
  begin
    perform public.set_widget_layouts(v_dash, '[]'::jsonb);
  exception when insufficient_privilege then v_raised := sqlerrm like 'guests cannot change dashboards%';
  end;
  insert into matrix_results values ('g3_set_layouts_refused', to_jsonb(v_raised), null);

  -- Workload actuals: the guest gets their own rows only (the owner's row on
  -- the same readable board must not appear).
  select count(*) filter (where user_id = v_g), count(*) filter (where user_id <> v_g)
    into v_own, v_others
  from public.workload_actuals_rollup(current_date, current_date);
  insert into matrix_results values ('g1_rollup_guest_only_own_rows',
    to_jsonb(v_own >= 1 and v_others = 0), null);

  perform set_config('request.jwt.claims', '', true);
end
$guest$;

insert into matrix_results (name, value)
select 'ALL_PASSED', to_jsonb(not exists (
  select 1 from matrix_results m
   where m.name !~ '^t_' and m.value is distinct from 'true'::jsonb));

-- Report through the exception message; raising aborts and rolls back the
-- implicit transaction, so nothing above persists.
do $report$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_object_agg(name, jsonb_build_object('value', value, 'note', note)), '{}'::jsonb)
    into v_out
  from matrix_results;
  raise exception 'ACCESS_MATRIX %', v_out::text;
end
$report$;
