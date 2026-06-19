-- provision_account: atomically create an org + owner membership + a default
-- "Main" workspace for the calling user, on first confirmed sign-in.
-- Idempotent: if the caller already belongs to an org, return it untouched
-- (so a re-run of the confirmation callback never double-provisions).
-- SECURITY DEFINER mirrors create_organization: bypass RLS to seed the very
-- first membership the user could not otherwise insert.
create or replace function public.provision_account(p_org_name text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
  v_existing_org_id uuid;
  v_base text;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select org_id into v_existing_org_id
  from public.org_members
  where user_id = v_uid
  limit 1;

  if v_existing_org_id is not null then
    select * into v_org from public.organizations where id = v_existing_org_id;
    return v_org;
  end if;

  -- URL-safe slug: lowercase, non-alphanumerics to hyphens, trim, then a short
  -- uuid suffix for uniqueness against the organizations.slug unique constraint.
  v_base := regexp_replace(lower(coalesce(p_org_name, '')), '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_slug := case
    when v_base = '' then substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
    else v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
  end;

  insert into public.organizations (name, slug, created_by)
  values (p_org_name, v_slug, v_uid)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  insert into public.workspaces (org_id, name, created_by)
  values (v_org.id, 'Main', v_uid);

  return v_org;
end;
$$;

grant execute on function public.provision_account(text) to authenticated;
