-- 20261115173759_guest_roster_confinement.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   A guest could read the whole org: every org_members row, every profile
--   (name, avatar, email), every workspace name, every Mono (name and owner)
--   and the org's AI settings. The folder-invites work confined folders,
--   boards and org-level surfaces but left these five read policies alone.
--
--   Rule. A guest reads another person's membership/profile row only when the
--   two share access to something:
--     * the members and the creator of a folder the guest is a member of;
--     * on every board the guest can read: its creator, everyone with a
--       direct grant on it (which is how a Mono is "on" a board), and the
--       members of the folder it sits in;
--     * themselves.
--   A guest reads a workspace only when it holds a folder they are a member
--   of or a board they can read, a Mono only when it is one of the people
--   above, and nothing of org_ai_settings.
--
--   Non-guests are unaffected. Every policy keeps its name and roles and puts
--   the full-member branch first (auth_user_full_orgs(), one hashed subplan
--   per statement, as before), so the guest branch is never evaluated for a
--   row a full member may read. The guest helpers are plpgsql and return
--   before touching any table when the caller is a guest nowhere.
--
--   Recursion: the org_members policy never queries org_members itself; every
--   helper is security definer with search_path = ''.

-- ───────────────────────────────────────────────────────────── 1. helpers
-- The caller's orgs where they are confined: an active guest, or a Mono whose
-- owner is a guest (same reading as is_org_guest / auth_user_full_orgs).
-- auth_user_orgs() = auth_user_full_orgs() ∪ auth_user_guest_orgs(), disjoint.
create function public.auth_user_guest_orgs()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select om.org_id from public.org_members om
  where om.user_id = (select auth.uid()) and om.deactivated_at is null
    and (
      om.role = 'guest'
      or (om.role = 'agent' and exists (
        select 1 from public.monos m
          join public.org_members oo on oo.org_id = m.org_id and oo.user_id = m.owner_id
        where m.user_id = om.user_id and m.org_id = om.org_id and oo.role = 'guest'
      ))
    );
$$;

-- (org_id, user_id) pairs a confined caller may see. Empty for anyone who is
-- a guest nowhere, without reading a board or folder table.
create function public.guest_visible_members()
returns table (org_id uuid, user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_orgs uuid[];
begin
  if v_uid is null then return; end if;
  select array_agg(o) into v_orgs from public.auth_user_guest_orgs() o;
  if v_orgs is null then return; end if;

  return query
  with my_folders as (
    select fm.folder_id, fm.org_id
      from public.folder_members fm
     where fm.user_id = v_uid and fm.org_id = any (v_orgs)
  ), my_boards as (
    select b.id, b.org_id, b.created_by
      from public.boards b
     where b.org_id = any (v_orgs)
       and b.id in (select public.readable_board_ids())
  )
  -- themselves
  select o, v_uid from unnest(v_orgs) o
  union
  -- members of their folders
  select f.org_id, fm.user_id
    from my_folders f
    join public.folder_members fm on fm.folder_id = f.folder_id
  union
  -- creators of their folders
  select f.org_id, fo.created_by
    from my_folders f
    join public.folders fo on fo.id = f.folder_id
   where fo.created_by is not null
  union
  -- creators of boards they can read
  select b.org_id, b.created_by from my_boards b where b.created_by is not null
  union
  -- direct grants on boards they can read (people and Monos)
  select b.org_id, bm.user_id
    from my_boards b
    join public.board_members bm on bm.board_id = b.id
  union
  -- members of the folder a readable board sits in
  select b.org_id, fm.user_id
    from my_boards b
    join public.folder_boards fb on fb.board_id = b.id
    join public.folder_members fm on fm.folder_id = fb.folder_id;
end $$;

-- Workspaces a confined caller may see: those holding one of their folders or
-- a board they can read.
create function public.guest_visible_workspace_ids()
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_orgs uuid[];
begin
  if v_uid is null then return; end if;
  select array_agg(o) into v_orgs from public.auth_user_guest_orgs() o;
  if v_orgs is null then return; end if;

  return query
  select fo.workspace_id
    from public.folder_members fm
    join public.folders fo on fo.id = fm.folder_id
   where fm.user_id = v_uid and fm.org_id = any (v_orgs)
  union
  select b.workspace_id
    from public.boards b
   where b.org_id = any (v_orgs)
     and b.id in (select public.readable_board_ids());
end $$;

-- shares_org_with, minus the orgs where the caller is confined. For anyone who
-- is a guest nowhere it answers exactly what shares_org_with answers.
create function public.shares_full_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on me.org_id = them.org_id
    where me.user_id = (select auth.uid()) and them.user_id = p_user
      and me.role <> 'guest'
      and not (me.role = 'agent' and exists (
        select 1 from public.monos m
          join public.org_members oo on oo.org_id = m.org_id and oo.user_id = m.owner_id
        where m.user_id = me.user_id and m.org_id = me.org_id and oo.role = 'guest'
      ))
  );
$$;

revoke execute on function public.auth_user_guest_orgs() from public, anon;
revoke execute on function public.guest_visible_members() from public, anon;
revoke execute on function public.guest_visible_workspace_ids() from public, anon;
revoke execute on function public.shares_full_org_with(uuid) from public, anon;
grant execute on function public.auth_user_guest_orgs() to authenticated;
grant execute on function public.guest_visible_members() to authenticated;
grant execute on function public.guest_visible_workspace_ids() to authenticated;
grant execute on function public.shares_full_org_with(uuid) to authenticated;

-- ───────────────────────────────────────────────────────── 2. read policies
-- Was: org_id in (select auth_user_orgs()).
alter policy "org_members: read if member" on public.org_members
  using (
    org_id in (select public.auth_user_full_orgs())
    or (org_id, user_id) in (
      select v.org_id, v.user_id from public.guest_visible_members() v
    )
  );

-- Was: id = auth.uid() or shares_org_with(id). shares_org_with is left in
-- place (nothing else calls it) so a rollback is one alter policy.
alter policy "profiles: read self or co-members" on public.profiles
  using (
    id = (select auth.uid())
    or public.shares_full_org_with(id)
    or id in (select v.user_id from public.guest_visible_members() v)
  );

-- Was: org_id in (select auth_user_orgs()).
alter policy "workspaces: read if member" on public.workspaces
  using (
    org_id in (select public.auth_user_full_orgs())
    or id in (select public.guest_visible_workspace_ids())
  );

-- Was: is_org_member(org_id). The org_monos view is security_invoker, so it
-- follows this policy.
alter policy "monos: read if org member" on public.monos
  using (
    org_id in (select public.auth_user_full_orgs())
    or (org_id, user_id) in (
      select v.org_id, v.user_id from public.guest_visible_members() v
    )
  );

-- Was: is_org_member(org_id). A guest reads none of it. The app's AI calls
-- read this table with the service client (gateway, entitlement), so the
-- features a guest may use on a shared board keep working.
alter policy org_ai_settings_select_member on public.org_ai_settings
  using (org_id in (select public.auth_user_full_orgs()));
