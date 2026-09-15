-- 20260915091205_folder_rollup_rpcs_review_fixes.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Task review fixes for 20260915084611_folder_rollup_rpcs.sql. Every
--   function below is `create or replace` (additive, no drops):
--
--   1. _folder_item_flags.due_on read only the board's FIRST date column.
--      _board_health_flags (20260727094245) derives overdue from ALL date
--      columns on the board. On a board with two date columns (e.g. Start at
--      position 0, Deadline at position 1), an item could be flagged overdue
--      by _board_health_flags off the Deadline column while due_on here kept
--      reporting Start — the date buckets (due_this_week, planned_by_today,
--      min_due/max_due) and the overdue flag would disagree for the same
--      item. Fix: due_on is now min(coalesce(value->>'end', value->>'date'))
--      across every 'date'-kind column on the item's board — the same rule
--      _board_health_flags uses for past_due_from/overdue_since. cols.date_col
--      (a single first-date-column lookup) is now unused and dropped from the
--      cols CTE.
--
--   2. _assert_folder_member raised P0002 (folder not found) for a
--      nonexistent folder but 42501 (not a member) for a real folder in
--      another org — that split is a cross-org existence oracle, exactly the
--      class 20260915082905_shared_folders_read_gate_and_org_fk removed from
--      folder_boards. Collapsed to ONE code: P0002 "folder not found" for
--      BOTH "no such folder" and "folder exists but I'm not a member of its
--      org". Task 5 maps P0002 to a generic not-found response; the message
--      stays deliberately generic.
--
--   3. Extracted the board read-gate that was duplicated verbatim in
--      _folder_item_flags's and folder_rollup's `fb` CTEs into one internal
--      helper, _folder_readable_boards(p_folder_id) returns setof uuid —
--      board is in the folder, not archived, AND caller can read it
--      (readable_board_ids(), the set form of can_read_board per Task 1's
--      review). Both functions now filter fb.id against this helper instead
--      of repeating the archived/readable predicate.
--
--   4. folder_rollup's ORDER BY had no tiebreak beyond fb.position/g.position
--      — two boards (or two groups) at the same position had undefined
--      relative order. Added (fb.name, fb.id) and (g.name, g.id) tiebreaks so
--      the row order is fully deterministic.
--
--   No return-type changes: every function keeps its committed signature, so
--   this migration needs a types regen only if a Postgres function OID/shape
--   fingerprint changed (harmless either way — regenerated as part of this
--   task regardless).

-- ── _folder_readable_boards: the board read-gate, in one place ──────────────
-- A board counts for a folder iff: it's still linked (folder_boards), not
-- archived, and the caller can read it (readable_board_ids() — Task 1 review:
-- prefer the set form over a per-row can_read_board(id) scalar call when
-- filtering a SET of boards, which is exactly what both callers below do).
-- Boards the caller cannot read are excluded, not raised — a private board in
-- a shared folder simply does not count.
create or replace function public._folder_readable_boards(p_folder_id uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select b.id
  from public.folder_boards fbd
  join public.boards b on b.id = fbd.board_id and b.archived_at is null
  where fbd.folder_id = p_folder_id
    and b.id in (select public.readable_board_ids())
$$;

revoke execute on function public._folder_readable_boards(uuid) from public, anon, authenticated;

-- ── Guard shared by the public folder RPCs ──────────────────────────────────
-- Collapsed to a single P0002 for both "no such folder" and "folder exists,
-- caller isn't a member of its org" — see migration note 2. Do not reintroduce
-- a distinct not-a-member code from this helper: that reopens the existence
-- oracle Task 1's review closed for folder_boards.
create or replace function public._assert_folder_member(p_folder_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.folders where id = p_folder_id;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
end; $$;

revoke execute on function public._assert_folder_member(uuid) from public, anon, authenticated;

-- ── Per-item flags across the folder's READABLE boards ──────────────────────
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
    -- Earliest date across EVERY date-kind column on the item's board, same
    -- rule _board_health_flags uses for past_due_from/overdue_since (finding 1).
    (select public._parse_iso_date(
              min(coalesce(cv.value ->> 'end', cv.value ->> 'date')))
       from public.cell_values cv
       join public.columns c on c.id = cv.column_id and c.kind = 'date'
      where cv.item_id = i.id) as due_on,
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
-- Added deterministic tiebreaks (fb.name/fb.id, g.name/g.id) — see note 4.
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
  order by fb.position asc, fb.name asc, fb.id asc,
           g.position asc nulls last, g.name asc, g.id asc;
end; $$;

revoke execute on function public.folder_rollup(uuid) from public, anon;
grant execute on function public.folder_rollup(uuid) to authenticated;
