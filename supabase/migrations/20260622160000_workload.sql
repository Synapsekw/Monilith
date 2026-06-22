-- Phase 7c: Workload / capacity. Org-wide per-member effort-vs-capacity view.
-- No new "assignment" data: assignments are READ from existing people/date/
-- time_tracking cell_values. We persist only per-member capacity + org defaults.
-- Mirrors portfolios/goals conventions: denormalized org_id, is_org_member RLS,
-- set_updated_at trigger, SECURITY DEFINER rollup returning RAW rows (bucketing
-- + capacity math live in TypeScript: src/lib/workload/rollup.ts).

-- ── member_capacity (sparse: a row only when a member customizes) ────────────
create table public.member_capacity (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  hours_per_day numeric not null default 8 check (hours_per_day >= 0 and hours_per_day <= 24),
  working_days  smallint[] not null default '{1,2,3,4,5}'::smallint[],
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, user_id)
);
create index member_capacity_org_id_idx on public.member_capacity (org_id);

create trigger member_capacity_set_updated_at
  before update on public.member_capacity
  for each row execute function public.set_updated_at();

-- ── org_workload_settings (one row per org; defaults for un-customized members)
create table public.org_workload_settings (
  org_id                 uuid primary key references public.organizations (id) on delete cascade,
  default_hours_per_day  numeric not null default 8 check (default_hours_per_day >= 0 and default_hours_per_day <= 24),
  default_per_item_hours numeric not null default 4 check (default_per_item_hours >= 0),
  default_working_days   smallint[] not null default '{1,2,3,4,5}'::smallint[],
  updated_at             timestamptz not null default now()
);

create trigger org_workload_settings_set_updated_at
  before update on public.org_workload_settings
  for each row execute function public.set_updated_at();

-- ── edit gate: self OR org owner/admin ──────────────────────────────────────
create or replace function public.can_edit_member_capacity(p_org_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select (
    p_user_id = (select auth.uid())
    or public.has_org_role(p_org_id, array['owner', 'admin']::public.org_role[])
  );
$$;
grant execute on function public.can_edit_member_capacity(uuid, uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.member_capacity enable row level security;
create policy "member_capacity: read if member" on public.member_capacity
  for select using (public.is_org_member(org_id));
create policy "member_capacity: insert if editor" on public.member_capacity
  for insert with check (public.can_edit_member_capacity(org_id, user_id));
create policy "member_capacity: update if editor" on public.member_capacity
  for update using (public.can_edit_member_capacity(org_id, user_id))
  with check (public.can_edit_member_capacity(org_id, user_id));
create policy "member_capacity: delete if editor" on public.member_capacity
  for delete using (public.can_edit_member_capacity(org_id, user_id));

alter table public.org_workload_settings enable row level security;
create policy "org_workload_settings: read if member" on public.org_workload_settings
  for select using (public.is_org_member(org_id));
create policy "org_workload_settings: write if admin" on public.org_workload_settings
  for all using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- ── workload_rollup: RAW (item, assignee, date-range, estimate) rows ─────────
-- One bounded read for the caller's org over the [p_from, p_to] horizon.
-- Resolves each board's date column (first 'date' kind) and the item's
-- time_tracking estimate cell. Unnests people cell userIds → one row per
-- (item, assignee); items with no assignee yield a single user_id = NULL row.
-- Excludes subitems. Gated by is_org_member + can_read_board (no leak).
create or replace function public.workload_rollup(p_from date, p_to date)
returns table (
  item_id       uuid,
  board_id      uuid,
  item_name     text,
  user_id       uuid,
  start_date    date,
  end_date      date,
  estimate_secs bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with date_col as (
    -- first date column per readable, in-org board
    select distinct on (c.board_id) c.board_id, c.id as column_id
    from public.columns c
    join public.boards b on b.id = c.board_id
    where c.kind = 'date'
      and public.is_org_member(b.org_id)
      and public.can_read_board(c.board_id)
    order by c.board_id, c.position, c.id
  ),
  dated as (
    select
      i.id as item_id,
      i.board_id,
      i.name as item_name,
      (dv.value ->> 'date')::date as start_date,
      coalesce((dv.value ->> 'end')::date, (dv.value ->> 'date')::date) as end_date,
      -- estimate from the item's time_tracking cell, if any
      (
        select (cv.value ->> 'estimateSeconds')::bigint
        from public.cell_values cv
        join public.columns tc on tc.id = cv.column_id and tc.kind = 'time_tracking'
        where cv.item_id = i.id
        limit 1
      ) as estimate_secs,
      -- assignee userIds from the item's people cell, if any
      (
        select pv.value -> 'userIds'
        from public.cell_values pv
        join public.columns pc on pc.id = pv.column_id and pc.kind = 'people'
        where pv.item_id = i.id
        limit 1
      ) as user_ids
    from date_col dc
    join public.items i on i.board_id = dc.board_id and i.parent_id is null
    join public.cell_values dv on dv.item_id = i.id and dv.column_id = dc.column_id
    where (dv.value ->> 'date') is not null
      -- overlap test against the horizon
      and (dv.value ->> 'date')::date <= p_to
      and coalesce((dv.value ->> 'end')::date, (dv.value ->> 'date')::date) >= p_from
  )
  select d.item_id, d.board_id, d.item_name,
         (u.uid)::uuid as user_id,
         d.start_date, d.end_date, d.estimate_secs
  from dated d
  left join lateral (
    select value::text as uid
    from jsonb_array_elements_text(coalesce(d.user_ids, '[]'::jsonb)) as value
  ) u on true
  limit 5000;
end; $$;
grant execute on function public.workload_rollup(date, date) to authenticated;
