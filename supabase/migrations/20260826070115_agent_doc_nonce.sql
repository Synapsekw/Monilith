-- 20260826070115_agent_doc_nonce.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 2b hardening — stable per-agent doc nonce):
--   1) user_agents.doc_nonce — a per-agent secret baked into document-inject.ts's
--      instructions delimiter whenever an agent has documents attached. Makes
--      forging the delimiter (via a document body containing the literal
--      `INSTRUCTIONS_SENTINEL`) require guessing this agent's own random value,
--      rather than just string-matching a constant every agent shares.
--
-- STABLE, not per-run: generated ONCE at row creation (the column default) and
-- never touched again. Per-run would defeat forgery too, but it would change
-- the system-prompt prefix on EVERY run for EVERY agent with documents, which
-- destroys the Anthropic prompt-cache breakpoint run-loop.ts sets on that
-- message for exactly the agents whose prompts are longest and most expensive
-- to re-read. Same agent -> same nonce -> same prefix -> cache still hits.
--
-- NEVER CLIENT-WRITABLE, by construction, not by convention: `authenticated`'s
-- INSERT/UPDATE grants on user_agents are COLUMN-SCOPED (20260802034242 /
-- 20260810173752 / 20260812060142) and this migration adds NO grant naming
-- `doc_nonce` to either list. A column outside a column-scoped grant is a hard
-- Postgres permission failure, not a silent no-op — so the browser can never
-- set or overwrite an agent's nonce; only the DB default (at insert) can. This
-- mirrors `bridge_secret_id`, which is absent from those same grant lists for
-- the identical reason.
--
-- ADDITIVE ONLY: one column with a NOT NULL default. No drop, no
-- data-modifying statement. Every existing agent backfills a real, distinct
-- nonce for free via the column default.

alter table public.user_agents
  add column if not exists doc_nonce uuid not null default gen_random_uuid();

comment on column public.user_agents.doc_nonce is
  'Stable per-agent secret. Threaded into document-inject.ts''s instructions '
  'delimiter (run-loop.ts) whenever this agent has documents attached, so a '
  'document body containing the literal INSTRUCTIONS_SENTINEL cannot forge '
  'the real delimiter without also knowing this value. Generated once at row '
  'creation by the column default; never granted to authenticated INSERT or '
  'UPDATE, so it is not client-writable (mirrors bridge_secret_id).';
