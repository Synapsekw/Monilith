-- Folder share guard dry run. Run AFTER the text of the migration
-- supabase/migrations/20261115173604_folder_share_guard.sql, in the same
-- execute_sql call. There is deliberately no explicit BEGIN/COMMIT/ROLLBACK:
-- the whole call is one implicit transaction and this script ENDS BY RAISING
-- AN EXCEPTION, so Postgres rolls back everything the migration and the script
-- did. The results travel in that exception's message:
--   FOLDER_SHARE_GUARD {"01_...": true, ..., "ALL_PASSED": true}
-- An error that does not start with FOLDER_SHARE_GUARD means something failed
-- earlier; it rolls back too. A check passes when its value is true; a check
-- that hit an unexpected error is a string "ERR <sqlstate> <message>".
-- "fixture": "NO_FIXTURE" means no org has an active owner/admin, a workspace
-- and three other usable people. Prints check names and booleans only, never
-- ids, names or emails.
--
-- It builds its own fixtures in an existing org: boards, folders, grants and
-- invitations (and, only if the org has fewer than three plain members, org
-- memberships for existing approved accounts). People:
--   ADM  an active org owner or admin
--   ATT  a plain member: the folder creator in every case
--   BC   a plain member: creator of the boards ATT does not own
--   TGT  a plain member: the person access is given to
-- Users are impersonated the way PostgREST does it: request.jwt.claims for
-- auth.uid(), plus role authenticated wherever a table is written under RLS.

do $dry$
declare
  r jsonb := '{}'::jsonb;
  v_org uuid; v_ws uuid;
  v_adm uuid; v_att uuid; v_bc uuid; v_tgt uuid; v_tgt_email text;
  c_adm text; c_att text; c_bc text;
  v_plain uuid[];
  -- boards
  b_esc uuid; b_pre uuid; b_move uuid; b_red_block uuid; b_red_later uuid;  -- by BC
  b_own uuid; b_red_own uuid;                                              -- by ATT
  -- folders, all created by ATT
  f_esc uuid; f_pre uuid; f_own uuid; f_pend uuid;
  f_red_block uuid; f_red_own uuid; f_red_later uuid;
  v_mail_a text := 'fsg-dry-' || gen_random_uuid()::text || '@example.com';
  v_mail_b text := 'fsg-dry-' || gen_random_uuid()::text || '@example.com';
  v_mail_c text := 'fsg-dry-' || gen_random_uuid()::text || '@example.com';
  v_code text; v_msg text; v_ret uuid; v_ok boolean;
  v_level public.board_access;
  v_all boolean;
begin
  -- ─────────────────────────────────────────────────────────── fixtures
  perform set_config('request.jwt.claims', '', true);

  select om.org_id, om.user_id into v_org, v_adm
    from public.org_members om
   where om.role in ('owner', 'admin') and om.deactivated_at is null
     and exists (select 1 from public.workspaces w where w.org_id = om.org_id)
   order by (select count(*) from public.org_members p
              where p.org_id = om.org_id and p.role = 'member'
                and p.deactivated_at is null) desc,
            (om.role = 'owner') desc
   limit 1;
  if v_org is null then
    raise exception 'FOLDER_SHARE_GUARD %',
      '{"fixture": "NO_FIXTURE", "ALL_PASSED": false}';
  end if;
  select w.id into v_ws from public.workspaces w where w.org_id = v_org order by w.id limit 1;

  select coalesce(array_agg(x.user_id), '{}') into v_plain from (
    select om.user_id from public.org_members om
      join auth.users u on u.id = om.user_id
     where om.org_id = v_org and om.role = 'member' and om.deactivated_at is null
       and om.user_id <> v_adm and u.email is not null
     order by om.user_id limit 3
  ) x;
  -- Short of three plain members: add existing approved accounts (never a
  -- Mono, never someone already in the org). Rolled back with everything else.
  while coalesce(array_length(v_plain, 1), 0) < 3 loop
    v_ret := null;
    begin
      insert into public.org_members (org_id, user_id, role)
      select v_org, u.id, 'member'
        from auth.users u
        join public.account_approvals a on a.user_id = u.id and a.status = 'approved'
       where u.email is not null
         and not exists (select 1 from public.org_members x
                          where x.user_id = u.id and (x.org_id = v_org or x.role = 'agent'))
       order by u.id limit 1
      returning user_id into v_ret;
    exception when others then v_ret := null;
    end;
    exit when v_ret is null;
    v_plain := v_plain || v_ret;
  end loop;
  if coalesce(array_length(v_plain, 1), 0) < 3 then
    raise exception 'FOLDER_SHARE_GUARD %',
      '{"fixture": "NO_FIXTURE", "ALL_PASSED": false}';
  end if;
  v_att := v_plain[1]; v_bc := v_plain[2]; v_tgt := v_plain[3];
  select lower(u.email::text) into v_tgt_email from auth.users u where u.id = v_tgt;
  c_adm := json_build_object('sub', v_adm, 'role', 'authenticated')::text;
  c_att := json_build_object('sub', v_att, 'role', 'authenticated')::text;
  c_bc  := json_build_object('sub', v_bc,  'role', 'authenticated')::text;

  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry esc', v_bc) returning id into b_esc;
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry pre', v_bc) returning id into b_pre;
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry move', v_bc) returning id into b_move;
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry red-block', v_bc) returning id into b_red_block;
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry red-later', v_bc) returning id into b_red_later;
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry own', v_att) returning id into b_own;
  insert into public.boards (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry red-own', v_att) returning id into b_red_own;

  -- ATT can only VIEW the two boards they will try to file.
  delete from public.board_members
   where user_id = v_att and board_id in (b_esc, b_pre, b_move, b_red_block, b_red_later);
  insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
  values (v_org, b_esc, v_att, 'viewer', v_bc), (v_org, b_move, v_att, 'viewer', v_bc);

  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry esc ' || gen_random_uuid()::text, v_att) returning id into f_esc;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry pre ' || gen_random_uuid()::text, v_att) returning id into f_pre;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry own ' || gen_random_uuid()::text, v_att) returning id into f_own;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry pend ' || gen_random_uuid()::text, v_att) returning id into f_pend;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry red-block ' || gen_random_uuid()::text, v_att) returning id into f_red_block;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry red-own ' || gen_random_uuid()::text, v_att) returning id into f_red_own;
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'fsg-dry red-later ' || gen_random_uuid()::text, v_att) returning id into f_red_later;
  -- A folder trigger may add its creator as a member; these cases start empty.
  delete from public.folder_members
   where folder_id in (f_esc, f_pre, f_own, f_pend, f_red_block, f_red_own, f_red_later);
  -- TGT starts with nothing on the fixture boards.
  delete from public.board_members
   where user_id = v_tgt
     and board_id in (b_esc, b_pre, b_move, b_red_block, b_red_later, b_own, b_red_own);

  -- ───────────────── A. the escalation: view-only -> own folder -> editor
  perform set_config('request.jwt.claims', c_att, true);
  r := r || jsonb_build_object(
    'A01_att_reads_board_but_cannot_edit',
    public.can_read_board(b_esc) and not public.can_edit_board(b_esc));

  -- Filing a board one can only read into an unshared folder is still allowed
  -- (RLS path, as the authenticated role).
  begin
    perform set_config('role', 'authenticated', true);
    insert into public.folder_boards (folder_id, board_id, position) values (f_esc, b_esc, 0);
    perform set_config('role', 'none', true);
    r := r || jsonb_build_object('A02_att_files_viewed_board_in_own_unshared_folder', true);
  exception when others then
    r := r || jsonb_build_object('A02_att_files_viewed_board_in_own_unshared_folder',
                                 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('role', 'none', true);

  v_code := null; v_msg := null;
  begin
    perform public.share_folder(f_esc, v_att, 'editor');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  r := r || jsonb_build_object('A03_share_self_as_editor_refused',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder: 1 of its boards%', false));

  v_code := null; v_msg := null;
  begin
    perform public.share_folder(f_esc, v_tgt, 'viewer');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  r := r || jsonb_build_object('A04_share_someone_else_as_viewer_refused',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder:%', false));

  v_code := null; v_msg := null;
  begin
    perform public.invite_to_folder(f_esc, v_mail_a, 'editor');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  r := r || jsonb_build_object('A05_invite_outside_email_refused',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder:%', false));

  -- The direct-share branch of invite_to_folder (the email is an org member).
  v_code := null; v_msg := null;
  begin
    perform public.invite_to_folder(f_esc, v_tgt_email, 'viewer');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  r := r || jsonb_build_object('A06_invite_org_member_email_refused',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder:%', false));

  r := r || jsonb_build_object('A07_att_still_cannot_edit', not public.can_edit_board(b_esc));
  perform set_config('request.jwt.claims', '', true);
  r := r || jsonb_build_object('A08_nothing_was_written',
    not exists (select 1 from public.folder_members where folder_id = f_esc)
    and not exists (select 1 from public.folder_invitations where folder_id = f_esc)
    and not exists (select 1 from public.org_invitations
                     where org_id = v_org and lower(email) = v_mail_a));

  -- ───── B. folder creator who is not the board's creator (cannot even open it)
  insert into public.folder_boards (folder_id, board_id, position) values (f_pre, b_pre, 0);
  perform set_config('request.jwt.claims', c_att, true);
  r := r || jsonb_build_object('B01_att_manages_folder_but_cannot_read_board',
    public.can_manage_folder(f_pre) and not public.can_read_board(b_pre));
  v_code := null; v_msg := null;
  begin
    perform public.share_folder(f_pre, v_tgt, 'viewer');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  r := r || jsonb_build_object('B02_folder_creator_not_board_creator_refused',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder: 1 of its boards%', false));

  -- ───────────────────────────────────────────── C. an org admin may share
  perform set_config('request.jwt.claims', c_adm, true);
  begin
    perform public.share_folder(f_pre, v_tgt, 'viewer');
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('C01_org_admin_shares', exists (
      select 1 from public.folder_members
       where folder_id = f_pre and user_id = v_tgt and access_level = 'viewer'));
  exception when others then
    r := r || jsonb_build_object('C01_org_admin_shares', 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ─────────────────────────── D. raising refused, lowering and removing allowed
  perform set_config('request.jwt.claims', c_att, true);
  v_code := null; v_msg := null;
  begin
    perform public.share_folder(f_pre, v_tgt, 'editor');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  select access_level into v_level from public.folder_members
   where folder_id = f_pre and user_id = v_tgt;
  r := r || jsonb_build_object('D01_raise_by_folder_creator_refused_level_unchanged',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder:%'
             and v_level = 'viewer', false));

  perform set_config('request.jwt.claims', c_adm, true);
  begin
    perform public.share_folder(f_pre, v_tgt, 'editor');
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('D02_raise_by_org_admin_allowed', exists (
      select 1 from public.folder_members
       where folder_id = f_pre and user_id = v_tgt and access_level = 'editor'));
  exception when others then
    r := r || jsonb_build_object('D02_raise_by_org_admin_allowed', 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  perform set_config('request.jwt.claims', c_att, true);
  begin
    perform public.share_folder(f_pre, v_tgt, 'viewer');
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('D03_lower_by_folder_creator_allowed', exists (
      select 1 from public.folder_members
       where folder_id = f_pre and user_id = v_tgt and access_level = 'viewer'));
  exception when others then
    r := r || jsonb_build_object('D03_lower_by_folder_creator_allowed', 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  perform set_config('request.jwt.claims', c_att, true);
  begin
    perform public.unshare_folder(f_pre, v_tgt);
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('D04_remove_by_folder_creator_allowed', not exists (
      select 1 from public.folder_members where folder_id = f_pre and user_id = v_tgt));
  exception when others then
    r := r || jsonb_build_object('D04_remove_by_folder_creator_allowed', 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ───────────── E. board creator who is also the folder creator may share
  perform set_config('request.jwt.claims', c_att, true);
  begin
    perform set_config('role', 'authenticated', true);
    insert into public.folder_boards (folder_id, board_id, position) values (f_own, b_own, 0);
    perform set_config('role', 'none', true);
    perform public.share_folder(f_own, v_tgt, 'editor');
    v_ret := public.invite_to_folder(f_own, v_mail_b, 'viewer');
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object(
      'E01_owner_of_every_board_shares', exists (
        select 1 from public.folder_members
         where folder_id = f_own and user_id = v_tgt and access_level = 'editor'),
      'E02_owner_of_every_board_invites', v_ret is null and exists (
        select 1 from public.folder_invitations
         where folder_id = f_own and lower(email) = v_mail_b and status = 'pending'
           and access_level = 'viewer' and invited_by = v_att));
  exception when others then
    r := r || jsonb_build_object('E01_owner_of_every_board_shares',
                                 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('role', 'none', true);

  -- ─────── F. a folder with only a PENDING invitation guards board moves
  perform set_config('request.jwt.claims', c_att, true);
  begin
    v_ret := public.invite_to_folder(f_pend, v_mail_c, 'editor');
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('F01_empty_folder_invite_recorded_no_members',
      exists (select 1 from public.folder_invitations
               where folder_id = f_pend and status = 'pending')
      and not exists (select 1 from public.folder_members where folder_id = f_pend));
  exception when others then
    r := r || jsonb_build_object('F01_empty_folder_invite_recorded_no_members',
                                 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  perform set_config('request.jwt.claims', c_att, true);
  v_code := null; v_msg := null;
  begin
    perform set_config('role', 'authenticated', true);
    insert into public.folder_boards (folder_id, board_id, position) values (f_pend, b_move, 0);
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  r := r || jsonb_build_object('F02_viewer_cannot_file_board_in_pending_invite_folder',
    coalesce(v_code = '42501' and v_msg like 'only the board owner or an admin%', false)
    and not exists (select 1 from public.folder_boards where board_id = b_move));

  perform set_config('request.jwt.claims', c_bc, true);
  begin
    perform set_config('role', 'authenticated', true);
    insert into public.folder_boards (folder_id, board_id, position) values (f_pend, b_move, 0);
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('F03_board_creator_files_board_in_pending_invite_folder',
      exists (select 1 from public.folder_boards
               where board_id = b_move and folder_id = f_pend));
  exception when others then
    r := r || jsonb_build_object('F03_board_creator_files_board_in_pending_invite_folder',
                                 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('role', 'none', true);

  -- ATT cannot raise or re-issue the pending invitation now that the folder
  -- holds a board that is not theirs, but can still lower it.
  perform set_config('request.jwt.claims', '', true);
  update public.folder_invitations set access_level = 'viewer'
   where folder_id = f_pend and lower(email) = v_mail_c and status = 'pending';
  perform set_config('request.jwt.claims', c_att, true);
  v_code := null; v_msg := null;
  begin
    perform public.invite_to_folder(f_pend, v_mail_c, 'editor');
  exception when others then v_code := sqlstate; v_msg := sqlerrm;
  end;
  r := r || jsonb_build_object('F04_raising_a_pending_invitation_refused',
    coalesce(v_code = '42501' and v_msg like 'cannot share this folder:%', false));
  perform set_config('request.jwt.claims', '', true);
  update public.folder_invitations set access_level = 'editor'
   where folder_id = f_pend and lower(email) = v_mail_c and status = 'pending';
  perform set_config('request.jwt.claims', c_att, true);
  begin
    perform public.invite_to_folder(f_pend, v_mail_c, 'viewer');
    perform set_config('request.jwt.claims', '', true);
    r := r || jsonb_build_object('F05_lowering_a_pending_invitation_allowed', exists (
      select 1 from public.folder_invitations
       where folder_id = f_pend and lower(email) = v_mail_c and status = 'pending'
         and access_level = 'viewer'));
  exception when others then
    r := r || jsonb_build_object('F05_lowering_a_pending_invitation_allowed',
                                 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ───────────────────────────────── G. redemption re-checks the inviter
  -- Invitations written directly (as a pre-migration row would be) for TGT's
  -- own address, then redeemed for TGT. now() is fixed for the transaction, so
  -- "filed after the invitation" is made by back-dating the invitation.
  perform set_config('request.jwt.claims', '', true);
  delete from public.folder_members where user_id = v_tgt
     and folder_id in (f_red_block, f_red_own, f_red_later);
  insert into public.folder_boards (folder_id, board_id, position) values
    (f_red_block, b_red_block, 0), (f_red_own, b_red_own, 0), (f_red_later, b_red_later, 0);
  insert into public.folder_invitations (folder_id, org_id, email, access_level, invited_by, created_at)
  values (f_red_block, v_org, v_tgt_email, 'editor', v_att, now()),
         (f_red_own,   v_org, v_tgt_email, 'editor', v_att, now()),
         (f_red_later, v_org, v_tgt_email, 'viewer', v_att, now() - interval '1 hour');
  begin
    perform public._redeem_folder_invitations(v_tgt, v_tgt_email, v_org);
    r := r || jsonb_build_object(
      'G01_invite_the_inviter_could_not_make_stays_pending',
        not exists (select 1 from public.folder_members
                     where folder_id = f_red_block and user_id = v_tgt)
        and exists (select 1 from public.folder_invitations
                     where folder_id = f_red_block and status = 'pending'),
      'G02_invite_by_owner_of_every_board_redeems',
        exists (select 1 from public.folder_members
                 where folder_id = f_red_own and user_id = v_tgt and access_level = 'editor')
        and exists (select 1 from public.folder_invitations
                     where folder_id = f_red_own and status = 'accepted'),
      'G03_board_filed_after_the_invite_does_not_block',
        exists (select 1 from public.folder_members
                 where folder_id = f_red_later and user_id = v_tgt and access_level = 'viewer'));
  exception when others then
    r := r || jsonb_build_object('G01_invite_the_inviter_could_not_make_stays_pending',
                                 'ERR ' || sqlstate || ' ' || sqlerrm);
  end;

  -- ───────────────────────────────────────────────────────────── report
  -- 25 checks; a block that errored leaves some out, which must not pass.
  select count(*) = 25 and bool_and(e.value = 'true'::jsonb) into v_all from jsonb_each(r) e;
  r := r || jsonb_build_object('ALL_PASSED', coalesce(v_all, false));
  raise exception 'FOLDER_SHARE_GUARD %', r::text;
end
$dry$;
