-- Phase 7b: Goals/OKRs. Recursive, person-owned, org-wide goal tree.
-- Mirrors portfolios/boards conventions: denormalized org_id, is_org_member
-- RLS, set_updated_at trigger, position float8, SECURITY DEFINER RPCs.
-- Editing gated by can_edit_goal (creator OR owner OR org owner/admin).
-- goals_rollup returns RAW board aggregates for auto_boards goals; progress %
-- and auto-health are derived in TypeScript (src/lib/goals/progress.ts).

create type public.goal_progress_mode as enum
  ('manual_number', 'manual_percent', 'auto_subgoals', 'auto_boards');
create type public.goal_status as enum
  ('on_track', 'at_risk', 'off_track', 'done');

-- ── goals ─────────────────────────────────────────────────────────────────
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 200),
  description    text,
  owner_id       uuid not null references auth.users (id),
  workspace_id   uuid references public.workspaces (id) on delete set null,
  parent_goal_id uuid references public.goals (id) on delete cascade,
  progress_mode  public.goal_progress_mode not null,
  status         public.goal_status not null default 'on_track',
  start_value    double precision,
  current_value  double precision,
  target_value   double precision,
  unit           text check (unit is null or char_length(unit) <= 40),
  percent        double precision check (percent is null or (percent >= 0 and percent <= 100)),
  start_date     date,
  due_date       date,
  position       double precision not null default 0,
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index goals_org_id_idx on public.goals (org_id);
create index goals_parent_goal_id_idx on public.goals (parent_goal_id);

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ── hierarchy guard: same-org parent/workspace, no cycle, depth ≤ 6 ─────────
create or replace function public.tg_goals_validate_hierarchy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cur       uuid;
  v_cur_org   uuid;
  v_depth     int := 0;
begin
  if new.workspace_id is not null
     and not exists (
       select 1 from public.workspaces w
       where w.id = new.workspace_id and w.org_id = new.org_id
     ) then
    raise exception 'workspace must belong to the same organization'
      using errcode = '23514';
  end if;

  if new.parent_goal_id is not null then
    if new.parent_goal_id = new.id then
      raise exception 'a goal cannot be its own parent' using errcode = '23514';
    end if;
    v_cur := new.parent_goal_id;
    while v_cur is not null loop
      v_depth := v_depth + 1;
      if v_cur = new.id then
        raise exception 'goal hierarchy cannot contain a cycle' using errcode = '23514';
      end if;
      if v_depth > 6 then
        raise exception 'goal hierarchy too deep (max 6 levels)' using errcode = '23514';
      end if;
      select parent_goal_id, org_id into v_cur, v_cur_org
      from public.goals where id = v_cur;
      if v_cur_org is not null and v_cur_org <> new.org_id then
        raise exception 'parent goal must belong to the same organization'
          using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end; $$;

create trigger goals_validate_hierarchy
  before insert or update on public.goals
  for each row execute function public.tg_goals_validate_hierarchy();

-- ── goal_links (board contributions for auto_boards) ────────────────────────
create table public.goal_links (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  goal_id         uuid not null references public.goals (id) on delete cascade,
  board_id        uuid not null references public.boards (id) on delete cascade,
  done_column_id  uuid references public.columns (id) on delete set null,
  done_option_ids jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  unique (goal_id, board_id)
);
create index goal_links_goal_id_idx on public.goal_links (goal_id);
create index goal_links_board_id_idx on public.goal_links (board_id);

-- ── edit gate: creator OR owner OR org owner/admin ──────────────────────────
create or replace function public.can_edit_goal(p_goal_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.goals g
    where g.id = p_goal_id
      and (
        g.created_by = (select auth.uid())
        or g.owner_id = (select auth.uid())
        or public.has_org_role(g.org_id, array['owner', 'admin']::public.org_role[])
      )
  );
$$;
grant execute on function public.can_edit_goal(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.goals enable row level security;
create policy "goals: read if member" on public.goals
  for select using (public.is_org_member(org_id));
create policy "goals: insert if member" on public.goals
  for insert with check (public.is_org_member(org_id));
create policy "goals: update if editor" on public.goals
  for update using (public.can_edit_goal(id)) with check (public.can_edit_goal(id));
create policy "goals: delete if editor" on public.goals
  for delete using (public.can_edit_goal(id));

alter table public.goal_links enable row level security;
create policy "goal_links: read if member" on public.goal_links
  for select using (public.is_org_member(org_id));
create policy "goal_links: write if editor" on public.goal_links
  for all using (public.can_edit_goal(goal_id)) with check (public.can_edit_goal(goal_id));

-- ── create_goal (derives caller org; created_by = caller) ───────────────────
create or replace function public.create_goal(
  p_name           text,
  p_progress_mode  public.goal_progress_mode,
  p_owner_id       uuid,
  p_parent_goal_id uuid,
  p_workspace_id   uuid,
  p_status         public.goal_status,
  p_start_value    double precision,
  p_current_value  double precision,
  p_target_value   double precision,
  p_unit           text,
  p_percent        double precision,
  p_start_date     date,
  p_due_date       date
) returns public.goals
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_row    public.goals;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.org_members where user_id = v_uid limit 1;
  if v_org_id is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;

  insert into public.goals (
    org_id, name, progress_mode, owner_id, parent_goal_id, workspace_id,
    status, start_value, current_value, target_value, unit, percent,
    start_date, due_date, created_by
  ) values (
    v_org_id, p_name, p_progress_mode, coalesce(p_owner_id, v_uid), p_parent_goal_id,
    p_workspace_id, coalesce(p_status, 'on_track'), p_start_value, p_current_value,
    p_target_value, p_unit, p_percent, p_start_date, p_due_date, v_uid
  ) returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_goal(
  text, public.goal_progress_mode, uuid, uuid, uuid, public.goal_status,
  double precision, double precision, double precision, text, double precision, date, date
) to authenticated;

-- ── set_goal_links (atomic replace; gated; each board needs can_read_board) ──
create or replace function public.set_goal_links(p_goal_id uuid, p_links jsonb)
returns setof public.goal_links
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_link   record;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.goals where id = p_goal_id;
  if v_org_id is null then
    raise exception 'goal not found' using errcode = 'P0002';
  end if;
  if not public.can_edit_goal(p_goal_id) then
    raise exception 'no edit access to this goal' using errcode = '42501';
  end if;

  delete from public.goal_links where goal_id = p_goal_id;

  for v_link in
    select * from jsonb_to_recordset(coalesce(p_links, '[]'::jsonb))
      as x(board_id uuid, done_column_id uuid, done_option_ids jsonb)
  loop
    if not public.can_read_board(v_link.board_id) then
      raise exception 'no read access to board %', v_link.board_id using errcode = '42501';
    end if;
    insert into public.goal_links (org_id, goal_id, board_id, done_column_id, done_option_ids)
    values (v_org_id, p_goal_id, v_link.board_id, v_link.done_column_id,
            coalesce(v_link.done_option_ids, '[]'::jsonb));
  end loop;

  return query select * from public.goal_links where goal_id = p_goal_id order by board_id;
end; $$;
revoke all on function public.set_goal_links(uuid, jsonb) from public;
grant execute on function public.set_goal_links(uuid, jsonb) to authenticated;

-- ── goals_rollup: RAW per-board aggregates for auto_boards goals ─────────────
-- One bounded read for the caller's org. "done" = item has a cell on the
-- link's done_column_id whose optionId ∈ done_option_ids. Excludes subitems.
create or replace function public.goals_rollup()
returns table (goal_id uuid, board_id uuid, total_items bigint, done_items bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with gl as (
    select gl.goal_id, gl.board_id, gl.done_column_id,
           coalesce(gl.done_option_ids, '[]'::jsonb) as done_option_ids
    from public.goal_links gl
    join public.goals g on g.id = gl.goal_id and g.progress_mode = 'auto_boards'
    where public.is_org_member(gl.org_id)
      and public.can_read_board(gl.board_id)
  ),
  it as (
    select gl.goal_id, gl.board_id, i.id as item_id,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id
          and cv.column_id = gl.done_column_id
          and gl.done_option_ids ? (cv.value ->> 'optionId')
      ) as is_done
    from gl
    join public.items i on i.board_id = gl.board_id and i.parent_id is null
  )
  select gl.goal_id, gl.board_id,
    count(it.item_id) as total_items,
    count(it.item_id) filter (where it.is_done) as done_items
  from gl
  left join it on it.goal_id = gl.goal_id and it.board_id = gl.board_id
  group by gl.goal_id, gl.board_id;
end; $$;
grant execute on function public.goals_rollup() to authenticated;
