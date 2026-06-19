-- Phase 8 (D1): cross-board dashboards. Workspace-scoped, org-RLS. Mirrors
-- boards-core conventions: denormalized org_id, is_org_member RLS, set_updated_at
-- trigger, position float8, SECURITY DEFINER create-RPCs that derive org_id.

-- ── dashboards ──────────────────────────────────────────────────────────────
create table public.dashboards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 100),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index dashboards_workspace_id_idx on public.dashboards (workspace_id);
create index dashboards_org_id_idx on public.dashboards (org_id);

create trigger dashboards_set_updated_at
  before update on public.dashboards
  for each row execute function public.set_updated_at();

alter table public.dashboards enable row level security;

create policy "dashboards: read if member" on public.dashboards
  for select using (public.is_org_member(org_id));
create policy "dashboards: insert if member" on public.dashboards
  for insert with check (public.is_org_member(org_id));
create policy "dashboards: update if member" on public.dashboards
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "dashboards: delete if member" on public.dashboards
  for delete using (public.is_org_member(org_id));

-- ── dashboard_widgets ───────────────────────────────────────────────────────
create type public.widget_kind as enum ('number', 'chart', 'battery', 'list');

create table public.dashboard_widgets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  dashboard_id    uuid not null references public.dashboards (id) on delete cascade,
  source_board_id uuid references public.boards (id) on delete set null,
  kind            public.widget_kind not null,
  title           text not null default '' check (char_length(title) between 0 and 100),
  config          jsonb not null default '{}'::jsonb,
  layout          jsonb not null default '{}'::jsonb,
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index dashboard_widgets_dashboard_id_idx on public.dashboard_widgets (dashboard_id);
create index dashboard_widgets_org_id_idx on public.dashboard_widgets (org_id);

create trigger dashboard_widgets_set_updated_at
  before update on public.dashboard_widgets
  for each row execute function public.set_updated_at();

alter table public.dashboard_widgets enable row level security;

create policy "dashboard_widgets: read if member" on public.dashboard_widgets
  for select using (public.is_org_member(org_id));
create policy "dashboard_widgets: insert if member" on public.dashboard_widgets
  for insert with check (public.is_org_member(org_id));
create policy "dashboard_widgets: update if member" on public.dashboard_widgets
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "dashboard_widgets: delete if member" on public.dashboard_widgets
  for delete using (public.is_org_member(org_id));

-- ── RPC: create_dashboard (derive org from workspace, membership-checked) ─────
create or replace function public.create_dashboard(p_workspace_id uuid, p_name text)
returns public.dashboards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_row    public.dashboards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.workspaces where id = p_workspace_id;
  if v_org_id is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.dashboards (org_id, workspace_id, name, created_by)
  values (v_org_id, p_workspace_id, p_name, v_uid)
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_dashboard(uuid, text) to authenticated;

-- ── RPC: create_dashboard_widget (derive org from dashboard, position=max+1) ──
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
grant execute on function public.create_dashboard_widget(uuid, public.widget_kind, uuid, text, jsonb, jsonb)
  to authenticated;

-- ── RPC: set_widget_layouts (batch layout persist, one round-trip) ────────────
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
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  update public.dashboard_widgets w
  set layout = jsonb_build_object('x', e.x, 'y', e.y, 'w', e.w, 'h', e.h)
  from jsonb_to_recordset(p_layouts)
    as e(id uuid, x int, y int, w int, h int)
  where w.id = e.id and w.dashboard_id = p_dashboard_id;
end; $$;
grant execute on function public.set_widget_layouts(uuid, jsonb) to authenticated;

-- ── RPC: dashboard_aggregate (the spine — count/sum/avg, optional grouping) ───
-- Returns ≤ K rows. group_key null = ungrouped (whole board) OR the "no value"
-- bucket. Grouping in D1 supports status (value->>'optionId'); dropdown/people
-- array grouping is added in D2. count counts items; sum/avg operate on the
-- numbers cell (value->>'n') of p_value_column_id. LEFT JOIN keeps empty cells.
create or replace function public.dashboard_aggregate(
  p_board_id        uuid,
  p_group_column_id uuid  default null,
  p_value_column_id uuid  default null,
  p_agg             text  default 'count'
) returns table (group_key text, metric numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if p_agg not in ('count', 'sum', 'avg') then
    raise exception 'invalid agg %', p_agg using errcode = '22023';
  end if;

  return query
  with rows as (
    select
      (gcv.value ->> 'optionId') as gkey,
      (vcv.value ->> 'n')::numeric as nval
    from public.items i
    left join public.cell_values gcv
      on gcv.item_id = i.id and gcv.column_id = p_group_column_id
    left join public.cell_values vcv
      on vcv.item_id = i.id and vcv.column_id = p_value_column_id
    where i.board_id = p_board_id
  )
  select
    (case when p_group_column_id is null then null else gkey end) as group_key,
    (case p_agg
       when 'count' then count(*)::numeric
       when 'sum'   then coalesce(sum(nval), 0)
       when 'avg'   then coalesce(avg(nval), 0)
     end) as metric
  from rows
  group by (case when p_group_column_id is null then null else gkey end);
end; $$;
grant execute on function public.dashboard_aggregate(uuid, uuid, uuid, text) to authenticated;
