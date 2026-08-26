-- 20260826104103_ai_provider_sweep_health.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Gives `ai_providers` a SWEEP-HEALTH record, so the daily model-id
--   verification sweep (`verifyAllProviders` in src/lib/ai/models/refresh.ts)
--   stops being invisible.
--
-- Why. The sweep isolates every provider in its own try/catch and reports
-- exclusively to `console`. Nothing in the product can therefore answer "has
-- Mistral's /v1/models probe been failing for a week?" — and a provider whose
-- probe fails silently keeps its catalog rows at `id_verified = false`, which
-- `catalog-db.ts` (verifiedOnly: true by default) filters out of every model
-- picker. The failure mode is an empty picker with no stated cause. These four
-- columns are the cause, recorded where the UI can read it.
--
-- Four columns, not two, because "failing for a week" needs BOTH ends of the
-- interval: `last_verified_at` is the last SUCCESS (the freshness of what the
-- catalog actually knows), `last_verify_attempt_at` is the last RUN. With only
-- one of them a stale-but-succeeding provider and a provider that has been
-- 401ing since Tuesday look identical.
--
--   last_verified_at        last time the probe SUCCEEDED for this provider.
--                           Never moved by a failed or skipped run — that is
--                           what makes "last verified 7 days ago, failing
--                           since" expressible.
--   last_verify_attempt_at  last time the sweep ran for this provider at all,
--                           whatever the outcome.
--   last_verify_status      'ok' | 'failed' | 'skipped'. 'skipped' means the
--                           sweep had NO key it was allowed to use for this
--                           provider (see the borrowing contract in
--                           src/lib/ai/credentials.ts — org BYO keys are
--                           deliberately out of scope), so nothing was probed.
--   last_verify_error       one bounded, sanitized sentence explaining a
--                           'failed'/'skipped' outcome. Written by the sweep,
--                           which truncates it and never puts key material in
--                           it (verify-ids.ts reports HTTP STATUS only — the
--                           Google key travels in the query string, so neither
--                           URL nor headers may ever reach a message).
--
-- Additive and nullable throughout: DEV holds the live, user-facing data
-- (decision-32), every existing `ai_providers` row stays valid as-is, and the
-- five seeded rows simply read "never checked" until the first sweep runs.
-- Re-applying this file is a no-op.

alter table public.ai_providers
  add column if not exists last_verified_at       timestamptz,
  add column if not exists last_verify_attempt_at timestamptz,
  add column if not exists last_verify_status     text,
  add column if not exists last_verify_error      text;

-- Drop-then-add rather than `add constraint if not exists` (which Postgres has
-- no syntax for on a check constraint). Idempotent, and safe on live data: the
-- column is null on every existing row, so the constraint validates instantly.
alter table public.ai_providers
  drop constraint if exists ai_providers_last_verify_status_check;
alter table public.ai_providers
  add constraint ai_providers_last_verify_status_check
  check (
    last_verify_status is null
    or last_verify_status in ('ok', 'failed', 'skipped')
  );

comment on column public.ai_providers.last_verified_at is
  'Last time the daily model-id verification probe SUCCEEDED for this provider. Not moved by a failed or skipped run.';
comment on column public.ai_providers.last_verify_attempt_at is
  'Last time the daily sweep ran for this provider, whatever the outcome.';
comment on column public.ai_providers.last_verify_status is
  'Outcome of the last sweep run: ok | failed | skipped (no usable key).';
comment on column public.ai_providers.last_verify_error is
  'Bounded, sanitized reason for a failed/skipped run. Never contains key material.';

-- No new RLS policy and no new grant. `ai_providers_select_all` already exposes
-- this table to every authenticated user, and these four columns are the same
-- kind of thing the rest of the row is: platform/vendor operational metadata
-- with no tenant data in it. Writes stay default-denied — the only writer is
-- the service-role sweep, which bypasses RLS.
