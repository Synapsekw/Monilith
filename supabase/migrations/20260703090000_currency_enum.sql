-- MVP Final item 1: add the currency (money) column kind.
-- Enum-only migration: ALTER TYPE ... ADD VALUE must commit before any later
-- statement references the new value (PG can't use a value added in the same
-- txn). Mirrors 20260623000000_percent_enum.sql and the relation/mirror/
-- time_tracking enum migrations.
-- Currency cells store { "amount": <number> } jsonb; the ISO 4217 code lives
-- in columns.settings ({ "currency": "USD" }) — fixed per column so sums are
-- always single-currency (the summary-row feature, MVP item 2, depends on this).
alter type public.column_kind add value if not exists 'currency';
