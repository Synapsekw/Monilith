-- Phase 5b-1: optional "If" condition gate + item_created trigger lookup index.
-- The `condition` jsonb mirrors the dashboards listFilter shape:
--   { "combinator": "and"|"or", "conditions": [ { columnId, operator, value } ] }
-- NULL or empty `conditions` ⇒ the rule always passes (no gate).
alter table public.automations
  add column condition jsonb;

-- item_created rules carry no columnId, so the existing
-- automations_trigger_col_idx does not serve them — add a dedicated partial index.
create index automations_item_created_idx
  on public.automations (board_id)
  where enabled and (trigger ->> 'type') = 'item_created';
