-- Phase 6: add the percent (progress) column kind.
-- Enum-only migration: ALTER TYPE ... ADD VALUE must commit before any later
-- statement references the new value (PG: the value can't be used in the SAME
-- txn that adds it). Mirrors the relation/mirror/time_tracking enum migrations.
-- Percent cells store a manually-set { "percent": 0..100 } jsonb value; parent
-- rows roll up the average of their subitems' percent values when collapsed.
alter type public.column_kind add value if not exists 'percent';
