-- Guests see what they were given. Org-wide surfaces that were gated only by
-- org membership are now for non-guest members. Board data is untouched: it is
-- gated by the can_read_board family.

create function public.auth_user_full_orgs()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_members
  where user_id = (select auth.uid()) and deactivated_at is null and role <> 'guest';
$$;
revoke execute on function public.auth_user_full_orgs() from public, anon;
grant execute on function public.auth_user_full_orgs() to authenticated;

-- ── reads
alter policy "goals: read if member" on public.goals
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "goal_links: read if member" on public.goal_links
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "portfolios: read if member" on public.portfolios
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "portfolio_boards: read if member" on public.portfolio_boards
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "member_capacity: read if member" on public.member_capacity
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "org_workload_settings: read if member" on public.org_workload_settings
  using (org_id in (select public.auth_user_full_orgs()));
alter policy "time_allocations: read if member" on public.time_allocations
  using (
    org_id in (select public.auth_user_full_orgs())
    or (user_id = (select auth.uid()) and org_id in (select public.auth_user_orgs()))
  );
alter policy reports_select_member on public.reports
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));

-- A guest reads only the dashboards attached to a folder they are a member of.
alter policy "dashboards: read if member" on public.dashboards
  using (
    org_id in (select public.auth_user_orgs())
    and (
      not public.is_org_guest(org_id)
      or (folder_id is not null and public.is_folder_member(folder_id))
    )
  );
alter policy "dashboard_widgets: read if member" on public.dashboard_widgets
  using (
    org_id in (select public.auth_user_orgs())
    and (
      not public.is_org_guest(org_id)
      or exists (
        select 1 from public.dashboards d
        where d.id = dashboard_widgets.dashboard_id
          and d.folder_id is not null
          and public.is_folder_member(d.folder_id)
      )
    )
  );

-- ── writes on dashboards, widgets and reports
alter policy "dashboards: insert if member" on public.dashboards
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboards: update if member" on public.dashboards
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboards: delete if member" on public.dashboards
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboard_widgets: insert if member" on public.dashboard_widgets
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboard_widgets: update if member" on public.dashboard_widgets
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy "dashboard_widgets: delete if member" on public.dashboard_widgets
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy reports_delete_member on public.reports
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id));
alter policy reports_update_member on public.reports
  using (public.is_org_member(org_id) and not public.is_org_guest(org_id))
  with check (
    public.is_org_member(org_id)
    and not public.is_org_guest(org_id)
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (portfolio_id is null or public.portfolio_in_org(portfolio_id, org_id))
  );

-- ── a guest creates nothing at org level. One trigger instead of rewriting
-- create_board, create_board_from_template, create_dashboard, duplicate_dashboard.
create function public.tg_block_guest_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and public.is_org_guest(new.org_id) then
    raise exception 'guests cannot create this here' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_block_guest_insert() from public, anon, authenticated;

create trigger boards_block_guest_insert before insert on public.boards
  for each row execute function public.tg_block_guest_insert();
create trigger workspaces_block_guest_insert before insert on public.workspaces
  for each row execute function public.tg_block_guest_insert();
create trigger dashboards_block_guest_insert before insert on public.dashboards
  for each row execute function public.tg_block_guest_insert();
create trigger goals_block_guest_insert before insert on public.goals
  for each row execute function public.tg_block_guest_insert();
create trigger portfolios_block_guest_insert before insert on public.portfolios
  for each row execute function public.tg_block_guest_insert();
create trigger reports_block_guest_insert before insert on public.reports
  for each row execute function public.tg_block_guest_insert();
