-- Cross-org reciprocal membership.
-- When a user accepts an org invite, also add the INVITER into the invitee's
-- OWNED org as a guest, so per-board sharing works in both directions without a
-- second reverse invite. Security boundary (share_board / can_read_board /
-- board_members / RLS) is unchanged: reciprocity is a real, auditable membership
-- created only inside these SECURITY DEFINER RPCs.

-- 1. accept_invitation — in-app accept path.
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

  return v_org_id;
end; $$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- 2. redeem_invitations — login-callback batch path.
create or replace function public.redeem_invitations()
returns int language plpgsql security definer set search_path = '' as $$
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
  return v_count;
end; $$;
grant execute on function public.redeem_invitations() to authenticated;
