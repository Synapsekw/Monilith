# Provider & Model Layer — design

**Date:** 2026-08-10
**Status:** approved (brainstorming)
**Scope:** Spec 1 of 3. Agent capability & knowledge (spec 2) and orchestration & addressing
(spec 3) are out of scope here — see §10.

## Problem

Users want agents pinned to a model of their choosing, on whichever provider they hold an
API key for. Three hard limits block that today:

1. **One key per user.** `user_ai_credentials` is already PK'd `(user_id, provider)`, but
   `ai_credential_set` opens with a loop that deletes every other row for that user
   (`20260706164829_user_ai_credentials.sql`), enforcing "one active provider".
2. **Model is fixed per feature, not per agent.** `model-map.ts` maps 13 features to two
   hardcoded Claude models. Nothing user-selectable exists.
3. **Two of three adapters ignore the model.** `providers/types.ts` documents it plainly:
   "Only the Anthropic adapter honours `choice`; the OpenAI/Google adapters ignore it and
   run their own fixed model."

A fourth requirement arrived during brainstorming: **new models must become selectable
without shipping a release.**

### The regression this must not cause

Limits 2 and 3 currently cancel out. `model-map` emits `claude-sonnet-5` for every
feature, and that is harmless for an OpenAI-keyed org _only because_ the OpenAI adapter
throws the value away. The moment adapters honour `choice.model`, every feature in such an
org sends a Claude model id to OpenAI and 400s.

**Per-provider model resolution is therefore not a feature of this spec — it is the fix
that keeps the adapter change from being a regression.** The two must ship together.

## Decisions

| Question         | Decision                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Sequencing       | Three specs; provider/model layer first, then capability & knowledge, then orchestration.           |
| Catalog location | A database table, not an in-repo constant — new models must appear without a deploy.                |
| Catalog source   | Vercel AI Gateway `GET /v1/models` (metadata feed only; inference still goes direct with BYO keys). |
| Key ownership    | Keep the org-wide `ai_mode`; each mode holds up to one key **per provider**.                        |
| Adapter strategy | Keep `ProviderAdapter` / `registry` / `runAi` intact; swap each adapter's internals to AI SDK v6.   |
| Selection scope  | Per-agent picker + one org default model; `model-map` degrades to a per-feature tier hint.          |
| Retired model    | Fall back to the org default, record the substitution, flag the agent in the roster.                |

## Architecture

### 1. `ai_models` — the catalog

New table. Source of truth for both **selection** and **pricing**, which is what keeps the
two from drifting.

```
provider                     'anthropic' | 'openai' | 'google'
model_id                     provider-native id, e.g. 'claude-sonnet-5'
gateway_id                   Gateway catalog key, e.g. 'anthropic/claude-sonnet-5'
label                        display name
context_length               int, nullable
supports_tools               bool
input_price_per_mtok         numeric
output_price_per_mtok        numeric
cache_read_price_per_mtok    numeric
cache_write_price_per_mtok   numeric
tier                         'cheap' | 'standard' | 'strong'
status                       'active' | 'retired' | 'needs_pricing'
last_seen_at                 timestamptz
primary key (provider, model_id)
```

- **RLS:** `select` open to `authenticated` (public vendor metadata, no tenant data);
  no insert/update/delete policies, so writes are default-denied and reach the table only
  through the service-role refresh path. Same posture as `user_ai_credentials`.
- **Index:** `(status, provider)` — every read is "active models for provider X".
- **Seed:** the migration inserts today's known models from `PRICED_MODELS`
  (`src/lib/ai/pricing.ts`). This is the floor: a refresh that never succeeds still leaves
  a working picker.

The four price columns are chosen to mirror `AiUsageTokens` exactly (input, output, cache
read, cache write), which is what the Gateway feed returns and what `computeCostUsd`
already consumes.

### 2. Catalog refresh

Daily `pg_cron` job → HMAC-signed POST to `/api/ai/models/refresh`. This reuses the
established sweep pattern verbatim (`verifyBody` from `ai/agentic/hmac.ts`, app URL and
HMAC secret read from `vault.decrypted_secrets` — the shape used by five existing jobs).

The handler calls `gateway.getAvailableModels()` from `@ai-sdk/gateway`, filters to the
three providers we hold adapters for, upserts each row and stamps `last_seen_at`.

Two guards, both load-bearing:

- **Unpriced arrivals land `needs_pricing` and are hidden from pickers.** `computeCostUsd`
  returns 0 for an unknown model, so an unpriced-but-selectable model would bill nothing at
  all. Gating on status preserves that invariant by construction rather than by vigilance.
- **Retirement only runs when the fetch returned a plausible non-empty list.** A Gateway
  outage returning `[]` must not mark the entire catalog retired. On a failed or empty
  fetch the handler logs and exits, leaving existing rows untouched.

Rows are never deleted — `user_agents` references model ids, and a deleted row would turn a
pinned reference into a dangling one instead of a clean `retired` state.

### 3. Resolution

`resolveAiAdapter(orgId, userId)` gains an optional `provider`. When supplied (the agent
pinned one), it resolves _that provider's_ key within the active `ai_mode`; a missing key
throws the existing `ByoKeyMissingError` / `PersonalAiKeyMissingError`, now naming the
provider so the UI can say which key to add. The trust rules around `TrustedUserId` and the
`per_user` branch are unchanged — this adds a parameter, not a new trust path.

`modelFor(feature)` is replaced by `resolveModel({ orgId, feature, provider, requested? })`:

1. **Pinned and `active`** → use it.
2. **Pinned but `retired` / absent** → org default model; the run row records the
   substitution and the roster shows a "model retired — pick a new one" banner on that
   agent. The run still produces output.
3. **Nothing pinned** → org default, nudged by the feature's tier hint (`item_assist` and
   `column_fill` resolve to the cheapest `active` model of that provider).

`model-map.ts` stops emitting model ids and becomes a feature → tier map. `ThinkingConfig` /
`effort` survive as request-shape config, now expressed as AI SDK parameters.

### 4. Adapters

Unchanged: the `ProviderAdapter` interface, `registry.ts`, `getAdapter`, and `runAi`'s
metering chokepoint. Call sites are untouched.

Changed: each adapter's internals are reimplemented over AI SDK v6 (`generateText` /
`generateObject`), constructing `@ai-sdk/anthropic|openai|google` per call with the BYO key.
The existing `client?: unknown` DI seam is retained so adapter tests keep their injection
point.

`supportsTools` moves from a per-adapter constant to the per-model catalog flag. That single
change is what makes Spec 2's tool grants possible on providers other than Anthropic.

### 5. Pricing

`computeCostUsd` stays **pure and synchronous**. `runAi` already resolves the adapter before
invoking; it now also reads the catalog price row in that same step and passes rates into
`computeCostUsd`. `MODEL_PRICES_PER_MTOK` remains as the seed and the fallback floor.

This deliberately avoids making the pricing function async, which would ripple into every
metering call site.

### 6. Credentials

- Drop the delete-every-other-row loop from `ai_credential_set`. The `(user_id, provider)`
  primary key already models one key per provider correctly.
- Add `ai_credential_delete(p_user, p_provider)`.
- `ai_credential_get` takes a provider argument; `resolveUserAdapterById` passes the
  requested provider through.
- `org_ai_secret_get` gains the same per-provider argument.
- `org_ai_settings` gains `default_provider` and `default_model_id`.
- `user_agents` gains `provider` and `model_id`, both nullable — null means "use the org
  default", which is also the migration's backfill value, so existing agents are unaffected.

All new/changed functions stay `security definer`, revoked from `anon`/`authenticated`, and
granted only to `service_role`, matching the existing ACL lockdown.

### 7. UI

- **Settings → AI, keys:** the single-key form becomes a list — one row per provider, each
  added / replaced / removed independently and live-validated through the adapter's
  `validateKey`.
- **Settings → AI, default model:** a picker grouped by provider, showing only providers
  with a resolvable key and only `active` models.
- **Agent editor:** a provider + model select defaulting to "Use org default", filtered to
  providers the org can resolve a key for, plus the retired-model banner from §3.

Per working agreement #5: the catalog is read server-side once per page render (hundreds of
rows, indexed `(status, provider)`); provider/model filtering in the picker is client state.
**Zero server round-trips per interaction.**

## Error handling

| Condition                            | Behaviour                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| No key for the requested provider    | `ByoKeyMissingError` / `PersonalAiKeyMissingError`, naming the provider; UI links to the key form.        |
| Pinned model retired                 | Substitute the org default, record it on the run row, flag the agent. Never fails the run.                |
| Model arrives without pricing        | Stored `needs_pricing`, hidden from pickers, never selectable, never billed at 0.                         |
| Gateway fetch fails or returns empty | Logged; no upsert, no retirement. Catalog keeps its previous state.                                       |
| Org has no default model set         | Fall back to the provider's cheapest `active` model at the feature's tier, and surface a settings prompt. |

## Testing

- **Unit:** the `resolveModel` matrix (pinned / retired / absent / no-default / tier hint);
  the refresh upsert including the empty-response retirement guard and the `needs_pricing`
  path; per-provider credential set/get/delete; `computeCostUsd` against catalog-supplied
  rates.
- **RLS integration:** `ai_models` readable by `authenticated`, all writes denied; per-provider
  credential isolation (user A cannot read user B's row, and clearing A's OpenAI key leaves
  A's Anthropic key intact).
- **Adapter:** each of the three via the `client` DI seam, asserting the **requested model is
  actually sent** and that the returned `model` reflects what ran.
- **Regression:** an OpenAI-keyed org exercising every feature in `model-map` never receives
  a Claude model id. This is the test that proves §Problem's regression is closed.

## Execution DAG (working agreement #6)

| Unit | Work                                                                  | Depends on |
| ---- | --------------------------------------------------------------------- | ---------- |
| A    | `ai_models` table, seed migration, refresh endpoint, pg_cron job      | —          |
| B    | Multi-key credentials: SQL functions, server actions, settings key UI | —          |
| C    | Adapter re-implementation on AI SDK v6                                | —          |
| D    | `resolveModel`, gateway threading, catalog-backed pricing             | A          |
| E    | Org default-model picker + agent editor model select                  | A, D       |

- **Batch 1 (parallel):** A, B, C
- **Batch 2:** D
- **Batch 3:** E
- **Critical path:** A → D → E

## 10. Out of scope

The remaining work is two further specs, in dependency order.

**Spec 2 — agent capability & knowledge**

- **Scoped capability grants** — create agents / automations / schedules / board writes —
  granted once per capability, with a reviewable proposal card for anything ungranted. Note
  this deliberately relaxes today's invariant that AI never writes directly
  (`automation-gen-actions.ts:29`).
- Tool grants per agent, unlocked across providers by this spec's per-model
  `supports_tools` flag.
- **Reference templates:** user-uploaded documents an agent must follow (e.g. a proposal
  template). Design tension to resolve there — a template is structure, so it wants
  **verbatim injection under a token budget**, not RAG chunking, which would destroy the
  very structure the agent is meant to imitate. Retrieval is the fallback for corpora too
  large to inject. The budget check is already served by this spec's per-model
  `context_length`.
- **Memory layer:** what an agent carries between runs, and who writes it (agent scratchpad
  vs. user-curated facts vs. auto-summarised run history).
- File artifacts produced by a run, free-form system prompts, and cadences beyond `daily`.

**Spec 3 — orchestration & addressing** (depends on Spec 2)

- A default per-user **orchestrator agent** that delegates to other agents as tools
  (synchronous sub-runs, depth/fan-out capped).
- **`@handle` addressing** of agents across every mention surface, including comments and
  Ask Pulse, with per-surface rate limits.
- A **renameable built-in assistant** (moving "Monolith Autopilot" off its per-deployment
  seed onto a per-org row).

### Forward constraints this spec must respect

Agents-as-tools means **nested runs and nested spend**. `runAi`'s ledger will need to
tolerate a parent-run correlation id. It is not built here, but nothing in this spec should
make it harder to add — in particular, `record_ai_usage` should keep accepting additive
optional parameters.
