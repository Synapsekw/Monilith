-- 20260811024717_ai_models_id_verification.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Provider & Model layer · Task 4a — the plan's
-- SECOND and FINAL migration; no later task may mint a third):
--   Records, per catalog row, the provider-NATIVE model id and whether it has
--   been confirmed callable against that provider's own API.
--
-- Why a column and not a status value: the Gateway publishes its OWN model-id
-- namespace, which is not the providers' native namespace (verified
-- 2026-08-10 — it lists `anthropic/claude-haiku-4.5` where Anthropic's API
-- wants `claude-haiku-4-5`, and exposes no native id anywhere). We call each
-- provider DIRECTLY with a BYO key, so a gateway-only id is a 404 at the
-- provider. "Unverified id" is orthogonal to `status`, so overloading
-- `status = 'needs_pricing'` would be the same "stuff it in the wrong column"
-- mistake already rejected for `model_substituted`.
--
-- Everything here is additive and idempotent: DEV holds the live, user-facing
-- data (decision-32), so re-applying this file must be a no-op, never a loss.

-- The provider-native id this catalog row resolves to. Null until verified.
-- Adapters MUST send this, never model_id: model_id is the GATEWAY's id and
-- is not guaranteed to be callable against the provider's own API.
alter table public.ai_models
  add column if not exists native_model_id text,
  add column if not exists id_verified boolean not null default false,
  add column if not exists id_verified_at timestamptz;

-- Pickers read "active AND verified"; make that the index prefix.
create index if not exists ai_models_selectable_idx
  on public.ai_models (status, id_verified, provider);

-- The five ids this repo has shipped successfully against the providers'
-- own APIs are known-good; seed them verified so a fresh environment is not
-- left with an empty picker before the first verification pass runs.
update public.ai_models
   set native_model_id = model_id,
       id_verified = true,
       id_verified_at = now()
 where (provider, model_id) in (
   ('anthropic','claude-sonnet-5'),
   ('anthropic','claude-haiku-4-5'),
   ('anthropic','claude-opus-4-8'),
   ('openai','gpt-4o'),
   ('google','gemini-2.0-flash')
 );
