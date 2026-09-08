-- 20260908121511_profiles_theme_preset.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds the per-user theme preset column behind Settings → Preferences → Theme.

-- Per-user theme preset (accent + neutral tint + chrome wash). App code (Zod)
-- owns the id list; the DB only bounds the shape so a new preset needs no
-- migration. Unknown stored values fall back to 'keystone' on read. Writes are
-- gated by the existing "profiles: update self" RLS policy.
alter table public.profiles
  add column theme_preset text not null default 'keystone'
  check (char_length(theme_preset) <= 32);

comment on column public.profiles.theme_preset is
  'Per-user theme preset id (see src/lib/theme/presets.ts). Default keystone.';
