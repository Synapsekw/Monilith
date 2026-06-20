-- Platform admin: list orgs where the target user is the ONLY active owner.
-- Powers block-&-warn so hard-deleting a user can't strand an org with no owner.
create or replace function public.platform_user_sole_owned_orgs(p_user_id uuid)
returns table(org_id uuid, org_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select o.id, o.name
    from public.org_members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = p_user_id
      and m.role = 'owner'
      and m.deactivated_at is null
      and (
        select count(*)
        from public.org_members m2
        where m2.org_id = m.org_id
          and m2.role = 'owner'
          and m2.deactivated_at is null
      ) = 1;
end;
$$;

revoke all on function public.platform_user_sole_owned_orgs(uuid)
  from public, anon, authenticated;
grant execute on function public.platform_user_sole_owned_orgs(uuid)
  to authenticated;
