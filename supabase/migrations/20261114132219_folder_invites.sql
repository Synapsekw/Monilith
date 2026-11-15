-- 20261114132219_folder_invites.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Folder grants (folder_members, folder_invitations), the folder path in the
--   board access helpers, share/invite RPCs and invitation redemption.

-- Folder invites: one folder_members row grants viewer/editor on every board
-- in the folder, resolved at read time through folder_boards (PK board_id).
-- The four board access helpers keep their signatures and gain a folder path.

-- ───────────────────────────────────────────────────────────── 1. tables
create table public.folder_members (
  folder_id    uuid not null,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  access_level public.board_access not null,
  granted_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (folder_id, user_id),
  foreign key (folder_id, org_id) references public.folders (id, org_id) on delete cascade
);
create index folder_members_user_idx on public.folder_members (user_id, folder_id);
create index folder_members_org_id_idx on public.folder_members (org_id);
create index folder_members_granted_by_idx on public.folder_members (granted_by);

create table public.folder_invitations (
  id           uuid primary key default gen_random_uuid(),
  folder_id    uuid not null,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null,
  access_level public.board_access not null,
  invited_by   uuid references auth.users (id) on delete set null,
  -- Set only when the invite created the guest org invitation itself, so a
  -- revoke never touches an org invitation somebody else made.
  org_invitation_id uuid references public.org_invitations (id) on delete set null,
  status       text not null default 'pending'
               constraint folder_invitations_status_check
               check (status in ('pending', 'accepted', 'revoked')),
  created_at   timestamptz not null default now(),
  foreign key (folder_id, org_id) references public.folders (id, org_id) on delete cascade
);
create unique index folder_invitations_pending_uq
  on public.folder_invitations (folder_id, lower(email)) where status = 'pending';
create index folder_invitations_email_idx on public.folder_invitations (lower(email));
create index folder_invitations_org_id_idx on public.folder_invitations (org_id);
create index folder_invitations_invited_by_idx on public.folder_invitations (invited_by);
create index folder_invitations_org_invitation_idx on public.folder_invitations (org_invitation_id);

alter table public.folder_members enable row level security;
alter table public.folder_invitations enable row level security;

-- ──────────────────────────────────────────────── 2. small boolean helpers
create function public.is_org_guest(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = (select auth.uid())
      and role = 'guest' and deactivated_at is null
  );
$$;

create function public.is_folder_member(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.folder_members fm
    where fm.folder_id = p_folder_id and fm.user_id = (select auth.uid())
  );
$$;

create function public.folder_has_members(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  -- Only answers for callers who belong to the folder's org; used by the
  -- folders delete policy, so the grant to authenticated stays.
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id and public.is_org_member(f.org_id)
  ) and exists (select 1 from public.folder_members fm where fm.folder_id = p_folder_id);
$$;

-- A guest sees a folder only as a member of it; everyone else in the org sees it.
create function public.can_see_folder(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and (not public.is_org_guest(f.org_id) or public.is_folder_member(f.id))
  );
$$;

-- Invite, change a level, remove: the folder's creator, org owners and admins.
create function public.can_manage_folder(p_folder_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and not public.is_org_guest(f.org_id)
      and (
        f.created_by = (select auth.uid())
        or public.has_org_role(f.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;

revoke execute on function public.is_org_guest(uuid) from public, anon;
revoke execute on function public.is_folder_member(uuid) from public, anon;
revoke execute on function public.folder_has_members(uuid) from public, anon;
revoke execute on function public.can_see_folder(uuid) from public, anon;
revoke execute on function public.can_manage_folder(uuid) from public, anon;
grant execute on function public.is_org_guest(uuid) to authenticated;
grant execute on function public.is_folder_member(uuid) to authenticated;
grant execute on function public.folder_has_members(uuid) to authenticated;
grant execute on function public.can_see_folder(uuid) to authenticated;
grant execute on function public.can_manage_folder(uuid) to authenticated;

-- ───────────────────────────────────────────────────── 3. the access rule
create function public._folder_board_level(p_board_id uuid, p_user_id uuid)
returns public.board_access language sql stable security definer set search_path = '' as $$
  select fm.access_level
  from public.folder_boards fb
  join public.folder_members fm on fm.folder_id = fb.folder_id
  where fb.board_id = p_board_id and fm.user_id = p_user_id;
$$;
revoke execute on function public._folder_board_level(uuid, uuid) from public, anon, authenticated;

create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and public.is_org_member(b.org_id)
      and (
        b.created_by = (select auth.uid())
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = (select auth.uid())
        )
        or exists (
          select 1 from public.folder_boards fb
          join public.folder_members fm on fm.folder_id = fb.folder_id
          where fb.board_id = b.id and fm.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and public.is_org_member(b.org_id)
      and (
        b.created_by = (select auth.uid())
        or exists (
          select 1 from public.board_members m
          where m.board_id = b.id and m.user_id = (select auth.uid())
            and m.access_level = 'editor'
        )
        or exists (
          select 1 from public.folder_boards fb
          join public.folder_members fm on fm.folder_id = fb.folder_id
          where fb.board_id = b.id and fm.user_id = (select auth.uid())
            and fm.access_level = 'editor'
        )
      )
  );
$$;

create or replace function public.readable_board_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select b.id
  from public.boards b
  where public.is_org_member(b.org_id)
    and (
      b.created_by = (select auth.uid())
      or exists (
        select 1 from public.board_members m
        where m.board_id = b.id and m.user_id = (select auth.uid())
      )
    )
  union
  select b.id
  from public.folder_members fm
  join public.folder_boards fb on fb.folder_id = fm.folder_id
  join public.boards b on b.id = fb.board_id
  where fm.user_id = (select auth.uid())
    and public.is_org_member(b.org_id);
$$;

create or replace function public.is_board_member(p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.board_members m
    where m.board_id = p_board_id and m.user_id = (select auth.uid())
  ) or exists (
    select 1 from public.folder_boards fb
    join public.folder_members fm on fm.folder_id = fb.folder_id
    where fb.board_id = p_board_id and fm.user_id = (select auth.uid())
  );
$$;

-- The caller's folder-derived level on a set of boards (TypeScript access copies).
create function public.my_folder_board_levels(p_board_ids uuid[])
returns table (board_id uuid, access_level public.board_access)
language sql stable security definer set search_path = '' as $$
  select fb.board_id, fm.access_level
  from public.folder_boards fb
  join public.folder_members fm on fm.folder_id = fb.folder_id
  join public.boards b on b.id = fb.board_id
  where fb.board_id = any (p_board_ids)
    and fm.user_id = (select auth.uid())
    and public.is_org_member(b.org_id);
$$;
revoke execute on function public.my_folder_board_levels(uuid[]) from public, anon;
grant execute on function public.my_folder_board_levels(uuid[]) to authenticated;

-- Everyone who reaches a board through its folder (share dialog, read-only rows).
create function public.board_folder_grants(p_board_id uuid)
returns table (user_id uuid, access_level public.board_access, folder_name text)
language sql stable security definer set search_path = '' as $$
  select fm.user_id, fm.access_level, f.name
  from public.folder_boards fb
  join public.folders f on f.id = fb.folder_id
  join public.folder_members fm on fm.folder_id = fb.folder_id
  where fb.board_id = p_board_id
    and public.can_read_board(p_board_id)
    and public.can_see_folder(fb.folder_id);
$$;
revoke execute on function public.board_folder_grants(uuid) from public, anon;
grant execute on function public.board_folder_grants(uuid) to authenticated;

-- ─────────────────────────────────────────────────────── 4. Mono bots
-- A bot's board_members row follows its owner. The owner's level is now the
-- higher of the direct grant and the folder grant.
create or replace function public._owner_board_level(p_board_id uuid, p_owner uuid)
returns public.board_access language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.boards b where b.id = p_board_id and b.created_by = p_owner)
      then 'editor'::public.board_access
    else greatest(
      (select bm.access_level from public.board_members bm
        where bm.board_id = p_board_id and bm.user_id = p_owner),
      public._folder_board_level(p_board_id, p_owner)
    )
  end;
$$;

create function public._sync_mono_board_row(p_board_id uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_mono uuid; v_level public.board_access;
begin
  select b.org_id into v_org from public.boards b where b.id = p_board_id;
  if v_org is null then return; end if;
  select m.user_id into v_mono from public.monos m
   where m.owner_id = p_owner and m.org_id = v_org;
  if v_mono is null then return; end if;
  v_level := public._owner_board_level(p_board_id, p_owner);
  if v_level is null then
    delete from public.board_members bm where bm.board_id = p_board_id and bm.user_id = v_mono;
  else
    update public.board_members bm set access_level = v_level
     where bm.board_id = p_board_id and bm.user_id = v_mono and bm.access_level <> v_level;
  end if;
end $$;
revoke execute on function public._sync_mono_board_row(uuid, uuid) from public, anon, authenticated;

create function public.tg_folder_members_sync_monos()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_folder uuid := case when tg_op = 'DELETE' then old.folder_id else new.folder_id end;
  v_user   uuid := case when tg_op = 'DELETE' then old.user_id   else new.user_id   end;
  r record;
begin
  for r in select fb.board_id from public.folder_boards fb where fb.folder_id = v_folder loop
    perform public._sync_mono_board_row(r.board_id, v_user);
  end loop;
  return null;
end $$;
revoke execute on function public.tg_folder_members_sync_monos() from public, anon, authenticated;
create trigger folder_members_sync_monos
  after insert or update of access_level or delete on public.folder_members
  for each row execute function public.tg_folder_members_sync_monos();

create function public.tg_folder_boards_sync_monos()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_board uuid := case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  r record;
begin
  for r in
    select distinct fm.user_id from public.folder_members fm
    where fm.folder_id in (
      case when tg_op in ('UPDATE', 'DELETE') then old.folder_id end,
      case when tg_op in ('UPDATE', 'INSERT') then new.folder_id end
    )
  loop
    perform public._sync_mono_board_row(v_board, r.user_id);
    if tg_op = 'UPDATE' and old.board_id <> new.board_id then
      perform public._sync_mono_board_row(old.board_id, r.user_id);
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.tg_folder_boards_sync_monos() from public, anon, authenticated;
create trigger folder_boards_sync_monos
  after insert or update of folder_id, board_id or delete on public.folder_boards
  for each row execute function public.tg_folder_boards_sync_monos();

-- ───────────────────────── 5. moving a board into or out of a shared folder
-- Entering a folder that has members exposes the board to them; leaving one
-- removes their access. Only the board's creator or an org owner/admin may do
-- either. A reorder (same folder_id) and a cascade (folder or board deleted,
-- trigger depth > 1) are not moves.
create function public.tg_folder_boards_guard_shared()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_board uuid := case when tg_op = 'DELETE' then old.board_id else new.board_id end;
  v_org uuid; v_creator uuid; v_shared boolean;
begin
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
  select exists (
    select 1 from public.folder_members fm
    where fm.folder_id in (
      case when tg_op in ('UPDATE', 'DELETE') then old.folder_id end,
      case when tg_op in ('UPDATE', 'INSERT') then new.folder_id end
    )
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
create trigger folder_boards_guard_shared
  before insert or update or delete on public.folder_boards
  for each row execute function public.tg_folder_boards_guard_shared();

create or replace function public.folder_accepts_board(p_folder_id uuid, p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.folders f
    join public.boards b on b.id = p_board_id
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and not public.is_org_guest(f.org_id)
      and b.workspace_id = f.workspace_id
      and public.can_read_board(b.id)
  );
$$;

-- can_manage_folder keys on folders.created_by, so a client must not be able to
-- rewrite it. The FK's on delete set null runs at trigger depth > 1 (and the
-- creator is gone from auth.users); server-side writes without a caller pass.
create function public.tg_folders_guard_created_by()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by
     and (select auth.uid()) is not null
     and pg_trigger_depth() = 1
     and not (
       new.created_by is null
       and not exists (select 1 from auth.users u where u.id = old.created_by)
     ) then
    raise exception 'the creator of a folder cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_folders_guard_created_by() from public, anon, authenticated;
create trigger folders_guard_created_by
  before update on public.folders
  for each row execute function public.tg_folders_guard_created_by();

-- ───────────────────────────────────────── 6. folder visibility and writes
alter policy "folders: read if member" on public.folders
  using (
    org_id in (select public.auth_user_orgs())
    and (not public.is_org_guest(org_id) or public.is_folder_member(id))
  );

alter policy "folders: insert if member" on public.folders
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

alter policy "folders: update if member" on public.folders
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

alter policy "folders: delete if member" on public.folders
  using (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and (not public.folder_has_members(id) or public.can_manage_folder(id))
  );

alter policy "folder_layouts: read if member" on public.folder_layouts
  using (public.can_see_folder(folder_id));

alter policy "folder_layouts: insert if member" on public.folder_layouts
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

alter policy "folder_layouts: update if member" on public.folder_layouts
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

alter policy "folder_layouts: delete if member" on public.folder_layouts
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));

alter policy "folder_boards: read if member" on public.folder_boards
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id
        and f.org_id in (select public.auth_user_orgs())
    )
    and public.can_read_board(folder_boards.board_id)
    and public.can_see_folder(folder_boards.folder_id)
  );

alter policy "folder_boards: update if member" on public.folder_boards
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id
        and public.is_org_member(f.org_id)
        and not public.is_org_guest(f.org_id)
    )
    and public.can_read_board(board_id)
  )
  with check (public.folder_accepts_board(folder_id, board_id));

alter policy "folder_boards: delete if member" on public.folder_boards
  using (
    exists (
      select 1 from public.folders f
      where f.id = folder_boards.folder_id
        and public.is_org_member(f.org_id)
        and not public.is_org_guest(f.org_id)
    )
    and public.can_read_board(board_id)
  );

-- The folder gallery listed every folder in the workspace to any org member.
-- Body unchanged from 20260915112812 except the one can_see_folder predicate.
create or replace function public.folder_gallery(p_workspace_id uuid)
returns table (
  folder_id uuid, folder_name text, folder_position integer, board_count integer,
  item_count integer, done_count integer, overdue_count integer, attention_count integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.workspaces where id = p_workspace_id;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  return query
  select fo.id,
         fo.name,
         fo.position,
         (select count(*)::int from public._folder_readable_boards(fo.id)),
         count(f.item_id)::int,
         count(f.item_id) filter (where f.is_done)::int,
         count(f.item_id) filter (where f.is_overdue)::int,
         count(f.item_id) filter (where not f.is_done and (
           f.is_overdue
           or f.is_blocked
           or (f.has_people_col and not f.has_owner)
           or f.last_touched < now() - interval '14 days'
         ))::int
  from public.folders fo
  left join lateral public._folder_item_flags(fo.id) f on true
  where fo.workspace_id = p_workspace_id
    and public.can_see_folder(fo.id)
  group by fo.id, fo.name, fo.position
  order by fo.position asc, fo.name asc;
end; $$;

create or replace function public._assert_folder_member(p_folder_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_see_folder(p_folder_id) then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
end; $$;

-- ───────────────────────────────── 7. RLS on the two new tables (default deny)
create policy "folder_members: read if can see folder" on public.folder_members
  for select to authenticated using (public.can_see_folder(folder_id));
create policy "folder_members: member leaves" on public.folder_members
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "folder_invitations: read if can manage" on public.folder_invitations
  for select to authenticated using (public.can_manage_folder(folder_id));

revoke all on table public.folder_members from anon;
revoke all on table public.folder_invitations from anon;
revoke insert, update, truncate, references, trigger on table public.folder_members from authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.folder_invitations from authenticated;

-- ───────────────────────────────────────────────────── 8. management RPCs
create function public.share_folder(p_folder_id uuid, p_user_id uuid, p_level public.board_access)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_role public.org_role;
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
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  values (p_folder_id, v_org, p_user_id, p_level, v_uid)
  on conflict (folder_id, user_id)
  do update set access_level = excluded.access_level, granted_by = excluded.granted_by;
end $$;

create function public.unshare_folder(p_folder_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_folder(p_folder_id) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  delete from public.folder_members where folder_id = p_folder_id and user_id = p_user_id;
end $$;

-- Returns the member's id when the email already belongs to an active org
-- member (shared directly), null when an invitation was recorded.
create function public.invite_to_folder(p_folder_id uuid, p_email text, p_level public.board_access)
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

create function public.revoke_folder_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_folder uuid; v_org_inv uuid; v_org uuid; v_email text;
begin
  select org_id, lower(email) into v_org, v_email
    from public.folder_invitations where id = p_id and status = 'pending';
  if v_org is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_email, 0));
  select folder_id, org_invitation_id into v_folder, v_org_inv
    from public.folder_invitations where id = p_id and status = 'pending';
  if v_folder is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_folder(v_folder) then
    raise exception 'not allowed to manage this folder' using errcode = '42501';
  end if;
  update public.folder_invitations set status = 'revoked' where id = p_id;
  -- Only an org invitation a folder invite created, and only once no other
  -- pending folder invitation for this email in this org still needs it.
  if v_org_inv is not null then
    update public.org_invitations oi
       set status = 'revoked'
     where oi.id = v_org_inv
       and oi.status = 'pending' and oi.role = 'guest'
       and not exists (
         select 1 from public.folder_invitations fi
         where fi.org_id = v_org and lower(fi.email) = v_email and fi.status = 'pending'
       );
  end if;
end $$;

create function public.folder_invitation_states(p_folder_id uuid)
returns table (id uuid, email text, access_level public.board_access, state text)
language sql stable security definer set search_path = '' as $$
  select fi.id, fi.email, fi.access_level,
         case when exists (
                select 1 from auth.users u
                join public.account_approvals a on a.user_id = u.id
                where lower(u.email::text) = lower(fi.email) and a.status = 'pending'
              ) then 'awaiting_approval' else 'invited' end
  from public.folder_invitations fi
  where fi.folder_id = p_folder_id
    and fi.status = 'pending'
    and public.can_manage_folder(p_folder_id)
  order by fi.created_at;
$$;

revoke execute on function public.share_folder(uuid, uuid, public.board_access) from public, anon;
revoke execute on function public.unshare_folder(uuid, uuid) from public, anon;
revoke execute on function public.invite_to_folder(uuid, text, public.board_access) from public, anon;
revoke execute on function public.revoke_folder_invitation(uuid) from public, anon;
revoke execute on function public.folder_invitation_states(uuid) from public, anon;
grant execute on function public.share_folder(uuid, uuid, public.board_access) to authenticated;
grant execute on function public.unshare_folder(uuid, uuid) to authenticated;
grant execute on function public.invite_to_folder(uuid, text, public.board_access) to authenticated;
grant execute on function public.revoke_folder_invitation(uuid) to authenticated;
grant execute on function public.folder_invitation_states(uuid) to authenticated;

-- ───────────────────────────────────────────────────────── 9. redemption
-- Turns pending folder invitations into folder_members rows, but only for orgs
-- the user has actually joined (the org invitation was accepted and the
-- account_not_approved trigger on org_members let the row in).
create function public._redeem_folder_invitations(p_uid uuid, p_email text, p_org_id uuid)
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
    returning fi.folder_id, fi.org_id, fi.access_level, fi.invited_by
  )
  insert into public.folder_members (folder_id, org_id, user_id, access_level, granted_by)
  select t.folder_id, t.org_id, p_uid, t.access_level, t.invited_by from taken t
  on conflict (folder_id, user_id)
  do update set access_level = greatest(public.folder_members.access_level, excluded.access_level);
end $$;
revoke execute on function public._redeem_folder_invitations(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.redeem_invitations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text; v_count int := 0;
  v_home_org uuid;
begin
  if v_uid is null then return 0; end if;
  select email::text into v_email from auth.users where id = v_uid;
  if v_email is null then return 0; end if;

  -- The redeemer's owned org is stable across this call (redemption only adds
  -- member/guest rows, never owner rows). Brand-new invite-only users own none
  -- yet at redeem time, so reciprocity correctly no-ops for them.
  select org_id into v_home_org
    from public.org_members
   where user_id = v_uid and role = 'owner'
   limit 1;

  with redeemed as (
    update public.org_invitations
       set status = 'accepted', accepted_at = now()
     where status = 'pending' and lower(email) = lower(v_email)
     returning org_id, role, invited_by
  ), inserted as (
    insert into public.org_members (org_id, user_id, role)
    select org_id, v_uid, role from redeemed
    on conflict (org_id, user_id) do nothing
    returning 1
  ), reciprocal as (
    -- Data-modifying CTE runs to completion even though the final SELECT does
    -- not reference it. distinct dedupes repeat inviters within one batch.
    insert into public.org_members (org_id, user_id, role)
    select distinct v_home_org, r.invited_by, 'guest'::public.org_role
      from redeemed r
     where v_home_org is not null
       and r.invited_by is not null
       and r.invited_by <> v_uid
    on conflict (org_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  perform public._redeem_folder_invitations(v_uid, v_email, null);
  return v_count;
end; $$;

create or replace function public.accept_invitation(p_invite_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
  v_role public.org_role;
  v_invited_by uuid;
  v_home_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'accepted', accepted_at = now()
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email
   returning org_id, role, invited_by into v_org_id, v_role, v_invited_by;

  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_uid, v_role)
  on conflict (org_id, user_id) do nothing;

  -- Reciprocal: inviter → invitee's owned org (0 or 1) as guest.
  select org_id into v_home_org
    from public.org_members
   where user_id = v_uid and role = 'owner'
   limit 1;

  if v_home_org is not null
     and v_invited_by is not null
     and v_invited_by <> v_uid then
    insert into public.org_members (org_id, user_id, role)
    values (v_home_org, v_invited_by, 'guest'::public.org_role)
    on conflict (org_id, user_id) do nothing;  -- never demote an existing role
  end if;

  perform public._redeem_folder_invitations(v_uid, v_email, v_org_id);
  return v_org_id;
end; $$;

create or replace function public.decline_invitation(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'declined'
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email
   returning org_id into v_org_id;
  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  -- Declining the org invitation declines the folder invites that came with it.
  update public.folder_invitations
     set status = 'revoked'
   where org_id = v_org_id and lower(email) = v_email and status = 'pending';
end; $$;
