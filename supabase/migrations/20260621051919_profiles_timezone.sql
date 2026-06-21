-- Per-user display timezone. NULL = "Automatic" (resolve to the viewer's device
-- zone at render time). A non-null value is a validated IANA id (e.g.
-- 'Europe/Belgrade'), enforced in app code via Zod (Postgres can't validate IANA
-- names in a CHECK). Writes are already gated by the existing
-- "profiles: update self" RLS policy. The org-level organizations.timezone
-- (which drives automations) is unrelated and unchanged.
alter table public.profiles
  add column timezone text;

comment on column public.profiles.timezone is
  'Per-user display timezone (IANA id). NULL = automatic / device zone.';
