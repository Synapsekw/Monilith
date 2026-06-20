-- Phase 6b: six new column kinds. Enum ADD VALUE is committed in its own
-- migration (no statement in this file USES the new values), so the values are
-- available to later migrations/runtime once this commits. (PG15: ADD VALUE is
-- txn-safe; the value just can't be used in the SAME txn.)
alter type public.column_kind add value if not exists 'checkbox';
alter type public.column_kind add value if not exists 'rating';
alter type public.column_kind add value if not exists 'link';
alter type public.column_kind add value if not exists 'email';
alter type public.column_kind add value if not exists 'phone';
alter type public.column_kind add value if not exists 'files';
