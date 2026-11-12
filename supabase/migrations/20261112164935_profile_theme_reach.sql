-- 20261112164935_profile_theme_reach.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds two per-user appearance preferences behind Settings → Preferences:
--   how far the theme preset reaches into the app, and whether completing an
--   item plays a celebration.
--   Spec: docs/superpowers/specs/2026-11-12-visual-refresh-design.md (section 5).

-- Theme reach (subtle | tinted | vivid). Same contract as theme_preset: app
-- code (Zod) owns the id list and the DB only bounds the shape, so a new reach
-- level needs no migration. Unknown stored values fall back to 'tinted' on read.
-- Writes are gated by the existing "profiles: update self" RLS policy.
alter table public.profiles
  add column theme_reach text not null default 'tinted'
  check (char_length(theme_reach) <= 16);

comment on column public.profiles.theme_reach is
  'Per-user theme reach id (see src/lib/theme/presets.ts). Default tinted.';

-- Done celebration (burst + pill pop). On by default; the user can switch it off.
alter table public.profiles
  add column celebrate_done boolean not null default true;

comment on column public.profiles.celebrate_done is
  'Whether completing an item plays the done celebration. Default true.';
