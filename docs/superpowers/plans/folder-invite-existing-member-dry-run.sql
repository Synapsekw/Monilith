-- Folder invite, existing member. Run AFTER the migration
-- 20261114191239_folder_invite_existing_member.sql, in the same execute_sql
-- call. There is deliberately no explicit BEGIN/COMMIT/ROLLBACK: the whole call
-- is one implicit transaction and the script ENDS BY RAISING AN EXCEPTION, so
-- Postgres rolls back everything the migration and this script did. Results
-- travel in that exception's message:
--   INVITE_DRY {"ok_...": true, ..., "ALL_PASSED": true}
-- An error that does not start with INVITE_DRY means something failed earlier;
-- it rolls back too. Prints only check names and booleans, never ids, names or
-- emails. 'fixture' = NO_FIXTURE means the DB lacks an org with a board creator
-- and two other active plain members.

create temp table invite_dry_results (name text primary key, value jsonb);

do $dry$
declare
  v_org uuid; v_creator uuid; v_ws uuid;
  v_a uuid; v_b uuid; v_a_email text; v_b_email text;
  v_folder uuid;
  v_raised boolean; v_code text; v_ret uuid; v_level public.board_access;
begin
  select b.org_id, b.created_by, b.workspace_id
    into v_org, v_creator, v_ws
  from public.boards b
  join public.org_members oc
    on oc.org_id = b.org_id and oc.user_id = b.created_by and oc.deactivated_at is null
  where b.archived_at is null
    and (select count(*) from public.org_members om
          where om.org_id = b.org_id and om.user_id <> b.created_by
            and om.deactivated_at is null and om.role = 'member') >= 2
  limit 1;
  if v_org is null then
    insert into invite_dry_results values ('fixture', '"NO_FIXTURE"');
    return;
  end if;

  select om.user_id, lower(u.email::text) into v_a, v_a_email
    from public.org_members om join auth.users u on u.id = om.user_id
   where om.org_id = v_org and om.user_id <> v_creator
     and om.deactivated_at is null and om.role = 'member' and u.email is not null
   order by om.user_id limit 1;
  select om.user_id, lower(u.email::text) into v_b, v_b_email
    from public.org_members om join auth.users u on u.id = om.user_id
   where om.org_id = v_org and om.user_id <> v_creator and om.user_id <> v_a
     and om.deactivated_at is null and om.role = 'member' and u.email is not null
   order by om.user_id limit 1;
  if v_a is null or v_b is null then
    insert into invite_dry_results values ('fixture', '"NO_FIXTURE"');
    return;
  end if;

  -- Fixture: a folder created by the board creator, with A on it as editor.
  perform set_config('request.jwt.claims', '', true);
  insert into public.folders (org_id, workspace_id, name, created_by)
  values (v_org, v_ws, 'invite-dry-' || gen_random_uuid()::text, v_creator)
  returning id into v_folder;
  delete from public.folder_members where folder_id = v_folder;
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (v_folder, v_org, v_a, 'editor', v_creator);

  perform set_config('request.jwt.claims', json_build_object('sub', v_creator)::text, true);

  -- 1. Inviting a current member at viewer level raises 23505 and changes nothing.
  v_raised := false; v_code := null;
  begin
    perform public.invite_to_folder(v_folder, v_a_email, 'viewer');
  exception when others then
    v_raised := true; v_code := sqlstate;
  end;
  insert into invite_dry_results values ('ok_existing_member_raises_23505',
    to_jsonb(v_raised and v_code = '23505'));

  perform set_config('request.jwt.claims', '', true);
  select access_level into v_level from public.folder_members
   where folder_id = v_folder and user_id = v_a;
  insert into invite_dry_results values ('ok_existing_member_level_unchanged',
    to_jsonb(v_level = 'editor'));

  -- 2. An org member who is not on the folder is still shared directly.
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator)::text, true);
  v_ret := public.invite_to_folder(v_folder, v_b_email, 'viewer');
  perform set_config('request.jwt.claims', '', true);
  insert into invite_dry_results values ('ok_org_member_shared_directly',
    to_jsonb(v_ret = v_b and exists (
      select 1 from public.folder_members
       where folder_id = v_folder and user_id = v_b and access_level = 'viewer')));

  -- 3. No folder invitation was recorded for either email.
  insert into invite_dry_results values ('ok_no_invitation_recorded',
    to_jsonb(not exists (
      select 1 from public.folder_invitations
       where folder_id = v_folder and lower(email) in (v_a_email, v_b_email))));
end
$dry$;

insert into invite_dry_results (name, value)
select 'ALL_PASSED', to_jsonb(not exists (
  select 1 from invite_dry_results r where r.value is distinct from 'true'::jsonb));

do $report$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_object_agg(name, value), '{}'::jsonb) into v_out
  from invite_dry_results;
  raise exception 'INVITE_DRY %', v_out::text;
end
$report$;
