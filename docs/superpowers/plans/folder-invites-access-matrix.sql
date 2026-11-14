-- Folder invites access matrix. Run AFTER the migration SQL in the same
-- execute_sql call. Ends with RAISE EXCEPTION on purpose: the whole call,
-- migration included, rolls back. Output: 'ACCESS_MATRIX {json}'.
do $matrix$
declare
  v_org uuid; v_owner uuid; v_other uuid; v_board uuid; v_ws uuid;
  v_folder uuid; v_tmp_folder uuid; v_tmp_board uuid;
  r jsonb := '{}'::jsonb;
  v_bool boolean; v_raised boolean; v_n int; v_m int;
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
    raise exception 'ACCESS_MATRIX {"fixture":"NO_FIXTURE"}';
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
    '06_level_rpc_viewer', (select access_level = 'viewer'
                              from public.my_folder_board_levels(array[v_board]))
  );

  -- RLS path, as the authenticated role: V reads the board's items.
  select count(*) into v_m from public.items where board_id = v_board;
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.items where board_id = v_board;
  perform set_config('role', 'none', true);
  r := r || jsonb_build_object('07_rls_items_visible', v_n = v_m);

  update public.folder_members set access_level = 'editor'
   where folder_id = v_folder and user_id = v_other;
  r := r || jsonb_build_object('08_editor_can_edit', public.can_edit_board(v_board));

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
  perform set_config('request.jwt.claims', '', true);
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

  -- Cascade: the creator deletes a shared folder holding a board that is not
  -- theirs. The move guard must not fire on the cascade (pg_trigger_depth > 1).
  perform set_config('request.jwt.claims', '', true);
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'matrix-' || gen_random_uuid()::text, v_other)
  returning id into v_tmp_folder;
  delete from public.folder_boards where board_id = v_board;
  insert into public.folder_boards (folder_id, board_id, position) values (v_tmp_folder, v_board, 0);
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_tmp_folder, v_org, v_owner, 'viewer', v_other);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_raised := false;
  begin
    delete from public.folders where id = v_tmp_folder;
  exception when others then v_raised := true;
  end;
  r := r || jsonb_build_object('24_shared_folder_delete_cascades', not v_raised);

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

  select fb.folder_id into v_tmp_folder
    from public.folder_boards fb group by fb.folder_id order by count(*) desc limit 1;
  select b.created_by into v_owner
    from public.folder_boards fb join public.boards b on b.id = fb.board_id
   where fb.folder_id = v_tmp_folder limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_best := null;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select count(*) from public.folder_rollup(%L)', v_tmp_folder) into v_plan;
    v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
    if v_best is null or v_ms < v_best then v_best := v_ms; end if;
  end loop;
  r := r || jsonb_build_object('t_folder_rollup_ms', v_best);

  raise exception 'ACCESS_MATRIX %', r::text;
end
$matrix$;
