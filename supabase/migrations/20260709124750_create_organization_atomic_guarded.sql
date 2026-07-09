-- Onboarding/org seam hardening (audit findings 2 & 3).
--
-- (2) Atomicity: the onboarding action previously created the org via this RPC
--     and then inserted the first workspace in a SECOND statement. A failed
--     insert left an org with no workspace (breaking /home's "a fresh org
--     always has one workspace from onboarding" assumption), and a retry then
--     minted a second org. Fold the workspace insert into the function so
--     org + owner membership + first workspace commit as ONE transaction.
--     The new argument defaults to NULL (no workspace), keeping every existing
--     (p_name, p_slug) call site source-compatible.
--
-- (3) Unbounded org creation: nothing DB-side stopped a caller from looping
--     this RPC to spam orgs/workspaces. Refuse when the caller already OWNS an
--     org (org_members.role = 'owner' — the membership this function itself
--     seeds). The raised message is user-facing: the onboarding action
--     surfaces P0001 messages verbatim as friendly errors.
--
-- Postgres treats an added parameter as a NEW overload, so drop the old
-- (text, text) signature first — CREATE OR REPLACE would leave both callable
-- and the 2-arg spam path open.
drop function if exists public.create_organization(text, text);

create function public.create_organization(
  p_name text,
  p_slug text,
  p_workspace_name text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- DB-side guard (finding 3): one owned org per user. The app-side gate in
  -- the onboarding action re-checks membership, but the RPC must hold on its
  -- own against direct PostgREST invocation.
  if exists (
    select 1 from public.org_members
    where user_id = v_uid and role = 'owner'
  ) then
    raise exception 'You already have an organization.';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (p_name, p_slug, v_uid)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  if p_workspace_name is not null and length(trim(p_workspace_name)) > 0 then
    insert into public.workspaces (org_id, name, created_by)
    values (v_org.id, trim(p_workspace_name), v_uid);
  end if;

  return v_org;
end;
$$;

-- Execution lockdown hygiene (20260704114000): definer functions are
-- authenticated-only, never PUBLIC/anon-callable.
revoke execute on function public.create_organization(text, text, text)
  from public, anon;
grant execute on function public.create_organization(text, text, text)
  to authenticated;
