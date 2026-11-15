-- 20261115173604_folder_share_guard.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Closes a privilege escalation in folder sharing. A folder grant reaches
--   every board in the folder, but share_folder / invite_to_folder only asked
--   "may the caller manage the FOLDER" (its creator, or an org owner/admin),
--   and filing a board into a folder with no members yet needs only read
--   access. So a member with view-only access to a board could create a
--   folder, file the board in it and share the folder with themself as editor.
--
--   The rule now: creating or raising a folder grant is allowed only when, for
--   EVERY board currently in the folder, the caller is that board's creator or
--   an org owner/admin. That is the same right tg_folder_boards_guard_shared
--   already demands for moving a board into a shared folder. Removing access
--   and lowering a level stay governed by can_manage_folder alone.
--
--   Changed, each starting from its latest definition:
--     tg_folder_boards_guard_shared  (20261114132219) pending invitations now
--                                    count as "shared"; takes the folder lock;
--                                    owns folder_boards.created_at
--     share_folder                   (20261114132219) guard on insert and raise
--     invite_to_folder               (20261114191239) guard on new and raised
--                                    invitations (the direct-share branch is
--                                    guarded inside share_folder)
--     _redeem_folder_invitations     (20261114132219) re-checks the inviter
--   New: _folder_share_blockers (internal, not executable by any client role).
--   No signature changes, so the generated TypeScript types only gain the new
--   internal function.

-- ─────────────────────────────────────────────────────────── 1. the rule
-- How many boards in the folder stand between p_user_id and a grant: boards
-- that user did not create, in an org where they are not an active owner or
-- admin. 0 means the grant is theirs to make. Counts boards the user cannot
-- even read: those are exactly the ones a grant must not hand out.
-- p_filed_by, when given, limits the count to boards filed in the folder at or
-- before that moment (used by redemption, see section 5).
create function public._folder_share_blockers(
  p_folder_id uuid, p_user_id uuid, p_filed_by timestamptz default null
)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.folder_boards fb
  join public.boards b on b.id = fb.board_id
  where fb.folder_id = p_folder_id
    and (p_filed_by is null or fb.created_at <= p_filed_by)
    and (p_user_id is null or b.created_by is distinct from p_user_id)
    and not exists (
      select 1 from public.org_members om
      where om.org_id = b.org_id
        and om.user_id = p_user_id
        and om.role in ('owner', 'admin')
        and om.deactivated_at is null
    );
$$;
revoke execute on function public._folder_share_blockers(uuid, uuid, timestamptz)
  from public, anon, authenticated;

-- ───────────────────── 2. moving a board into or out of a shared folder
-- Body from 20261114132219 with three changes:
--   a. A folder with a PENDING invitation is shared too. Before, a folder
--      with an invitation but no members yet let anyone who could read a board
--      file it there, and the invitee got it on redemption.
--   b. It takes the per-folder advisory lock that share_folder and
--      invite_to_folder take. Without it, "file a board" and "share the
--      folder" could each run their check before the other committed and both
--      pass. Two folders are locked in id order. (The app's upsert fires the
--      INSERT trigger for the target folder first, so two opposite moves
--      between the same pair of folders at the same instant can still
--      deadlock; Postgres aborts one of them and it can be retried.)
--   c. folder_boards.created_at now means "when the board entered this
--      folder" and a client cannot choose it: redemption (section 5) compares
--      it with the invitation's timestamp. The app moves a board with an
--      upsert, i.e. an UPDATE of folder_id, which used to keep the old stamp.
create or replace function public.tg_folder_boards_guard_shared()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_board uuid := case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  v_old_folder uuid := case when tg_op in ('UPDATE', 'DELETE') then old.folder_id end;
  v_new_folder uuid := case when tg_op in ('UPDATE', 'INSERT') then new.folder_id end;
  v_folder uuid;
  v_org uuid; v_creator uuid; v_shared boolean;
begin
  -- A move always re-stamps. A client can never pick the stamp; a server-side
  -- write (no caller) may.
  if tg_op = 'UPDATE' and new.folder_id <> old.folder_id then
    new.created_at := now();
  elsif tg_op = 'UPDATE' and v_uid is not null then
    new.created_at := old.created_at;
  elsif tg_op = 'INSERT' and v_uid is not null then
    new.created_at := now();
  end if;
  if v_uid is null or pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Swapping which board a placement points at would slip an unrelated board
  -- into (or out of) a shared folder without passing the checks below.
  if tg_op = 'UPDATE' and new.board_id <> old.board_id then
    raise exception 'a folder placement cannot be re-pointed at another board'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.folder_id = old.folder_id and new.board_id = old.board_id then
    return new;
  end if;
  for v_folder in
    select distinct f from unnest(array[v_old_folder, v_new_folder]) as t (f)
    where f is not null order by f
  loop
    perform pg_advisory_xact_lock(hashtextextended('folder-share:' || v_folder::text, 0));
  end loop;
  select exists (
    select 1 from public.folder_members fm
    where fm.folder_id in (v_old_folder, v_new_folder)
  ) or exists (
    select 1 from public.folder_invitations fi
    where fi.folder_id in (v_old_folder, v_new_folder) and fi.status = 'pending'
  ) into v_shared;
  if not v_shared then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select b.org_id, b.created_by into v_org, v_creator from public.boards b where b.id = v_board;
  if v_creator is distinct from v_uid
     and not public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'only the board owner or an admin can move a board into or out of a shared folder'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.tg_folder_boards_guard_shared() from public, anon, authenticated;

-- ──────────────────────────────────────────────────────── 3. share_folder
-- Body from 20261114132219. New: the folder lock, and the board-ownership
-- guard whenever the call would give the target MORE than they have (a new
-- row, or viewer -> editor). Lowering a level and re-stating the same level
-- need only can_manage_folder, and leave granted_by naming whoever vouched for
-- the level in force.
create or replace function public.share_folder(p_folder_id uuid, p_user_id uuid, p_level public.board_access)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_role public.org_role;
  v_old public.board_access; v_blocked integer;
begin
  if not public.can_manage_folder(p_folder_id) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  select org_id into v_org from public.folders where id = p_folder_id;
  select role into v_role from public.org_members
   where org_id = v_org and user_id = p_user_id and deactivated_at is null;
  if v_role is null then
    raise exception 'target is not a member of this org' using errcode = '42501';
  end if;
  if v_role = 'agent' then
    raise exception 'a Mono follows its owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('folder-share:' || p_folder_id::text, 0));
  select fm.access_level into v_old from public.folder_members fm
   where fm.folder_id = p_folder_id and fm.user_id = p_user_id;
  if v_old is null or p_level > v_old then
    v_blocked := public._folder_share_blockers(p_folder_id, v_uid);
    if v_blocked > 0 then
      -- The app reads the count out of this message (sharing-actions.ts).
      raise exception 'cannot share this folder: % of its boards belong to someone else', v_blocked
        using errcode = '42501';
    end if;
  end if;
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (p_folder_id, v_org, p_user_id, p_level, v_uid)
  on conflict (folder_id, user_id)
  do update set access_level = excluded.access_level,
                granted_by = case when excluded.access_level > public.folder_members.access_level
                                  then excluded.granted_by
                                  else public.folder_members.granted_by end;
end $$;
revoke execute on function public.share_folder(uuid, uuid, public.board_access) from public, anon;
grant execute on function public.share_folder(uuid, uuid, public.board_access) to authenticated;

-- ───────────────────────────────────────────────────── 4. invite_to_folder
-- Body from 20261114191239. The direct-share branch (the email is an org
-- member not yet on the folder) calls share_folder, which now guards the
-- insert. The recorded-invitation branch is guarded here, before anything is
-- written, when it creates an invitation or raises a pending one's level.
-- Lowering a pending invitation's level, or repeating it, needs only
-- can_manage_folder. invited_by and created_at are the "who vouched, and
-- when" that redemption checks, so they move only when the caller passes the
-- guard themself.
create or replace function public.invite_to_folder(p_folder_id uuid, p_email text, p_level public.board_access)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_email text := lower(trim(p_email));
  v_user uuid;
  v_org_inv uuid;
  v_old public.board_access;
  v_blocked integer;
  v_vouch boolean;
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

  -- Always after the (org, email) lock, never before it.
  perform pg_advisory_xact_lock(hashtextextended('folder-share:' || p_folder_id::text, 0));
  select fi.access_level into v_old from public.folder_invitations fi
   where fi.folder_id = p_folder_id and lower(fi.email) = v_email and fi.status = 'pending';
  v_blocked := public._folder_share_blockers(p_folder_id, v_uid);
  if (v_old is null or p_level > v_old) and v_blocked > 0 then
    raise exception 'cannot share this folder: % of its boards belong to someone else', v_blocked
      using errcode = '42501';
  end if;
  v_vouch := v_blocked = 0;

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
  do update set access_level = excluded.access_level,
                invited_by = case when v_vouch then excluded.invited_by
                                  else public.folder_invitations.invited_by end,
                created_at = case when v_vouch then now()
                                  else public.folder_invitations.created_at end,
                org_invitation_id = coalesce(excluded.org_invitation_id, public.folder_invitations.org_invitation_id);

  return null;
end $$;
revoke execute on function public.invite_to_folder(uuid, text, public.board_access) from public, anon;
grant execute on function public.invite_to_folder(uuid, text, public.board_access) to authenticated;

-- ───────────────────────────────────────────────────────── 5. redemption
-- Decision: redemption re-checks the inviter. An invitation is a grant that
-- lands later, and it can land long after it was made, so it could otherwise
-- hand out something the inviter may no longer give:
--   - invitations recorded before this migration were never guarded at all
--     (the escalation could be parked as a pending invite to an outside
--     address);
--   - the inviter may since have been demoted, deactivated or removed, or a
--     board's creator may have changed (account deletion re-attributes).
-- So an invitation redeems only if its inviter (invited_by) would still pass
-- the share guard now, counting the boards that were in the folder when the
-- invitation was last vouched for (folder_invitations.created_at). Boards
-- filed AFTER that are not held against the inviter: the move guard in
-- section 2 treats a folder with a pending invitation as shared, so whoever
-- filed them was that board's creator or an admin and chose to expose it,
-- exactly as with a folder that already has members.
-- An invitation that fails stays 'pending' and grants nothing; it redeems on
-- the invitee's next sign-in once someone who passes the guard invites the
-- address again (which re-stamps invited_by and created_at), or a manager can
-- revoke it. An invitation whose inviter was deleted (invited_by null) passes
-- only if the folder held no boards when it was made.
-- Existing folder_members rows are not re-checked here or anywhere: a grant
-- already in force is not revoked when its granter later loses the right,
-- which is also how board_members behaves.
create or replace function public._redeem_folder_invitations(p_uid uuid, p_email text, p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  with taken as (
    update public.folder_invitations fi
       set status = 'accepted'
     where fi.status = 'pending'
       and lower(fi.email) = lower(p_email)
       and (p_org_id is null or fi.org_id = p_org_id)
       and exists (
         select 1 from public.org_members om
         where om.org_id = fi.org_id and om.user_id = p_uid and om.deactivated_at is null
       )
       and public._folder_share_blockers(fi.folder_id, fi.invited_by, fi.created_at) = 0
    returning fi.folder_id, fi.org_id, fi.access_level, fi.invited_by
  )
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  select t.folder_id, t.org_id, p_uid, t.access_level, t.invited_by from taken t
  on conflict (folder_id, user_id)
  do update set access_level = greatest(public.folder_members.access_level, excluded.access_level);
end $$;
revoke execute on function public._redeem_folder_invitations(uuid, text, uuid) from public, anon, authenticated;

-- Invitations that are pending right now were made before the move guard
-- covered pending-invite folders, so no board filed up to this moment was
-- vetted by its mover. Re-stamping them makes redemption hold every board
-- already in the folder against the inviter. Touches created_at only, on
-- pending rows only; nothing is revoked.
update public.folder_invitations set created_at = now() where status = 'pending';
