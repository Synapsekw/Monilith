-- Phase 6c: add the time_tracking column kind.
-- Enum-only migration: ALTER TYPE ... ADD VALUE must commit before any later
-- statement (the time_entries table / start_timer RPC) references it.
-- (PG15: ADD VALUE is txn-safe; the value just can't be used in the SAME txn.)
alter type public.column_kind add value if not exists 'time_tracking';
