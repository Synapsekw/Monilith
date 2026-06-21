-- Phase 6d-2: mirror column kind. Enum value added in its own migration so it
-- is committed before any migration/code references it (alter type … add value
-- cannot be used in the same transaction that uses the new value). Mirrors 6d-1's
-- 20260621060000_relation_enum.sql. Mirror columns store no rows of their own —
-- they derive from relation_links + the target board's cell_values.
alter type public.column_kind add value if not exists 'mirror';
