-- Perf advisor: index notifications.item_id. It's `references items(id) on
-- delete cascade`; deleting an item cascade-scans notifications to remove its
-- rows, and items are the most frequently-deleted entity. The recipient hot
-- path is already covered (notifications_recipient_idx + partial unread idx).
-- The auth.users FK (actor_id) and the rarer cascade FKs (board_id, update_id)
-- are left unindexed, matching the existing convention.
create index notifications_item_id_idx on public.notifications (item_id);
