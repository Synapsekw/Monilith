-- In-app invite acceptance: allow 'declined' status + invitee-facing RPCs.

-- 1. Relax the status check to permit 'declined'.
alter table public.org_invitations
  drop constraint if exists org_invitations_status_check;
alter table public.org_invitations
  add constraint org_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'declined'));

-- 2. Pending invitations addressed to the calling user (matched by email),
--    with the org name (which the invitee cannot read directly yet).
create function public.my_pending_invitations()
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  role public.org_role,
  created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select i.id, i.org_id, o.name, i.role, i.created_at
    from public.org_invitations i
    join public.organizations o on o.id = i.org_id
   where i.status = 'pending'
     and lower(i.email) = (
       select lower(u.email::text) from auth.users u where u.id = (select auth.uid())
     );
$$;
grant execute on function public.my_pending_invitations() to authenticated;

-- 3. Accept a specific invitation addressed to the caller's email.
create function public.accept_invitation(p_invite_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_org_id uuid;
  v_role public.org_role;
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
   returning org_id, role into v_org_id, v_role;

  if v_org_id is null then
    raise exception 'invitation not found';
  end if;

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_uid, v_role)
  on conflict (org_id, user_id) do nothing;

  return v_org_id;
end; $$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 4. Decline a specific invitation addressed to the caller's email.
create function public.decline_invitation(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(u.email::text) into v_email from auth.users u where u.id = v_uid;

  update public.org_invitations
     set status = 'declined'
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = v_email;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'invitation not found';
  end if;
end; $$;
grant execute on function public.decline_invitation(uuid) to authenticated;
