-- 20261113171749_mono_assign_guard_upsert.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Fixes cell_values_guard_mono_assign (20261113170824) for upserts. The app
--   (upsertCellCore, _automation_run) writes People cells with INSERT … ON
--   CONFLICT DO UPDATE; BEFORE INSERT fires before the conflict is detected, so
--   the guard saw an empty baseline and treated every Mono already in the cell
--   as newly added: teammates' edits to that cell failed with 42501, and an
--   asleep Mono blocked even its owner's edits (P0001). On INSERT the baseline
--   is now the existing row's value. Every rule is kept: only the signed-in
--   owner adds their Mono, an added Mono must be awake, removals are free, and
--   the owner adding their Mono puts it on the board. The trigger itself is
--   unchanged (create or replace of its function only).

create or replace function public.tg_cell_values_guard_mono_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_old_value jsonb;
  v_new text[] := '{}';
  v_old text[] := '{}';
  r record;
begin
  if (select c.kind from public.columns c where c.id = new.column_id)
       is distinct from 'people'::public.column_kind then
    return new;
  end if;
  if jsonb_typeof(new.value -> 'userIds') = 'array' then
    select coalesce(array_agg(x), '{}') into v_new
      from jsonb_array_elements_text(new.value -> 'userIds') as t(x);
  end if;
  -- Baseline: OLD on UPDATE; on INSERT the row an upsert (INSERT … ON CONFLICT
  -- DO UPDATE) is about to hit, since BEFORE INSERT fires before the conflict
  -- is detected. Only Monos that are truly added are checked.
  if tg_op = 'UPDATE' then
    v_old_value := old.value;
  else
    select cv.value into v_old_value from public.cell_values cv
     where cv.item_id = new.item_id and cv.column_id = new.column_id;
  end if;
  if jsonb_typeof(v_old_value -> 'userIds') = 'array' then
    select coalesce(array_agg(x), '{}') into v_old
      from jsonb_array_elements_text(v_old_value -> 'userIds') as t(x);
  end if;
  for r in
    select m.user_id, m.owner_id, m.brain from public.monos m
     where m.user_id::text = any (v_new) and not (m.user_id::text = any (v_old))
  loop
    if v_uid is null or v_uid <> r.owner_id then
      raise exception 'only its owner can assign a Mono' using errcode = '42501';
    end if;
    -- Only an ADDED Mono must be awake; one already in the cell that has since
    -- fallen asleep never blocks edits to the cell.
    if r.brain = 'none' then
      raise exception 'this Mono is asleep. Give it a brain before assigning it'
        using errcode = 'P0001';
    end if;
    -- The owner can edit this board (RLS let the write through), so their Mono
    -- may join it; board_members_guard_mono sets the level.
    insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
    values (new.org_id, new.board_id, r.user_id, 'viewer', r.owner_id)
    on conflict (board_id, user_id) do nothing;
  end loop;
  return new;
end $$;
revoke execute on function public.tg_cell_values_guard_mono_assign() from public, anon, authenticated;
