-- 20260806060855_upsert_time_allocation_rpc.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds public.upsert_time_allocation(...) — the ONE write path for manual
--   time-card cells, shared by the /time Server Action and the MCP
--   `log_time_allocation` tool.
--
-- WHY a function at all (the bug this fixes):
--   time_allocations is keyed by two PARTIAL unique indexes —
--     time_allocations_user_day_item_uidx     (user_id, work_date, item_id)     WHERE item_id  IS NOT NULL
--     time_allocations_user_day_category_uidx (user_id, work_date, category)    WHERE category IS NOT NULL
--   PostgreSQL can only infer a partial unique index when the ON CONFLICT
--   arbiter REPEATS the index predicate. PostgREST's `on_conflict=` query
--   parameter — what supabase-js `.upsert(…, { onConflict })` emits — cannot
--   express a WHERE clause, so every such call failed at plan time with
--   42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
--   specification". Verified on DEV 2026-08-06:
--     on conflict (user_id, work_date, item_id)                        -> 42P10
--     on conflict (user_id, work_date, item_id) where item_id not null -> planned
--   i.e. manual time entry was broken for real users, not just for MCP.
--   Writing the upsert in SQL is the only place the predicate can be stated.
--
-- SECURITY INVOKER, deliberately: RLS is the security boundary and stays so.
--   Every statement below runs under the CALLER's policies
--   ("time_allocations: insert self" / "update self" / "delete self", which
--   confine org membership, self-ownership and the cross-org item/board FKs).
--   The function adds NO privilege — it only supplies SQL syntax PostgREST
--   cannot.
--
-- user_id comes from auth.uid() INSIDE the function and is NOT a parameter,
-- so writing another user's time is structurally impossible rather than
-- merely policy-enforced (same posture as get_my_work_items).
--
-- Two behaviours beyond the raw upsert, both matching what the UI already
-- promises:
--   * board_id is DERIVED from the item when the caller omits it, and the
--     UPDATE branch never overwrites a stored non-null board_id with null.
--     Otherwise an MCP correction of a /time-logged entry silently drops the
--     board and workload_actuals_rollup stops attributing those hours to it.
--   * duration_secs = 0 DELETES the row and returns null, mirroring
--     src/lib/validations/time.ts ("clear the cell to remove time") and the
--     existing deleteTimeAllocation action — 0 would otherwise violate
--     check (duration_secs > 0).

create or replace function public.upsert_time_allocation(
  p_org_id        uuid,
  p_work_date     date,
  p_duration_secs integer,
  p_item_id       uuid default null,
  p_board_id      uuid default null,
  p_category      text default null,
  p_note          text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  v_user_id  uuid := (select auth.uid());
  v_board_id uuid := p_board_id;
  v_secs     integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  -- Mirrors constraint time_allocations_item_xor_category, but as a clear
  -- message instead of a raw constraint-violation string.
  if (p_item_id is not null) = (p_category is not null) then
    raise exception 'Provide exactly one of item id or category.'
      using errcode = '22023';
  end if;

  if p_duration_secs is null or p_duration_secs < 0 then
    raise exception 'duration_secs must be zero or greater.'
      using errcode = '22023';
  end if;

  -- 0 = clear the cell. Returns null so the caller can tell "cleared" from
  -- "stored n seconds".
  if p_duration_secs = 0 then
    delete from public.time_allocations ta
    where ta.user_id = v_user_id
      and ta.work_date = p_work_date
      and (
        (p_item_id is not null and ta.item_id = p_item_id)
        or (p_category is not null and ta.category = p_category)
      );
    return null;
  end if;

  if p_item_id is not null then
    -- Derive the denormalized board from the item when not supplied. RLS on
    -- public.items means an unreadable item yields null, and the insert's
    -- item_in_org WITH CHECK then rejects the row anyway.
    if v_board_id is null then
      select i.board_id into v_board_id
      from public.items i
      where i.id = p_item_id;
    end if;

    insert into public.time_allocations as ta (
      org_id, user_id, work_date, item_id, board_id, category, duration_secs, note
    )
    values (
      p_org_id, v_user_id, p_work_date, p_item_id, v_board_id, null, p_duration_secs, p_note
    )
    on conflict (user_id, work_date, item_id) where item_id is not null
    do update set
      org_id        = excluded.org_id,
      -- never demote a stored board_id back to null
      board_id      = coalesce(excluded.board_id, ta.board_id),
      duration_secs = excluded.duration_secs,
      note          = excluded.note
    returning ta.duration_secs into v_secs;
  else
    insert into public.time_allocations as ta (
      org_id, user_id, work_date, item_id, board_id, category, duration_secs, note
    )
    values (
      p_org_id, v_user_id, p_work_date, null, null, p_category, p_duration_secs, p_note
    )
    on conflict (user_id, work_date, category) where category is not null
    do update set
      org_id        = excluded.org_id,
      duration_secs = excluded.duration_secs,
      note          = excluded.note
    returning ta.duration_secs into v_secs;
  end if;

  return v_secs;
end;
$func$;

-- anon executes NOTHING (20260621130000_lockdown_definer_execution_and_perf.sql):
-- strip the CREATE FUNCTION default PUBLIC grant before granting authenticated.
revoke all on function public.upsert_time_allocation(uuid, date, integer, uuid, uuid, text, text)
  from public, anon;
grant execute on function public.upsert_time_allocation(uuid, date, integer, uuid, uuid, text, text)
  to authenticated;
