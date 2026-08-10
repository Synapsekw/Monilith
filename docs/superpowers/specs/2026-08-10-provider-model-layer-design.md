# Provider & Model Layer — design

**Date:** 2026-08-10
**Status:** approved (brainstorming)
**Scope:** Spec 1 of 3. Agent capability & knowledge (spec 2) and orchestration & addressing
(spec 3) are out of scope here — see §10.

## Problem

Users want agents pinned to a model of their choosing, on whichever provider they hold an
API key for. Four hard limits block that today:

1. **One key per user.** `user_ai_credentials` is already PK'd `(user_id, provider)`, but
   `ai_credential_set` opens with a loop that deletes every other row for that user
   (`20260706164829_user_ai_credentials.sql`), enforcing "one active provider".
2. **Model is fixed per feature, not per agent.** `model-map.ts` maps 13 features to two
   hardcoded Claude models. Nothing user-selectable exists.
3. **Two of three adapters ignore the model.** `providers/types.ts` documents it plainly:
   "Only the Anthropic adapter honours `choice`; the OpenAI/Google adapters ignore it and
   run their own fixed model."
4. **The provider set is closed.** `AiProvider` is a three-member TS union mirrored by two
   hardcoded `check (provider in (…))` constraints, so a provider like Kimi cannot be added
   without a code change and a migration.

Two further requirements arrived during brainstorming: **new models must become selectable
without shipping a release**, and the provider set must reach beyond the original three —
targeting Anthropic, OpenAI, Google, Mistral and Kimi.

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
| Provider set     | DB-driven registry, not a TS union — new providers (Kimi, DeepSeek, xAI, …) added without a deploy. |
| Key ownership    | Keep the org-wide `ai_mode`; each mode holds up to one key **per provider**.                        |
| Adapter strategy | Keep `ProviderAdapter` / `registry` / `runAi` intact; swap each adapter's internals to AI SDK v6.   |
| Selection scope  | Per-agent picker + one org default model; `model-map` degrades to a per-feature tier hint.          |
| Retired model    | Fall back to the org default, record the substitution, flag the agent in the roster.                |

## Architecture

### 0. `ai_providers` — the provider registry

`AiProvider` is currently a three-member TS union (`providers/catalog.ts`), mirrored by two
hardcoded `check (provider in ('anthropic','openai','google'))` constraints. That union is
the reason adding Kimi would need a deploy — so it moves to the database, exactly as the
model catalog did.

```
id             text primary key      -- 'moonshotai', 'anthropic', 'deepseek', …
label          text                  -- 'Kimi (Moonshot AI)'
adapter_kind   'anthropic' | 'google' | 'openai-compatible'
base_url       text                  -- OpenAI-compatible endpoints only
key_placeholder text                 -- 'sk-…' — UI hint
key_format     text                  -- regex for the cheap pre-flight shape check
enabled        bool
```

**`adapter_kind` is what keeps this to four code paths.** Anthropic, OpenAI and Google have
bespoke wire formats and keep their existing dedicated adapters. Everyone else exposes an
OpenAI-compatible API, so **one new** generic `openai-compatible` adapter built on
`@ai-sdk/openai-compatible` serves all of them, parameterised by `base_url`.

**Seeded providers** — deliberately the strong five, not all 35:

| id           | label              | adapter_kind        | base_url                     |
| ------------ | ------------------ | ------------------- | ---------------------------- |
| `anthropic`  | Anthropic (Claude) | `anthropic`         | native SDK                   |
| `openai`     | OpenAI             | `openai`            | native SDK                   |
| `google`     | Google Gemini      | `google`            | native SDK                   |
| `mistral`    | Mistral            | `openai-compatible` | `https://api.mistral.ai/v1`  |
| `moonshotai` | Kimi (Moonshot AI) | `openai-compatible` | `https://api.moonshot.ai/v1` |

Only Mistral and Kimi need the new generic adapter, and both ride the same code path — so
supporting them costs one adapter, not two.

**Adding a sixth provider later is one row, no deploy** — the same promise already made for
models, extended to providers. The other 30 providers in the feed stay unseeded; the
`enabled` filter in §2 means their models never reach a picker.

A useful consequence falls out for free: the **Gateway itself is just another row**
(`adapter_kind: 'openai-compatible'`, `base_url: https://ai-gateway.vercel.sh/v1`). A user
who would rather hold one key than eleven can add a single Gateway key and reach all 324
models. BYO-direct and one-key-for-everything become the same mechanism rather than two.

Consequential changes:

- `AiProvider` widens from a union to `string`, validated against this table. 43 references
  across 13 files; `providers/catalog.ts`'s `PROVIDER_CATALOG` becomes the seed data.
- `getAdapter(provider)` resolves by `adapter_kind`, not by provider id.
- The two `check (provider in (…))` constraints
  (`user_ai_credentials`, `ai_platform_foundation`'s `byo_provider`) become foreign keys to
  `ai_providers(id)` — still constrained, no longer requiring a migration per provider.

### 1. `ai_models` — the catalog

New table. Source of truth for both **selection** and **pricing**, which is what keeps the
two from drifting.

```
provider                     text references ai_providers (id)
model_id                     provider-native id, e.g. 'kimi-k2'
gateway_id                   Gateway catalog key, e.g. 'moonshotai/kimi-k2'
label                        display name, e.g. 'Kimi K2 Instruct'
context_length               int, nullable      -- feed: context_window
max_output_tokens            int, nullable      -- feed: max_tokens
supports_tools               bool               -- feed: 'tool-use' ∈ tags
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

The four price columns mirror `AiUsageTokens` exactly (input, output, cache read, cache
write), which is what the Gateway feed returns and what `computeCostUsd` already consumes.

`supports_tools`, `context_length` and `max_output_tokens` are **derived from the feed, not
hand-maintained** — verified against the live response (see §2). `max_output_tokens` and
`context_length` are also the inputs Spec 2's reference-template token budget needs.

### 2. Catalog refresh

Daily `pg_cron` job → HMAC-signed POST to `/api/ai/models/refresh`. This reuses the
established sweep pattern verbatim (`verifyBody` from `ai/agentic/hmac.ts`, app URL and
HMAC secret read from `vault.decrypted_secrets` — the shape used by five existing jobs).

The handler fetches the catalog, upserts each row and stamps `last_seen_at`.

**Verified against the live endpoint on 2026-08-10** (`curl https://ai-gateway.vercel.sh/v1/models`,
HTTP 200, no auth required — it is genuinely public): 324 models across 35 providers. Each
entry carries `id`, `name`, `owned_by`, `context_window`, `max_tokens`, `type`, `tags`,
`supported_parameters`, `modalities` and `pricing`.

Two filters:

- **`type == 'language'`.** The feed also carries image, video, audio, rerank and embedding
  models (`bfl`, `klingai`, `fish-audio`, `recraft`, `voyage`) which are not chat models and
  must never reach a model picker. Embeddings are unaffected either way —
  `runEmbedding` deliberately bypasses `resolveAiAdapter` for a fixed platform model.
- **`owned_by` is `enabled` in `ai_providers`.** Models from unseeded providers are ignored,
  so the catalog never offers a model no key can reach.

Across the five seeded providers that yields **95 selectable models**, every one of them
priced, 88 of them tool-capable:

| provider     | language models | tool-use | cache-priced |
| ------------ | --------------- | -------- | ------------ |
| `openai`     | 41              | 40       | 31           |
| `google`     | 17              | 11       | 15           |
| `anthropic`  | 15              | 15       | 15           |
| `mistral`    | 14              | 14       | 0            |
| `moonshotai` | 8               | 8        | 7            |

Mistral publishes no cache pricing; the two cache columns are nullable and coalesce to 0,
which is arithmetically correct rather than a gap. Of the 126 raw rows for these providers,
31 are non-language and dropped by the `type` filter — the filter earns its place.

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

Changed: the three existing adapters are reimplemented over AI SDK v6 (`generateText` /
`generateObject`), constructing `@ai-sdk/anthropic|openai|google` per call with the BYO key.
The existing `client?: unknown` DI seam is retained so adapter tests keep their injection
point.

Added: **one** generic `openai-compatible` adapter on `@ai-sdk/openai-compatible`, taking
its `base_url` from the provider row. Mistral and Kimi both run on it, as does every
provider added later without a deploy.

`supportsTools` moves from a per-adapter constant to the per-model catalog flag — the feed's
`tags` field supplies it. That single change is what makes Spec 2's tool grants possible on
providers other than Anthropic, and it is why 88 of the 95 seeded models are usable by a
tool-using agent rather than 15.

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
- **Adapter:** all four kinds via the `client` DI seam, asserting the **requested model is
  actually sent** and that the returned `model` reflects what ran. The `openai-compatible`
  adapter is additionally asserted to honour its row's `base_url`, since that one value is
  the whole difference between talking to Mistral and talking to Kimi.
- **Regression:** an OpenAI-keyed org exercising every feature in `model-map` never receives
  a Claude model id. This is the test that proves §Problem's regression is closed.
- **Catalog fixture:** the refresh parser runs against a captured real Gateway response, so
  a feed shape change (a renamed `tags` value, a dropped `type`) fails a test rather than
  silently emptying the picker.

## Execution DAG (working agreement #6)

| Unit | Work                                                                             | Depends on |
| ---- | -------------------------------------------------------------------------------- | ---------- |
| A    | `ai_providers` + `ai_models` tables, seed migration, refresh endpoint, pg_cron   | —          |
| B    | Multi-key credentials: SQL functions, FK swap, server actions, settings key UI   | —          |
| C    | Re-implement 3 adapters on AI SDK v6 + add the generic `openai-compatible` one   | —          |
| D    | `resolveModel`, gateway threading, catalog-backed pricing, `AiProvider` widening | A          |
| E    | Org default-model picker + agent editor model select                             | A, D       |

- **Batch 1 (parallel):** A, B, C
- **Batch 2:** D
- **Batch 3:** E
- **Critical path:** A → D → E

Unit B's FK swap and unit D's `AiProvider` widening both touch the provider type, so B and D
must not land in the same worktree without a rebase — B is in batch 1 and D in batch 2, so
the ordering already handles it.

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
