-- Time allocation: MANUAL weekly time-card entries. Timers stay in time_entries;
-- this table holds manual allocations ONLY, so summing both never double-counts.
-- Self-only writes (user_id = auth.uid()); org-wide read (Workload + item Time tab).
-- Mirrors workload conventions: denormalized org_id/board_id, is_org_member RLS,
-- set_updated_at trigger. One row per (user, day, item) or (user, day, category)
-- => editing a card cell is an UPSERT on the partial-unique index.

create table public.time_allocations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  work_date     date not null,
  item_id       uuid references public.items (id) on delete cascade,
  board_id      uuid references public.boards (id) on delete cascade,
  category      text,
  duration_secs integer not null check (duration_secs > 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- exactly one of item_id / category is populated
  constraint time_allocations_item_xor_category
    check ((item_id is not null) <> (category is not null)),
  -- a category row carries no board; an item row may carry its denormalized board
  constraint time_allocations_category_no_board
    check (category is null or board_id is null)
);

-- one row per task/day/user and per category/day/user => cell edit = upsert
create unique index time_allocations_user_day_item_uidx
  on public.time_allocations (user_id, work_date, item_id)
  where item_id is not null;
create unique index time_allocations_user_day_category_uidx
  on public.time_allocations (user_id, work_date, category)
  where category is not null;

-- hot path: a person's week
create index time_allocations_org_user_date_idx
  on public.time_allocations (org_id, user_id, work_date);
-- item Time-tab reads
create index time_allocations_item_idx
  on public.time_allocations (item_id) where item_id is not null;

create trigger time_allocations_set_updated_at
  before update on public.time_allocations
  for each row execute function public.set_updated_at();

alter table public.time_allocations enable row level security;

-- read: any org member (Workload + item Time tab show everyone)
create policy "time_allocations: read if member" on public.time_allocations
  for select to authenticated using (public.is_org_member(org_id));

-- insert/update/delete: self only, within own org
create policy "time_allocations: insert self" on public.time_allocations
  for insert to authenticated with check (
    public.is_org_member(org_id) and user_id = (select auth.uid())
  );
create policy "time_allocations: update self" on public.time_allocations
  for update to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()))
  with check (public.is_org_member(org_id) and user_id = (select auth.uid()));
create policy "time_allocations: delete self" on public.time_allocations
  for delete to authenticated
  using (public.is_org_member(org_id) and user_id = (select auth.uid()));

grant select, insert, update, delete on public.time_allocations to authenticated;

-- Index supporting the rollup's manual-leg range scan.
create index if not exists time_allocations_org_date_idx
  on public.time_allocations (org_id, work_date);

-- ── Extend workload_actuals_rollup: UNION timer + manual, summed per
-- (user, board, day). Category rows have board_id = null (off-board). Same
-- security posture (is_org_member + can_read_board) and bounded shape as before.
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
  ) merged
  group by user_id, board_id, day
  limit 5000;
$$;
grant execute on function public.workload_actuals_rollup(date, date) to authenticated;
