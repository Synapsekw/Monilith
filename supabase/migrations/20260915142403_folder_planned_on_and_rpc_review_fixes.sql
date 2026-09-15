-- 20260915142403_folder_planned_on_and_rpc_review_fixes.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Whole-branch review fixes for the folder command center's read RPCs
--   (20260915084611, 20260915091205, 20260915112812, 20260915115118) plus one
--   new tenancy trigger. Additive only: no table, column, policy or row is
--   dropped; the one `drop function` below is immediately re-created in the
--   same transactional migration (see note 1).
--
--   1. TWO dates per item, not one (review finding I5).
--      `_folder_item_flags.due_on` is min(coalesce(value->>'end',
--      value->>'date')) across every date-kind column on the board. That is
--      the RIGHT rule for OVERDUE — an item is late the moment its EARLIEST
--      date has passed, and it is exactly what `_board_health_flags` uses for
--      past_due_from/overdue_since, so the two agree.
--
--      It is the WRONG rule for "when is this PLANNED to finish". On a board
--      with a Start column AND a Deadline column, min() returns Start, so on
--      the day work kicks off every item reads as "planned by today", inside
--      `due_this_week`, and drags `min_due`/`max_due` and the burn chart's
--      planned line a whole sprint to the left.
--
--      Fix: `_folder_item_flags` now returns BOTH.
--        · due_on     = EARLIEST date across the item's date columns
--                       → "the earliest date has passed" → overdue.
--        · planned_on = LATEST   date across the item's date columns
--                       → "the latest date is the commitment" → planned.
--      The five plan-shaped buckets in `folder_rollup`
--      (planned_by_today, due_this_week, due_this_week_not_started, min_due,
--      max_due) and `folder_burn.planned` switch to `planned_on`; every
--      overdue-shaped read keeps `due_on`. A single-date board is unaffected:
--      min() and max() over one value are the same value.
--
--      planned_on aggregates with max(_parse_iso_date(...)) rather than
--      due_on's _parse_iso_date(max(...)): a junk cell value ("TBD") sorts
--      ABOVE every ISO date as text, so a text-level max() would win and then
--      parse to null, silently dropping the item out of every planned bucket.
--      Parsing first and taking max() of the resulting dates ignores the junk.
--      (due_on's text-level min() is left exactly as it was — it mirrors
--      `_board_health_flags`'s own past_due_from expression, and junk sorting
--      high cannot win a min().)
--
--      Adding a column to a `returns table` IS a return-type change, which
--      `create or replace` refuses, so `_folder_item_flags` is dropped and
--      re-created. That is safe and non-destructive: it is an internal helper
--      (revoked from public/anon/authenticated), its callers reference it only
--      from inside string function bodies (no tracked dependency), and the
--      drop+create pair runs inside this one migration.
--
--   2. folder_workload routed items on a board with NO people column into the
--      Unassigned (null uid) row, while `folder_rollup.unassigned` and
--      `folder_attention`'s 'unassigned' reason both require
--      `has_people_col`. The People tab therefore reported "Unassigned: 12"
--      for a board that has no way to assign anyone. Fixed: the null-uid
--      branch is gated on `f.has_people_col`, so an ownerless item on a
--      people-column-less board contributes NO workload row at all — the same
--      rule the other two RPCs already apply.
--
--   3. folder_burn's 104-week clamp anchored BOTH ends on max(week), so a
--      single typo'd date (2099-01-01) pushed the whole window a lifetime into
--      the future and the chart came back empty. The window is now anchored on
--      TODAY: hi = greatest(max(week), this week) capped at 52 weeks after
--      this week; lo = greatest(min(week), hi - 103 weeks), never past hi.
--      Events outside the window fold into the first/last bucket (before:
--      only the first), so cumulative totals stay exact either way.
--
--   4. folder_attention's ORDER BY ended at item_name, so two open items with
--      the same severity, age and name had undefined relative order — and the
--      LIMIT then picked between them non-deterministically. Added
--      `r.item_id asc` as the final tiebreak.
--
--   5. folders.workspace_id / folders.org_id were mutable by UPDATE. Moving a
--      folder to another workspace orphans every `folder_boards` placement
--      (the boards stay in the old workspace) and a cross-ORG move would
--      strand `dashboards.folder_id` rows behind the composite FK. There is no
--      product affordance for either move — renaming and re-ordering are the
--      only folder mutations — so a `before update` trigger raises
--      check_violation (23514) instead of letting the write through.

-- ── 1. Per-item flags: due_on (earliest) + planned_on (latest) ──────────────
-- Internal helper; dropped only to widen its `returns table` (note 1).
drop function if exists public._folder_item_flags(uuid);

create function public._folder_item_flags(p_folder_id uuid)
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
  planned_on date,
  done_on date,
  overdue_since date,
  last_touched timestamptz,
  owner_ids text[]
)
language sql stable security definer set search_path = '' as $$
  with fb as (
    select b.id, b.name, fbd.position
    from public.folder_boards fbd
    join public.boards b on b.id = fbd.board_id
    where fbd.folder_id = p_folder_id
      and b.id in (select public._folder_readable_boards(p_folder_id))
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
        order by c.position asc limit 1) as people_col
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
    -- OVERDUE date: the EARLIEST date across EVERY date-kind column on the
    -- item's board — the same rule (and the same text-level min) that
    -- _board_health_flags uses for past_due_from/overdue_since, so the two
    -- never disagree about whether an item is late.
    (select public._parse_iso_date(
              min(coalesce(cv.value ->> 'end', cv.value ->> 'date')))
       from public.cell_values cv
       join public.columns c on c.id = cv.column_id and c.kind = 'date'
      where cv.item_id = i.id) as due_on,
    -- PLAN date: the LATEST date across those same columns. On a
    -- Start + Deadline board this is the Deadline; on a single-date board it
    -- is the same value due_on reports. Parsed BEFORE the max() so a junk
    -- cell value can't out-sort every real date and null the whole item out
    -- of the plan buckets (see migration note 1).
    (select max(public._parse_iso_date(
                  coalesce(cv.value ->> 'end', cv.value ->> 'date')))
       from public.cell_values cv
       join public.columns c on c.id = cv.column_id and c.kind = 'date'
      where cv.item_id = i.id) as planned_on,
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

-- ── 2. folder_rollup: the five plan-shaped buckets read planned_on ──────────
-- overdue/oldest_overdue keep due_on (via is_overdue/overdue_since); only the
-- "when is this due to FINISH" buckets move. See migration note 1.
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
    join public.boards b on b.id = fbd.board_id
    where fbd.folder_id = p_folder_id
      and b.id in (select public._folder_readable_boards(p_folder_id))
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
    count(f.item_id) filter (where f.planned_on <= current_date)::int,
    count(f.item_id) filter (where not f.is_done
      and f.planned_on >= date_trunc('week', current_date)::date
      and f.planned_on <  (date_trunc('week', current_date) + interval '7 days')::date)::int,
    count(f.item_id) filter (where not f.is_done and not f.has_status
      and f.planned_on >= date_trunc('week', current_date)::date
      and f.planned_on <  (date_trunc('week', current_date) + interval '7 days')::date)::int,
    min(f.overdue_since) filter (where f.is_overdue),
    min(f.planned_on),
    max(f.planned_on)
  from fb
  left join public.groups g on g.board_id = fb.id and g.archived_at is null
  left join flags f on f.group_id = g.id
  group by fb.id, fb.name, fb.position, g.id, g.name, g.color, g.position
  order by fb.position asc, fb.name asc, fb.id asc,
           g.position asc nulls last, g.name asc, g.id asc;
end; $$;

revoke execute on function public.folder_rollup(uuid) from public, anon;
grant execute on function public.folder_rollup(uuid) to authenticated;

-- ── 3. folder_attention: deterministic final tiebreak ───────────────────────
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
  order by r.severity desc, r.age_days desc, r.item_name asc, r.item_id asc
  limit v_limit;
end; $$;

revoke execute on function public.folder_attention(uuid, integer) from public, anon;
grant execute on function public.folder_attention(uuid, integer) to authenticated;

-- ── 4. folder_burn: planned_on buckets + a TODAY-anchored 104-week window ───
create or replace function public.folder_burn(p_folder_id uuid)
returns table (
  stage_key text,
  week_start date,
  planned integer,
  completed integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  ),
  ev as (
    -- PLANNED finishes bucket on planned_on (the LATEST date on the item),
    -- not due_on (the earliest) — see migration note 1.
    select lower(trim(f.group_name)) as sk,
           date_trunc('week', f.planned_on)::date as wk,
           1 as planned, 0 as completed
    from flags f
    where f.planned_on is not null
    union all
    select lower(trim(f.group_name)),
           date_trunc('week', f.done_on)::date,
           0, 1
    from flags f
    where f.is_done and f.done_on is not null
  ),
  bounds as (
    select min(e.wk) as min_wk, max(e.wk) as max_wk from ev e
  ),
  -- The window is anchored on TODAY, never on max(week): one typo'd 2099 date
  -- used to drag both ends of the clamp with it and empty the chart. hi is at
  -- least this week and at most 52 weeks out; lo is at most 103 weeks before
  -- hi (104 buckets inclusive) and never past hi.
  span as (
    select
      b.min_wk,
      least(
        greatest(b.max_wk, date_trunc('week', current_date)::date),
        (date_trunc('week', current_date) + interval '52 weeks')::date
      ) as hi
    from bounds b
  ),
  win as (
    select s.hi,
           least(greatest(s.min_wk, (s.hi - interval '103 weeks')::date), s.hi) as lo
    from span s
  ),
  -- Events outside the window fold into the FIRST or LAST bucket, so
  -- cumulative totals stay exact at both ends.
  clamped as (
    select e.sk, least(greatest(e.wk, w.lo), w.hi) as wk, e.planned, e.completed
    from ev e cross join win w
  ),
  stages as (
    select distinct c.sk from clamped c
  ),
  weeks as (
    select generate_series(w.lo, w.hi, interval '1 week')::date as wk
    from win w
    where w.lo is not null
  )
  select st.sk,
         wks.wk,
         coalesce(sum(c.planned), 0)::int,
         coalesce(sum(c.completed), 0)::int
  from stages st
  cross join weeks wks
  left join clamped c on c.sk = st.sk and c.wk = wks.wk
  group by st.sk, wks.wk
  order by st.sk asc, wks.wk asc;
end; $$;

revoke execute on function public.folder_burn(uuid) from public, anon;
grant execute on function public.folder_burn(uuid) to authenticated;

-- ── 5. folder_workload: no Unassigned row without a people column ───────────
-- An item with zero owners only becomes an "Unassigned" workload row when the
-- board actually HAS a people column — the same gate folder_rollup.unassigned
-- and folder_attention's 'unassigned' reason already apply (note 2). Row
-- ordering is unchanged from 20260915115118.
create or replace function public.folder_workload(p_folder_id uuid)
returns table (
  user_id text,
  board_id uuid,
  board_name text,
  stage_key text,
  stage_name text,
  open_items integer,
  overdue_items integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select * from public._folder_item_flags(p_folder_id)
  )
  select u.uid,
         f.board_id,
         f.board_name,
         lower(trim(f.group_name)),
         min(f.group_name),
         count(*)::int,
         count(*) filter (where f.is_overdue)::int
  from flags f
  cross join lateral unnest(
    case
      when cardinality(f.owner_ids) > 0 then f.owner_ids
      when f.has_people_col then array[null::text]
      else '{}'::text[]
    end
  ) as u(uid)
  where not f.is_done
  group by u.uid, f.board_id, f.board_name, lower(trim(f.group_name))
  order by u.uid asc nulls last, f.board_name asc, f.board_id asc,
           lower(trim(f.group_name)) asc;
end; $$;

revoke execute on function public.folder_workload(uuid) from public, anon;
grant execute on function public.folder_workload(uuid) to authenticated;

-- ── 6. A folder can never change workspace or org ───────────────────────────
-- Its `folder_boards` placements are workspace-scoped and its dashboards hang
-- off a composite (org_id, folder_id) FK; moving the folder would orphan both.
-- Nothing in the product moves a folder, so this is a hard stop, not a
-- cascade. 23514 (check_violation) — the same class the workspace/org
-- placement checks already raise.
create or replace function public.folders_block_tenant_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.org_id is distinct from old.org_id then
    raise exception
      'a folder cannot be moved to another workspace or organization'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists folders_block_tenant_move on public.folders;
create trigger folders_block_tenant_move
  before update on public.folders
  for each row execute function public.folders_block_tenant_move();
