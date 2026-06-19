-- A user clearing a cell deletes its cell_values row (item stays) → log it.
-- A cascade delete (item/board/org being removed) also deletes cell_values, but
-- the parent item is gone — logging then both is meaningless and violates
-- item_activities' (item_id/board_id/org_id) FKs. Guard on the item existing.
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
    if exists (select 1 from public.items where id = old.item_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value)
      values (old.org_id, old.board_id, old.item_id, (select auth.uid()), 'cell_changed', old.column_id, old.value);
    end if;
    return old;
  end if;
  return null;
end; $$;
