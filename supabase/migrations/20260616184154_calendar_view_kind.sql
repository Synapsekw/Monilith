-- Phase 3b (Calendar slice): add the 'calendar' board view kind.
-- ALTER TYPE ADD VALUE is additive and is NOT used as a value within this
-- migration, so it is safe to run in a transaction (Postgres 12+).
-- The 'timeline' kind + item_dependencies model land in the Timeline migration.
alter type public.view_kind add value if not exists 'calendar';
