-- Phase 2c (Column management): per-column width for the resizable Table view.
-- NULL renders at the default value-column width (180px). Shared across users
-- (server-side); synced via the existing columns Realtime publication.
alter table public.columns
  add column width integer
  check (width is null or (width between 80 and 1200));
