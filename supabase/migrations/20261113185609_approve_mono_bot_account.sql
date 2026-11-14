-- Personal Monos, Plan 2A fix: creating a Mono failed with account_not_approved.
-- GoTrue's admin createUser writes app_metadata after the auth.users insert, so
-- handle_new_user saw no pre_approved flag and queued the bot for approval.
-- create_mono now approves the bot's account itself (service-role only; the
-- bot is verified by its mono-<id>@monolith.internal email first).

create or replace function public.create_mono(
  p_org_id uuid, p_owner_id uuid, p_mono_id uuid, p_name text, p_color text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_existing uuid; v_email text;
begin
  select m.user_id into v_existing from public.monos m
   where m.org_id = p_org_id and m.owner_id = p_owner_id;
  if v_existing is not null then return v_existing; end if;

  if not exists (
    select 1 from public.org_members om
      join public.profiles p on p.id = om.user_id
     where om.org_id = p_org_id and om.user_id = p_owner_id
       and om.deactivated_at is null and om.role <> 'agent' and not p.is_agent
  ) then
    raise exception 'owner is not an active person in this org' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = p_mono_id;
  if v_email is distinct from 'mono-' || p_mono_id::text || '@monolith.internal' then
    raise exception 'not a Mono bot user' using errcode = '42501';
  end if;
  if exists (select 1 from public.org_members om where om.user_id = p_mono_id)
     or exists (select 1 from public.monos m where m.user_id = p_mono_id) then
    raise exception 'that bot user is already in use' using errcode = '42501';
  end if;

  insert into public.monos (user_id, org_id, owner_id, name, color, brain)
  values (p_mono_id, p_org_id, p_owner_id, btrim(p_name), lower(p_color),
          public._mono_brain_for(p_owner_id))
  on conflict (org_id, owner_id) do nothing;
  if not found then
    select m.user_id into v_existing from public.monos m
     where m.org_id = p_org_id and m.owner_id = p_owner_id;
    return v_existing;
  end if;

  update public.profiles set is_agent = true, full_name = btrim(p_name) where id = p_mono_id;
  -- GoTrue's admin createUser inserts the auth row before it writes
  -- app_metadata, so handle_new_user never sees pre_approved and files the bot
  -- as pending; org_members_require_approved_account then refuses it. A Mono
  -- is a system identity this service-role-only function has just verified,
  -- so approve its account here, before the membership insert.
  insert into public.account_approvals (user_id, status, decided_at)
  values (p_mono_id, 'approved', now())
  on conflict (user_id) do update
    set status = 'approved', decided_at = coalesce(public.account_approvals.decided_at, now());
  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_mono_id, 'agent');
  return p_mono_id;
end $$;

revoke execute on function public.create_mono(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_mono(uuid, uuid, uuid, text, text) to service_role;
