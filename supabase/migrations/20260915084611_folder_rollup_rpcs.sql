-- 20260915084611_folder_rollup_rpcs.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Command-center read RPCs, part 1 (spec §6). One internal per-item flag
--   function feeds every public RPC so the done/overdue/blocked/stale/
--   unassigned rules live in exactly one place and reuse _board_health_flags
--   for done/overdue/incomplete (the digest's rule).
--
--   done_on: the schema has no "status became done" timestamp, so the
--   completion date is cell_values.updated_at of the item's first-status-column
--   cell (the write that set it). item_activities could refine this later.
--
--   Board access: Task 1's review binds this (and every future) folder RPC to
--   the set-based read guard from 20260702120000_perf_set_based_rls_and_indexes.sql
--   — `b.id in (select public.readable_board_ids())` — instead of a per-row
--   scalar public.can_read_board(b.id) call, since these functions filter a SET
--   of the folder's boards (not a single p_board_id like the dashboard_* RPCs
--   guarded in 20260704110000_dashboard_rpc_board_read_guards.sql). Same
--   predicate, semijoin form: boards the caller cannot read are excluded, not
--   raised, per _folder_item_flags's own note below.
--
--   Access paths: folder_boards PK/folder index, boards PK, columns_board_id_idx,
--   items_board_id_idx (+ the archived_at partial index), cell_values PK
--   (item_id, column_id), groups PK. Bound: boards × items in the folder.

-- ── ISO date that never raises on a malformed cell value ────────────────────
create or replace function public._parse_iso_date(p text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return left(p, 10)::date;
exception when others then
  return null;
end; $$;

revoke execute on function public._parse_iso_date(text) from public, anon, authenticated;

-- ── Guard shared by the public folder RPCs ──────────────────────────────────
create or replace function public._assert_folder_member(p_folder_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.folders where id = p_folder_id;
  if v_org is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
end; $$;

revoke execute on function public._assert_folder_member(uuid) from public, anon, authenticated;

-- ── Per-item flags across the folder's READABLE boards ──────────────────────
-- Boards the caller cannot read are excluded, not raised: a private board in a
-- shared folder simply does not count. Uses the set-based read helper
-- (readable_board_ids) rather than a per-row can_read_board(b.id) scalar call
-- because this filters the folder's whole board set — see the migration note.
create or replace function public._folder_item_flags(p_folder_id uuid)
returns table (
  board_id uuid,
  board_name text,
  board_position integer,
  group_id uuid,
  group_name text,
  group_color text,
  group_position double precision,
  item_id uuid,
  item_name text,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean,
  is_blocked boolean,
  has_status boolean,
  has_people_col boolean,
  has_owner boolean,
  due_on date,
  done_on date,
  overdue_since date,
  last_touched timestamptz,
  owner_ids text[]
)
language sql stable security definer set search_path = '' as $$
  with fb as (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id and b.archived_at is null
    where fbd.folder_id = p_folder_id
      and b.id in (select public.readable_board_ids())
  ),
  cols as (
    select
      fb.id as board_id,
      (select c.id from public.columns c
        where c.board_id = fb.id and c.kind = 'status'
        order by c.position asc limit 1) as status_col,
      (select c.settings from public.columns c
        where c.board_id = fb.id and c.kind = 'status'
        order by c.position asc limit 1) as status_settings,
      (select c.id from public.columns c
        where c.board_id = fb.id and c.kind = 'people'
        order by c.position asc limit 1) as people_col,
      (select c.id from public.columns c
        where c.board_id = fb.id and c.kind = 'date'
        order by c.position asc limit 1) as date_col
    from fb
  )
  select
    fb.id,
    fb.name,
    fb.position,
    g.id,
    g.name,
    g.color,
    g.position,
    i.id,
    i.name,
    f.is_done,
    f.is_overdue,
    f.is_incomplete,
    (not f.is_done and exists (
      select 1
      from public.cell_values cv,
           jsonb_array_elements(coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
      where cv.item_id = i.id
        and cv.column_id = cols.status_col
        and opt ->> 'id' = cv.value ->> 'optionId'
        and opt ->> 'label' ~* '(blocked|stuck)'
    )) as is_blocked,
    exists (
      select 1
      from public.cell_values cv,
           jsonb_array_elements(coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
      where cv.item_id = i.id
        and cv.column_id = cols.status_col
        and opt ->> 'id' = cv.value ->> 'optionId'
    ) as has_status,
    (cols.people_col is not null) as has_people_col,
    exists (
      select 1 from public.cell_values cv
      where cv.item_id = i.id and cv.column_id = cols.people_col
        and jsonb_array_length(coalesce(cv.value -> 'userIds', '[]'::jsonb)) > 0
    ) as has_owner,
    (select public._parse_iso_date(coalesce(cv.value ->> 'end', cv.value ->> 'date'))
       from public.cell_values cv
      where cv.item_id = i.id and cv.column_id = cols.date_col) as due_on,
    case when f.is_done then
      (select cv.updated_at::date from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.status_col)
    end as done_on,
    public._parse_iso_date(f.overdue_since) as overdue_since,
    greatest(
      i.updated_at,
      coalesce((select max(cv.updated_at) from public.cell_values cv where cv.item_id = i.id), i.updated_at)
    ) as last_touched,
    coalesce(
      (select array(select jsonb_array_elements_text(coalesce(cv.value -> 'userIds', '[]'::jsonb)))
         from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.people_col),
      '{}'::text[]
    ) as owner_ids
  from fb
  join cols on cols.board_id = fb.id
  cross join lateral public._board_health_flags(fb.id) f
  join public.items i on i.id = f.item_id and i.archived_at is null
  join public.groups g on g.id = i.group_id and g.archived_at is null
$$;

revoke execute on function public._folder_item_flags(uuid) from public, anon, authenticated;

-- ── folder_rollup: one row per (board, group) ───────────────────────────────
-- A board with zero groups still yields one row (null group columns) so the
-- Boards tab can list every board; a group with zero items yields a row of
-- zeros so it still forms a stage (spec §3.4).
create or replace function public.folder_rollup(p_folder_id uuid)
returns table (
  board_id uuid,
  board_name text,
  board_position integer,
  group_id uuid,
  group_name text,
  group_color text,
  group_position double precision,
  total integer,
  done integer,
  in_progress integer,
  overdue integer,
  not_started integer,
  blocked integer,
  stale integer,
  unassigned integer,
  incomplete integer,
  planned_by_today integer,
  due_this_week integer,
  due_this_week_not_started integer,
  oldest_overdue date,
  min_due date,
  max_due date
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with fb as (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id and b.archived_at is null
    where fbd.folder_id = p_folder_id
      and b.id in (select public.readable_board_ids())
  ),
  flags as (
    select * from public._folder_item_flags(p_folder_id)
  )
  select
    fb.id,
    fb.name,
    fb.position,
    g.id,
    g.name,
    g.color,
    g.position,
    count(f.item_id)::int,
    count(f.item_id) filter (where f.is_done)::int,
    count(f.item_id) filter (where not f.is_done and not f.is_overdue and f.has_status)::int,
    count(f.item_id) filter (where f.is_overdue)::int,
    count(f.item_id) filter (where not f.is_done and not f.is_overdue and not f.has_status)::int,
    count(f.item_id) filter (where f.is_blocked)::int,
    count(f.item_id) filter (where not f.is_done and f.last_touched < now() - interval '14 days')::int,
    count(f.item_id) filter (where not f.is_done and f.has_people_col and not f.has_owner)::int,
    count(f.item_id) filter (where f.is_incomplete)::int,
    count(f.item_id) filter (where f.due_on <= current_date)::int,
    count(f.item_id) filter (where not f.is_done
      and f.due_on >= date_trunc('week', current_date)::date
      and f.due_on <  (date_trunc('week', current_date) + interval '7 days')::date)::int,
    count(f.item_id) filter (where not f.is_done and not f.has_status
      and f.due_on >= date_trunc('week', current_date)::date
      and f.due_on <  (date_trunc('week', current_date) + interval '7 days')::date)::int,
    min(f.overdue_since) filter (where f.is_overdue),
    min(f.due_on),
    max(f.due_on)
  from fb
  left join public.groups g on g.board_id = fb.id and g.archived_at is null
  left join flags f on f.group_id = g.id
  group by fb.id, fb.name, fb.position, g.id, g.name, g.color, g.position
  order by fb.position asc, g.position asc nulls last;
end; $$;

revoke execute on function public.folder_rollup(uuid) from public, anon;
grant execute on function public.folder_rollup(uuid) to authenticated;

-- ── folder_attention: top-N open items by severity, then age ────────────────
-- reason precedence: overdue (4) > blocked (3) > unassigned (2) > stale (1).
-- age_days: days overdue for overdue rows, days since last touch otherwise.
create or replace function public.folder_attention(p_folder_id uuid, p_limit integer default 20)
returns table (
  item_id uuid,
  item_name text,
  board_id uuid,
  board_name text,
  group_id uuid,
  group_name text,
  reason text,
  age_days integer,
  severity integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  ),
  reasons as (
    select
      f.item_id,
      f.item_name,
      f.board_id,
      f.board_name,
      f.group_id,
      f.group_name,
      case
        when f.is_overdue then 'overdue'
        when f.is_blocked then 'blocked'
        when f.has_people_col and not f.has_owner then 'unassigned'
        else 'stale'
      end as reason,
      case
        when f.is_overdue then 4
        when f.is_blocked then 3
        when f.has_people_col and not f.has_owner then 2
        else 1
      end as severity,
      case
        when f.is_overdue and f.overdue_since is not null then (current_date - f.overdue_since)
        else greatest(0, floor(extract(epoch from (now() - f.last_touched)) / 86400))::int
      end as age_days
    from flags f
    where not f.is_done
      and (
        f.is_overdue
        or f.is_blocked
        or (f.has_people_col and not f.has_owner)
        or f.last_touched < now() - interval '14 days'
      )
  )
  select r.item_id, r.item_name, r.board_id, r.board_name, r.group_id, r.group_name,
         r.reason, r.age_days, r.severity
  from reasons r
  order by r.severity desc, r.age_days desc, r.item_name asc
  limit v_limit;
end; $$;

revoke execute on function public.folder_attention(uuid, integer) from public, anon;
grant execute on function public.folder_attention(uuid, integer) to authenticated;
