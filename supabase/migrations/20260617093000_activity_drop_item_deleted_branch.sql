-- Phase 4a fix: drop the `item_deleted` branch from tg_log_item_activity.
--
-- `item_activities.item_id` is `references items(id) on delete cascade`, so the
-- AFTER DELETE trigger's INSERT referencing the just-deleted item violates the
-- FK and aborts the whole DELETE. And even if it inserted, the cascade would
-- immediately remove it — an `item_deleted` row can never persist here. Since
-- the audit log is cascade-coupled to the item, deletion already removes the
-- item's history, so logging the deletion is futile. Remove the branch so item
-- deletion (when wired) succeeds. Durable delete-audit (set-null + nullable
-- item_id) is deferred to a later hardening pass. The `item_deleted` enum value
-- is kept for forward-compatibility; it is simply no longer written.
create or replace function public.tg_log_item_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value)
    values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_created',
            jsonb_build_object('name', new.name));
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.name is distinct from old.name) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value, new_value)
      values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_renamed',
              to_jsonb(old.name), to_jsonb(new.name));
    end if;
    if (new.group_id is distinct from old.group_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, old_value, new_value)
      values (new.org_id, new.board_id, new.id, (select auth.uid()), 'item_moved',
              to_jsonb(old.group_id), to_jsonb(new.group_id));
    end if;
    return new;
  end if;
  return null;
end; $$;
