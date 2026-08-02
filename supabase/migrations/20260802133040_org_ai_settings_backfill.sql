-- 20260802133040_org_ai_settings_backfill.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Phase 10 E6 · Unit A):
--   Makes every existing org's AI mode EXPLICIT, so the application-side
--   fallback can change without moving anyone.
--
-- src/lib/ai/org-settings.ts ships DEFAULT_ORG_AI_SETTINGS with mode
-- 'per_user': an org with no row today means "members use their own keys".
-- Under managed-only billing the fallback for an unpaid org must be 'off'.
--
-- Verified on DEV 2026-08-02: 22 organizations, ZERO org_ai_settings rows. So
-- every org is running on that constant right now, and flipping it alone would
-- turn AI off for all of them in one deploy — including the one user with a
-- stored BYO key. This migration writes each org's CURRENT effective mode as a
-- real row first. Nobody's behaviour changes; only the meaning of "no row"
-- does, and after this there are no orgs without a row.
--
-- `on conflict do nothing` so an org that has since gained a row keeps it, and
-- so the migration is safely re-runnable.

insert into public.org_ai_settings (org_id, ai_mode, tier, monthly_credit_limit)
select o.id, 'per_user'::public.ai_mode, 'none', 0
from public.organizations o
on conflict (org_id) do nothing;

