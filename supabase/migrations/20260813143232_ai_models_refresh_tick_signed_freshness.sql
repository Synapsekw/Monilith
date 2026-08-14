-- 20260813143232_ai_models_refresh_tick_signed_freshness.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Makes `public._ai_models_refresh_tick()` sign a body that is DIFFERENT on
--   every tick, so its signature is too.
--
--   Before: the body was a literal `jsonb_build_object('mode','refresh')`.
--   A constant body signs to a constant signature, so ONE captured request
--   replayed forever — there was no nonce and no timestamp, hence nothing that
--   could make a signed body stale. Since 20260811024717 a refresh also
--   re-verifies model ids against each provider using a BORROWED user
--   credential, so every replay spends a real user's key on outbound calls.
--
--   After: the signed payload carries `ts` (epoch seconds, clock_timestamp at
--   signing) and a 16-byte random `nonce`. `ts` lets the endpoint reject a body
--   outside a bounded skew window; `nonce` makes each body — and therefore each
--   signature — unique, so a capture is worthless once its window has passed.
--   Both live INSIDE the signed payload, so neither can be tampered with
--   independently of the HMAC.
--
-- DEPLOYMENT ORDER — signer first, verifier second. Adding fields cannot break
-- the currently-deployed verifier: the HMAC is computed over the WHOLE body
-- string and `verifyBody()` never reads the fields, so an old verifier simply
-- validates a longer body and ignores `ts`/`nonce`. The dangerous direction is
-- the reverse — a verifier that requires `ts` before the signer emits one would
-- fail every refresh CLOSED. So this migration is applied to the database
-- BEFORE the freshness-checking route reaches production. Rolling this
-- migration back while the new verifier is deployed also fails closed, but
-- loudly (the route logs `reason: "missing_timestamp"`), which is acceptable.
--
-- The endpoint contract lives in `src/lib/ai/agentic/hmac.ts`
-- (`verifyFreshSignedBody`), including the chosen window and its justification.
--
-- NOTE ON GRANTS: this function is `security definer`, and
-- `create or replace function` does NOT restore revoked grants. The revoke is
-- therefore re-asserted below, exactly as 20260810173752 did, so the signer
-- stays uncallable by public/anon/authenticated.

-- Body of 20260810173752_ai_provider_registry.sql §8, copied whole; the only
-- changes are the two extra keys in `v_body` and this comment.
create or replace function public._ai_models_refresh_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_app_url text;
  v_secret  text;
  -- `ts` + `nonce` are inside the SIGNED payload — see the header note. jsonb
  -- orders keys by length then bytewise, so `v_body::text` serializes as
  -- `{"ts": …, "mode": "refresh", "nonce": "…"}`; that exact string is what is
  -- signed AND what pg_net transmits, so the route's raw-body verify matches
  -- byte-for-byte (the route parses the raw string, it never re-serializes).
  v_body    jsonb := jsonb_build_object(
                       'mode', 'refresh',
                       'ts', extract(epoch from clock_timestamp())::bigint,
                       'nonce', encode(extensions.gen_random_bytes(16), 'hex'));
  v_sig     text;
begin
  select decrypted_secret into v_app_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'ai_pgnet_hmac_secret';
  if v_app_url is null or v_secret is null then
    raise warning 'ai models refresh skipped: app_url or hmac secret missing';
    return;
  end if;

  v_sig := encode(extensions.hmac(v_body::text, v_secret, 'sha256'), 'hex');
  perform net.http_post(
    url := v_app_url || '/api/ai/models/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Pulse-Signature', v_sig),
    body := v_body
  );
end; $$;

revoke execute on function public._ai_models_refresh_tick()
  from public, anon, authenticated;
