-- Phase 7a: Portfolios. Org-wide (no workspace_id) exec roll-up of boards.
-- Mirrors boards/dashboards conventions: denormalized org_id, is_org_member
-- RLS, set_updated_at trigger, position float8, SECURITY DEFINER RPCs that
-- derive org_id. Editing is gated by can_edit_portfolio (creator or org
-- owner/admin). portfolio_rollup returns RAW aggregates; progress % and health
-- are derived in TypeScript (src/lib/portfolios/rollup.ts).

create type public.portfolio_priority as enum ('low', 'medium', 'high', 'critical');
create type public.portfolio_health as enum ('on_track', 'at_risk', 'off_track');

-- ── portfolios ────────────────────────────────────────────────────────────
create table public.portfolios (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  description text,
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index portfolios_org_id_idx on public.portfolios (org_id);

create trigger portfolios_set_updated_at
  before update on public.portfolios
  for each row execute function public.set_updated_at();

-- ── portfolio_boards ──────────────────────────────────────────────────────
create table public.portfolio_boards (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  portfolio_id    uuid not null references public.portfolios (id) on delete cascade,
  board_id        uuid not null references public.boards (id) on delete cascade,
  position        double precision not null default 0,
  owner_user_id   uuid references auth.users (id) on delete set null,
  priority        public.portfolio_priority,
  budget          numeric,
  health_override public.portfolio_health,
  status_note     text check (status_note is null or char_length(status_note) <= 280),
  done_column_id  uuid references public.columns (id) on delete set null,
  done_option_ids jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (portfolio_id, board_id)
);
create index portfolio_boards_portfolio_id_idx on public.portfolio_boards (portfolio_id);
create index portfolio_boards_board_id_idx on public.portfolio_boards (board_id);

create trigger portfolio_boards_set_updated_at
  before update on public.portfolio_boards
  for each row execute function public.set_updated_at();

-- ── edit gate: creator OR org owner/admin ───────────────────────────────────
create or replace function public.can_edit_portfolio(p_portfolio_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
    where p.id = p_portfolio_id
      and (
        p.created_by = (select auth.uid())
        or public.has_org_role(p.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;
grant execute on function public.can_edit_portfolio(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.portfolios enable row level security;
create policy "portfolios: read if member" on public.portfolios
  for select using (public.is_org_member(org_id));
create policy "portfolios: insert if member" on public.portfolios
  for insert with check (public.is_org_member(org_id));
create policy "portfolios: update if editor" on public.portfolios
  for update using (public.can_edit_portfolio(id))
  with check (public.can_edit_portfolio(id));
create policy "portfolios: delete if editor" on public.portfolios
  for delete using (public.can_edit_portfolio(id));

alter table public.portfolio_boards enable row level security;
create policy "portfolio_boards: read if member" on public.portfolio_boards
  for select using (public.is_org_member(org_id));
create policy "portfolio_boards: insert if editor" on public.portfolio_boards
  for insert with check (public.can_edit_portfolio(portfolio_id));
create policy "portfolio_boards: update if editor" on public.portfolio_boards
  for update using (public.can_edit_portfolio(portfolio_id))
  with check (public.can_edit_portfolio(portfolio_id));
create policy "portfolio_boards: delete if editor" on public.portfolio_boards
  for delete using (public.can_edit_portfolio(portfolio_id));

-- ── create_portfolio ─────────────────────────────────────────────────────────
create or replace function public.create_portfolio(p_name text)
returns public.portfolios
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_row    public.portfolios;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Org-wide object: derive the caller's (single) org membership.
  select org_id into v_org_id from public.org_members
  where user_id = v_uid limit 1;
  if v_org_id is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;

  insert into public.portfolios (org_id, name, created_by)
  values (v_org_id, p_name, v_uid)
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_portfolio(text) to authenticated;

-- ── add_portfolio_board (caps at 200; requires can_read_board) ────────────────
create or replace function public.add_portfolio_board(
  p_portfolio_id   uuid,
  p_board_id       uuid,
  p_done_column_id uuid,
  p_done_option_ids jsonb
) returns public.portfolio_boards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_count  int;
  v_pos    double precision;
  v_row    public.portfolio_boards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.portfolios where id = p_portfolio_id;
  if v_org_id is null then
    raise exception 'portfolio not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_portfolio(p_portfolio_id) then
    raise exception 'no edit access to this portfolio' using errcode = '42501';
  end if;
  if not public.can_read_board(p_board_id) then
    raise exception 'no read access to this board' using errcode = '42501';
  end if;
  select count(*) into v_count from public.portfolio_boards
  where portfolio_id = p_portfolio_id;
  if v_count >= 200 then
    raise exception 'portfolio is full (200 boards max)' using errcode = '54000';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos
  from public.portfolio_boards where portfolio_id = p_portfolio_id;

  insert into public.portfolio_boards
    (org_id, portfolio_id, board_id, position, done_column_id, done_option_ids)
  values
    (v_org_id, p_portfolio_id, p_board_id, v_pos, p_done_column_id,
     coalesce(p_done_option_ids, '[]'::jsonb))
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.add_portfolio_board(uuid, uuid, uuid, jsonb) to authenticated;

-- ── portfolio_rollup: RAW aggregates per VISIBLE board ────────────────────────
-- Excludes subitems (parent_id is null). "done" = item has a cell on the
-- placement's done_column_id whose optionId ∈ done_option_ids. Timeline uses
-- coalesce(end, date) across date-kind columns; overdue = not-done items whose
-- latest such date < p_today. Health/progress are derived in TS.
create or replace function public.portfolio_rollup(
  p_portfolio_id uuid,
  p_today        date
) returns table (
  board_id       uuid,
  name           text,
  total_items    bigint,
  done_items     bigint,
  timeline_start date,
  timeline_end   date,
  overdue_items  bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.portfolios where id = p_portfolio_id;
  if v_org_id is null then
    raise exception 'portfolio not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  return query
  with pb as (
    select pb.board_id, pb.done_column_id,
           coalesce(pb.done_option_ids, '[]'::jsonb) as done_option_ids
    from public.portfolio_boards pb
    where pb.portfolio_id = p_portfolio_id
      and public.can_read_board(pb.board_id)
  ),
  it as (
    select pb.board_id, i.id as item_id, pb.done_column_id, pb.done_option_ids,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id
          and cv.column_id = pb.done_column_id
          and pb.done_option_ids ? (cv.value ->> 'optionId')
      ) as is_done,
      (
        select max(coalesce((cv.value ->> 'end'), (cv.value ->> 'date'))::date)
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and (cv.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      ) as item_end,
      (
        select min((cv.value ->> 'date')::date)
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and (cv.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
      ) as item_start
    from pb
    join public.items i on i.board_id = pb.board_id and i.parent_id is null
  )
  select
    b.id as board_id,
    b.name,
    count(it.item_id) as total_items,
    count(it.item_id) filter (where it.is_done) as done_items,
    min(it.item_start) as timeline_start,
    max(it.item_end) as timeline_end,
    count(it.item_id) filter (
      where not it.is_done and it.item_end is not null and it.item_end < p_today
    ) as overdue_items
  from pb
  join public.boards b on b.id = pb.board_id
  left join it on it.board_id = pb.board_id
  group by b.id, b.name;
end; $$;
grant execute on function public.portfolio_rollup(uuid, date) to authenticated;
