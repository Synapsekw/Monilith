-- 20260915112812_folder_burn_workload_gallery.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Command-center read RPCs, part 2 (spec §6): planned-vs-completed burn
--   buckets per stage and ISO week, per-person workload, and the /dashboards
--   gallery counts. All three read public._folder_item_flags.
--
--   Burn buckets are CONTIGUOUS weeks (generate_series over the folder's own
--   span), so the client never has to fill gaps. The span is clamped to the
--   most recent 104 weeks; events before the clamp fold into the first bucket
--   so cumulative totals stay exact. "Completed" date for a done item is the
--   status column's cell_values.updated_at (the moment the status cell was
--   last written), not the item's own updated_at — same source
--   _folder_item_flags.done_on already uses.
--
--   Review rulings applied here (carried forward from
--   20260915091205_folder_rollup_rpcs_review_fixes.sql's collapse of
--   _assert_folder_member to a single P0002):
--
--   1. Single not-found code. folder_burn and folder_workload guard with
--      _assert_folder_member, which already raises only P0002 for both "no
--      such folder" and "folder exists, caller isn't a member of its org" —
--      nothing new to collapse there. folder_gallery's own workspace guard
--      (it takes a workspace id, not a folder id, so it can't reuse
--      _assert_folder_member) previously split "workspace not found" (P0002)
--      from "not a member" (42501) exactly like the folder guard used to —
--      the same cross-org existence oracle. Collapsed to ONE P0002 for both.
--
--   2. Never count or expose boards/items the caller cannot read.
--      folder_gallery's board_count now comes from
--      count(*) from public._folder_readable_boards(fo.id) — the one board
--      read-gate helper — instead of re-inlining can_read_board. Its
--      item/done/overdue/attention counts already only ever see readable
--      boards, because _folder_item_flags itself filters through
--      _folder_readable_boards internally. A folder holding boards the
--      caller cannot read therefore reports counts for the readable subset
--      only, never raises, and never reveals that a hidden board exists.

-- ── folder_burn ─────────────────────────────────────────────────────────────
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
    select lower(trim(f.group_name)) as sk,
           date_trunc('week', f.due_on)::date as wk,
           1 as planned, 0 as completed
    from flags f
    where f.due_on is not null
    union all
    select lower(trim(f.group_name)),
           date_trunc('week', f.done_on)::date,
           0, 1
    from flags f
    where f.is_done and f.done_on is not null
  ),
  span as (
    select greatest(min(e.wk), (max(e.wk) - interval '103 weeks')::date) as lo,
           max(e.wk) as hi
    from ev e
  ),
  clamped as (
    select e.sk, greatest(e.wk, s.lo) as wk, e.planned, e.completed
    from ev e cross join span s
  ),
  stages as (
    select distinct c.sk from clamped c
  ),
  weeks as (
    select generate_series(s.lo, s.hi, interval '1 week')::date as wk
    from span s
    where s.lo is not null
  )
  select st.sk,
         w.wk,
         coalesce(sum(c.planned), 0)::int,
         coalesce(sum(c.completed), 0)::int
  from stages st
  cross join weeks w
  left join clamped c on c.sk = st.sk and c.wk = w.wk
  group by st.sk, w.wk
  order by st.sk asc, w.wk asc;
end; $$;

revoke execute on function public.folder_burn(uuid) from public, anon;
grant execute on function public.folder_burn(uuid) to authenticated;

-- ── folder_workload: open items per person × board × stage ──────────────────
-- An item with N owners counts once per owner (the same "workload" semantic as
-- dashboard_series' people dimension); an item with no owner lands on the
-- null user row, which the People tab renders as "Unassigned".
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
    case when cardinality(f.owner_ids) = 0 then array[null::text] else f.owner_ids end
  ) as u(uid)
  where not f.is_done
  group by u.uid, f.board_id, f.board_name, lower(trim(f.group_name))
  order by u.uid asc nulls last, f.board_name asc;
end; $$;

revoke execute on function public.folder_workload(uuid) from public, anon;
grant execute on function public.folder_workload(uuid) to authenticated;

-- ── folder_gallery: per-folder counts for one workspace ─────────────────────
-- Guard collapsed to a single P0002 for both "no such workspace" and
-- "workspace exists, caller isn't a member of its org" — see migration
-- ruling 1 above. Do not reintroduce a distinct not-a-member code here: that
-- reopens the existence oracle 20260915091205 closed for _assert_folder_member.
create or replace function public.folder_gallery(p_workspace_id uuid)
returns table (
  folder_id uuid,
  folder_name text,
  folder_position integer,
  board_count integer,
  item_count integer,
  done_count integer,
  overdue_count integer,
  attention_count integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.workspaces where id = p_workspace_id;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  return query
  select fo.id,
         fo.name,
         fo.position,
         (select count(*)::int from public._folder_readable_boards(fo.id)),
         count(f.item_id)::int,
         count(f.item_id) filter (where f.is_done)::int,
         count(f.item_id) filter (where f.is_overdue)::int,
         count(f.item_id) filter (where not f.is_done and (
           f.is_overdue
           or f.is_blocked
           or (f.has_people_col and not f.has_owner)
           or f.last_touched < now() - interval '14 days'
         ))::int
  from public.folders fo
  left join lateral public._folder_item_flags(fo.id) f on true
  where fo.workspace_id = p_workspace_id
  group by fo.id, fo.name, fo.position
  order by fo.position asc, fo.name asc;
end; $$;

revoke execute on function public.folder_gallery(uuid) from public, anon;
grant execute on function public.folder_gallery(uuid) to authenticated;
