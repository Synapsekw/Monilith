-- 20261114191239_folder_invite_existing_member.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   invite_to_folder used to share directly with an active org member by
--   calling share_folder, which upserts: inviting someone who was already on
--   the folder silently changed their level. It now raises 23505
--   'already has access' for that case. An org member who is not yet on the
--   folder is still shared directly. Changing a member's level stays the job
--   of the explicit share action.

create or replace function public.invite_to_folder(p_folder_id uuid, p_email text, p_level public.board_access)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_email text := lower(trim(p_email));
  v_user uuid;
  v_org_inv uuid;
begin
  if not public.can_manage_folder(p_folder_id) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  select org_id into v_org from public.folders where id = p_folder_id;
  -- Serialize invites and revokes for one (org, email) so the shared guest org
  -- invitation is created, adopted and revoked consistently.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_email, 0));

  select u.id into v_user
    from auth.users u
    join public.org_members om
      on om.user_id = u.id and om.org_id = v_org and om.deactivated_at is null
   where lower(u.email::text) = v_email
   limit 1;
  if v_user is not null then
    if exists (
      select 1 from public.folder_members fm
       where fm.folder_id = p_folder_id and fm.user_id = v_user
    ) then
      raise exception 'already has access' using errcode = '23505';
    end if;
    perform public.share_folder(p_folder_id, v_user, p_level);
    return v_user;
  end if;

  -- Remember the org invitation only when this call created it.
  insert into public.org_invitations (org_id, email, role, invited_by)
  values (v_org, v_email, 'guest'::public.org_role, v_uid)
  on conflict (org_id, lower(email)) where status = 'pending' do nothing
  returning id into v_org_inv;
  if v_org_inv is null then
    -- A pending one exists. Adopt it only if another folder invitation already
    -- rides on it (a folder invite made it); an admin-made one stays unowned.
    select oi.id into v_org_inv
      from public.org_invitations oi
     where oi.org_id = v_org and lower(oi.email) = v_email and oi.status = 'pending'
       and exists (
         select 1 from public.folder_invitations fi
         where fi.org_invitation_id = oi.id and fi.status = 'pending'
       );
  end if;

  insert into public.folder_invitations (folder_id, org_id, email, access_level, invited_by, org_invitation_id)
  values (p_folder_id, v_org, v_email, p_level, v_uid, v_org_inv)
  on conflict (folder_id, lower(email)) where status = 'pending'
  do update set access_level = excluded.access_level, invited_by = excluded.invited_by,
                org_invitation_id = coalesce(excluded.org_invitation_id, public.folder_invitations.org_invitation_id);

  return null;
end $$;

revoke execute on function public.invite_to_folder(uuid, text, public.board_access) from public, anon;
grant execute on function public.invite_to_folder(uuid, text, public.board_access) to authenticated;
