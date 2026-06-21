-- Phase 6d-1: relation column kind. Enum value added in its own migration so it
-- is committed before any migration references it (alter type … add value cannot
-- be used in the same transaction that uses the new value). Mirrors 6c's
-- 20260620000000_time_tracking_enum.sql.
alter type public.column_kind add value if not exists 'relation';
