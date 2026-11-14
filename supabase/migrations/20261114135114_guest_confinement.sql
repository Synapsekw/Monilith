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
-- Set-based: the full-org branch is first, so the folder-member check only
-- matters for guests.
alter policy "dashboards: read if member" on public.dashboards
  using (
    org_id in (select public.auth_user_full_orgs())
    or (
      org_id in (select public.auth_user_orgs())
      and folder_id is not null
      and public.is_folder_member(folder_id)
    )
  );
alter policy "dashboard_widgets: read if member" on public.dashboard_widgets
  using (
    org_id in (select public.auth_user_full_orgs())
    or (
      org_id in (select public.auth_user_orgs())
      and exists (
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

-- ── workload actuals: a guest gets only their own time rows (both legs).
-- Body unchanged from 20260623123519 apart from the guest predicate.
create or replace function public.workload_actuals_rollup(p_from date, p_to date)
returns table (
  user_id  uuid,
  board_id uuid,
  day      date,
  secs     bigint
)
language sql security definer set search_path = '' as $$
  select user_id, board_id, day, sum(secs)::bigint as secs
  from (
    -- timer leg (completed entries only)
    select
      te.user_id,
      te.board_id,
      te.started_at::date as day,
      te.duration_secs::bigint as secs
    from public.time_entries te
    join public.boards b on b.id = te.board_id
    where te.ended_at is not null
      and te.duration_secs is not null
      and te.started_at::date >= p_from
      and te.started_at::date <= p_to
      and public.is_org_member(b.org_id)
      and public.can_read_board(te.board_id)
      and (not public.is_org_guest(b.org_id) or te.user_id = (select auth.uid()))

    union all

    -- manual leg: item rows attribute to their board; category rows have
    -- board_id = null and still count toward the person's utilization total.
    select
      ta.user_id,
      ta.board_id,
      ta.work_date as day,
      ta.duration_secs::bigint as secs
    from public.time_allocations ta
    left join public.boards b on b.id = ta.board_id
    where ta.work_date >= p_from
      and ta.work_date <= p_to
      and public.is_org_member(ta.org_id)
      -- item rows: only when the board is readable; category rows (board null) pass
      and (ta.board_id is null or public.can_read_board(ta.board_id))
      and (not public.is_org_guest(ta.org_id) or ta.user_id = (select auth.uid()))
  ) merged
  group by user_id, board_id, day
  limit 5000;
$$;

-- ── dashboard widget RPCs are security definer and only checked membership.
create or replace function public.create_dashboard_widget(
  p_dashboard_id    uuid,
  p_kind            public.widget_kind,
  p_source_board_id uuid,
  p_title           text default '',
  p_config          jsonb default '{}'::jsonb,
  p_layout          jsonb default '{}'::jsonb
) returns public.dashboard_widgets
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_pos    double precision;
  v_row    public.dashboard_widgets;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.dashboards where id = p_dashboard_id;
  if v_org_id is null then
    raise exception 'dashboard not found' using errcode = 'P0002';
  end if;
  if public.is_org_guest(v_org_id) then
    raise exception 'guests cannot change dashboards' using errcode = '42501';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- source board must belong to the same org (when provided)
  if p_source_board_id is not null
     and not exists (select 1 from public.boards b
                     where b.id = p_source_board_id and b.org_id = v_org_id) then
    raise exception 'source board not in org' using errcode = '42501';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos
  from public.dashboard_widgets where dashboard_id = p_dashboard_id;

  insert into public.dashboard_widgets
    (org_id, dashboard_id, source_board_id, kind, title, config, layout, position)
  values
    (v_org_id, p_dashboard_id, p_source_board_id, p_kind, coalesce(p_title, ''),
     coalesce(p_config, '{}'::jsonb), coalesce(p_layout, '{}'::jsonb), v_pos)
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.set_widget_layouts(p_dashboard_id uuid, p_layouts jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.dashboards where id = p_dashboard_id;
  if v_org_id is null then
    raise exception 'dashboard not found' using errcode = 'P0002';
  end if;
  if public.is_org_guest(v_org_id) then
    raise exception 'guests cannot change dashboards' using errcode = '42501';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  update public.dashboard_widgets w
  set layout = jsonb_build_object('x', e.x, 'y', e.y, 'w', e.w, 'h', e.h)
  from jsonb_to_recordset(p_layouts)
    as e(id uuid, x int, y int, w int, h int)
  where w.id = e.id and w.dashboard_id = p_dashboard_id;
end; $$;

-- ── edit gates: a guest never edits a goal or portfolio, even one they
-- created or own. These gate goals/portfolios/goal_links/portfolio_boards writes.
create or replace function public.can_edit_goal(p_goal_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id
      and not public.is_org_guest(g.org_id)
      and (
        g.created_by = (select auth.uid())
        or g.owner_id = (select auth.uid())
        or public.has_org_role(g.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;

create or replace function public.can_edit_portfolio(p_portfolio_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
    where p.id = p_portfolio_id
      and not public.is_org_guest(p.org_id)
      and (
        p.created_by = (select auth.uid())
        or public.has_org_role(p.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;

-- ── a guest may log their own time, but only against boards they can read.
alter policy "time_allocations: insert self" on public.time_allocations
  with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (item_id is null or public.item_in_org(item_id, org_id))
    and (not public.is_org_guest(org_id) or (board_id is not null and public.can_read_board(board_id)))
  );
alter policy "time_allocations: update self" on public.time_allocations
  using (public.is_org_member(org_id) and user_id = (select auth.uid()))
  with check (
    public.is_org_member(org_id)
    and user_id = (select auth.uid())
    and (board_id is null or public.board_in_org(board_id, org_id))
    and (item_id is null or public.item_in_org(item_id, org_id))
    and (not public.is_org_guest(org_id) or (board_id is not null and public.can_read_board(board_id)))
  );
