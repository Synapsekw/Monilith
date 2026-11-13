-- Personal Monos, Plan 2A / unit I follow-up: profiles.is_agent is now
-- security-relevant (the org_members agent guard, prune_mono_sessions), but
-- "profiles: update self" lets any signed-in user write it. Freeze it, and an
-- agent profile's full_name, to privileged callers.
--
-- Privileged = current_user is postgres / supabase_admin / service_role. Our
-- SECURITY DEFINER functions (create_mono, update_my_mono, handle_new_user)
-- are owned by postgres, so inside them current_user is postgres and they
-- keep working. The trigger function itself is deliberately SECURITY INVOKER:
-- as a definer, current_user would always be its owner and the check would
-- pass for everyone.
--
-- A trigger, not a column revoke: authenticated holds TABLE-level UPDATE on
-- profiles, which a column-level revoke cannot narrow (it is a silent no-op),
-- and narrowing the table grant would touch every other profile column.
create or replace function public.tg_profiles_freeze_agent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_agent then
      raise exception 'is_agent can only be set by the system' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.is_agent is distinct from old.is_agent then
    raise exception 'is_agent can only be changed by the system' using errcode = '42501';
  end if;
  if old.is_agent and new.full_name is distinct from old.full_name then
    raise exception 'a Mono is renamed through update_my_mono' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_profiles_freeze_agent() from public, anon, authenticated;

create trigger profiles_freeze_agent
  before insert or update on public.profiles
  for each row execute function public.tg_profiles_freeze_agent();
