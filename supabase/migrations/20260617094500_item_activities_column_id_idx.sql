-- Perf advisor: index the one new non-auth FK. item_activities.column_id is
-- `references columns(id) on delete set null`; without a covering index, deleting
-- a board column seq-scans this append-only (high-growth) table to null the refs.
-- The auth.users FKs (actor_id/author_id) are intentionally left unindexed, matching
-- the existing convention (boards/organizations/workspaces.created_by) — they are
-- never hot-path filters; activity/update reads filter by the indexed item_id.
create index item_activities_column_id_idx on public.item_activities (column_id);
