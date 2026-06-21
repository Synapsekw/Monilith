-- Bugfix: deleting a column aborted with FK 23503.
--
-- `tg_log_cell_activity`'s DELETE branch (migration 20260619230000) guards only on
-- the ITEM still existing, to skip logging on item/board/org cascade deletes. But
-- deleting a COLUMN also cascades its `cell_values` (FK `on delete cascade`) while
-- the item survives — so the guard passed and the trigger INSERTed an
-- `item_activities` row referencing `old.column_id`. That column is being deleted
-- in the same statement, and `item_activities.column_id` is `on delete set null`
-- (not cascade), so the mid-cascade insert was rejected (SQLSTATE 23503) and the
-- whole column delete aborted. This broke the production `deleteColumn` action for
-- any column that had ever logged cell activity.
--
-- Fix: also require the COLUMN to still exist before logging the cell delete —
-- the exact analogue of the existing item guard. During a column-delete cascade
-- the column row is already gone, so logging is skipped (the activity is
-- meaningless once the column is dropped). A normal cell clear (item + column both
-- present) still logs as before.
create or replace function public.tg_log_cell_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, new_value)
    values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, new.value);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.value is distinct from old.value) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, new_value)
      values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, old.value, new.value);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if exists (select 1 from public.items where id = old.item_id)
       and exists (select 1 from public.columns where id = old.column_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value)
      values (old.org_id, old.board_id, old.item_id, (select auth.uid()), 'cell_changed', old.column_id, old.value);
    end if;
    return old;
  end if;
  return null;
end; $$;
