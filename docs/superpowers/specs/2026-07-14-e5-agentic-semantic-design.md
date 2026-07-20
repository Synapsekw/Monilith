---
type: spec
status: greenlit
date: 2026-07-14
feature: e5-agentic-semantic
phase: 10
epic: E5
tags:
  [
    project/pulse,
    spec,
    ai,
    automations,
    agentic,
    semantic-search,
    pgvector,
    migration-gated,
  ]
related:
  - "[[00-north-star]]"
  - "docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md"
  - "docs/superpowers/specs/2026-07-11-ai-e1-scope-reconciliation-design.md"
  - "docs/superpowers/specs/2026-07-12-e3-conversational-actions-design.md"
  - "docs/superpowers/specs/2026-07-12-e4-generation-design.md"
  - "docs/superpowers/specs/2026-07-06-kbar-similarity-search-design.md"
  - "docs/superpowers/plans/2026-07-14-e5-agentic-semantic.md"
---

# Phase 10 · E5 — Agentic Automations + Semantic Search — design

> **Status:** **greenlit for full build (2026-07-20)** — see §11 for the owner's resolutions of the §10
> open questions. Scope reviewed and approved; build proceeds via the §9 execution DAG.
> **Depends on:** E1 foundation (merged) — gateway/entitlement/ledger; E3 `src/lib/ai/write/` (built on
> develop) — the `executeAction` deterministic write layer this epic reuses.

## 1. Summary

E5 is the "moat + long pole" of Phase 10. It has **two independent workstreams**:

- **Agentic automations (F13 → F14).** Give the automations engine — today a purely deterministic,
  in-Postgres rules engine — the ability to **call a model at execution time**. F13 adds an **AI
  action step** to a rule; F14 adds a **scheduled Autopilot agent** that runs a board on a cadence.
  Both extend the _mature_ engine and require the one genuinely-new architectural piece: an
  **async model hop** out of Postgres (`pg_net` → a signed server endpoint → the E1 gateway →
  a **bounded, audited, confined** action). This is a **deliberate, bounded relaxation** of the
  E2/E3/E4 "propose → human approves → persist" stance (§4.1).
- **Semantic search (F15).** Greenfield **pgvector** retrieval: enable the `vector` extension, add an
  `item_embeddings` table + HNSW ANN index + a SECURITY-INVOKER `match_items` RPC, an **async
  embedding pipeline** (backfill + incremental, out-of-band so it never touches the hot write path),
  and surface it as a **semantic Ask tool**, a **"find similar" item action**, and a retrieval layer
  Ask Pulse can grow into. Distinct from the already-specced `kbar-similarity-search`
  (`2026-07-06`), which is **lexical trigram** typo-tolerance — F15 is **meaning-based**
  ("onboarding" matches "New-hire checklist" with zero shared words).

**Why they are one epic but two tracks:** they share nothing at runtime and can be built fully in
parallel. F13→F14 is a sequential chain (the critical path). F15 is independent infra. The plan's
Execution DAG (§9) makes this explicit.

## 2. Ground truth (verified this session — do not re-derive)

The footprint was re-checked against the live DEV DB and the worktree source. Corrections to the
brief's stated assumptions are called out.

- **`pg_cron` and `pg_net` already exist and are in production use** (brief said the scheduler is
  net-new — it is **not**). The engine ships: `create extension pg_cron` +
  `_automation_date_sweep(p_now)` (hourly `automations-date-sweep` cron, per-org `timezone`-aware,
  idempotent via the `automation_date_fires` ledger), and `create extension pg_net` +
  `net.http_post` webhook delivery reconciled by the `automation-webhook-reconcile` minute cron via
  the `automation_webhook_deliveries` ledger. **These are the exact substrates F13/F14 repurpose.**
- **All automation execution is in-DB plpgsql**, funneled through one executor
  `public._automation_run(p_automation_id, p_actions, p_condition, p_item_id, p_org_id, p_board_id,
p_actor, p_trigger_type)` (latest body in `20260704111500_...`). It applies **confinement guards**
  on untrusted jsonb actions (notify recipient must be `is_member_of`, `set_option`/`set_percent`
  target column must belong to the board, `move_to_group` same-board, webhooks through
  `_webhook_url_safe`). It logs one `automation_runs` row per evaluation
  (`status ∈ {ran, blocked, error}`, per-action `[{type, outcome}]`). **There is no path that calls
  out to the app/model at execution time except `pg_net` webhooks** — that is the gap F13 fills.
- **`vector`/pgvector does NOT exist.** Confirmed available (extension `vector` 0.8.0 offered) but
  **not installed**; no vector column, no embedding table, no embeddings client anywhere. Current
  search is lexical only (`search_items` = ILIKE+`pg_trgm word_similarity`, SECURITY INVOKER,
  RLS-scoped, name-field only).
- **The gateway has no embeddings.** `src/lib/ai/gateway.ts` (`resolveAiAdapter`/`runAi`) is
  chat/structured-output only; `ProviderAdapter` exposes `validateKey`/`generateProposal`/
  `generateStructured` — **no `embed`**. Metering (`ai_usage` + `record_ai_usage`, service-role)
  keys everything off a **free-text `feature` column** (no `kind` enum); pricing
  (`MODEL_PRICES_PER_MTOK`) is per-model `{input, output}`; unknown model → cost 0. Managed mode is
  **Anthropic-only**; BYO/per-user keys live in Supabase Vault, provider ∈ `{anthropic, openai,
google}`.
- **E3's write engine is already built** (`src/lib/ai/write/`: `executeAction` maps a
  `ValidatedAction` onto canonical `createItem`/`createGroup`/`upsertCell`; propose→confirm→execute).
  F13/F14 reuse the **bounded-action + validation** discipline, not the confirm UX.
- **No agent/bot author identity exists.** `item_updates.author_id → auth.users(id)`; the
  `item_updates_protect_attribution` trigger freezes `author_id` on **UPDATE** (INSERT can still set
  it, subject to RLS). F14's @mention-chase needs a **principal** to author comments as (§4.3).
- **Embeddable text** lives in three places: `items.name` (title, 1–255), `item_updates.body_text`
  (already-denormalized plaintext comments), and `cell_values.value` for `text`-kind columns.
- **Hot-path invariant (`src/lib/boards/actions/group.ts`):** within-board item/cell writes
  deliberately do **not** `revalidatePath` and must stay cheap. **Embedding generation must be
  out-of-band** — never synchronous on an item/cell write (§4.4, §6).
- **Canonical modules to reuse:** `ActionResult`/`fail` (`src/lib/actions/result.ts`), `typedRpc`
  (`src/lib/supabase/typed-rpc.ts`), targeted `updateTag` revalidation (`src/lib/cache/tags.ts`),
  `runAi`/`requireAiEntitlement`, the `ASK_TOOLS` + `executeAskTool` switch (adding a read tool is a
  Zod-schema + array-append + switch-case), and `_automation_run`'s confined executor.

## 3. Goals & non-goals

**Goals**

- **F13 — AI action in automations.** A rule can include an `ai_step` action: at fire time, a model
  **chooses a bounded, reversible action** (from the existing constrained vocabulary) and it is
  applied through the **existing confined executor** with a full audit row. Entitlement-gated,
  metered, kill-switchable.
- **F14 — Autopilot agent.** A per-board scheduled agent that, on a cadence, reads the board
  (RLS-safe read tools) and takes a **bounded set of housekeeping actions** (triage new items to a
  group, chase an overdue owner via an @mention comment, keep a goal rollup current) **as a dedicated
  agent identity**, fully logged.
- **F15 — Semantic search.** pgvector storage + ANN index + `match_items` RPC + async embedding
  pipeline (backfill + incremental) + a semantic **Ask tool** and **"find similar"** surface. RLS
  scopes results to readable boards; reads are **bounded ANN over an index**.
- Every model/embedding call routes through the **E1 gateway** and meters into `ai_usage`, respecting
  `ai_mode` (`off` blocks; `managed` meters + caps against the monthly ceiling).
- TDD throughout: unit tests for every validator/resolver/pure function; an **RLS boundary
  integration test for every new table** (cross-tenant isolation) and for the `match_items` RPC.

**Non-goals (YAGNI for E5)**

- **No unbounded/free-form agent writes.** Agentic actions draw only from the existing constrained,
  **reversible** action vocabulary (`set_option`, `set_percent`, `move_to_group`, `notify`) — **never**
  `call_webhook`, never delete/archive, never arbitrary SQL, never board/column creation.
- **No new provider-BYO for embeddings.** The corpus index requires **one fixed embedding model** for
  all orgs (§4.5); embeddings do not use org/user BYO keys.
- **No replacing lexical search.** `search_items` (trigram) and the `kbar-similarity-search` spec stay
  as-is; semantic is **additive** (a distinct tool + surface), not a swap.
- **No hybrid re-ranking / RRF fusion** of lexical+semantic in v1 (noted as a future extension).
- **No embedding of every cell/attachment.** v1 embeds a per-item **composite document**
  (`name` + text-cell values + recent comment text), not every field independently.
- **No Ask-Pulse-full-page rewrite here.** F15 provides the retrieval RPC/tool that the separately
  specced `/ask` page can later consume; it does not build that page.
- **No self-authored automations** (E4 forbids AI minting rules that self-deploy); a human authors and
  **enables** every agentic rule/agent.

## 4. Design

### 4.1 The stance shift (and its guardrails)

E2/E3/E4 are **propose → human approves → persist**. Automation is, by definition, **unattended
action** — the whole value is that it runs without a human in the loop. E5 therefore **relaxes** the
approval-per-action stance for agentic automations, but only inside a **hard guardrail box**:

1. **Human authorship + explicit enable.** A person builds the rule/agent and toggles it `enabled`.
   The AI never creates or enables an automation (E4 invariant preserved).
2. **Constrained, reversible action vocabulary only.** The model **chooses parameters within** the
   existing bounded actions; it cannot invent an action shape. No webhooks, no deletes, no writes
   outside the confinement guards of `_automation_run`.
3. **Execution stays in the confined executor.** The model **decides**; the **existing
   `_automation_run` guards apply and log** the mutation. The AI never gets a raw write path — it
   returns a _chosen action_, which flows through the same audited, RLS-confined plpgsql a manual
   rule uses.
4. **Full audit + kill switch.** Every agentic evaluation writes an `automation_runs` row (outcome
   vocabulary extended with `ai_decided`, `ai_skipped`, `ai_error`). A per-rule/agent `enabled`
   toggle is the kill switch; an org-level `ai_mode = off` disables all of it.
5. **Entitlement-gated + metered + bounded spend.** Gated by `requireAiEntitlement` before any token
   spend; metered through `runAi`; per-run round/token caps; managed orgs draw against the monthly
   ceiling.
6. **Dry-run / preview.** The builder offers a **"Test this step"** that runs the AI decision against
   a sample item and shows the chosen action **without applying it** (reuses the propose→preview
   pattern from E3/E4).

This is captured as an ADR at merge time (`vault/decisions/…-agentic-automation-guardrails.md`).

### 4.2 F13 — AI action step in a rule

**The one new architectural piece: an async model hop out of Postgres.** `_automation_run` cannot
call a model inline (it runs in the mutating transaction, synchronously, as a definer). The pattern
**mirrors the existing webhook path exactly**:

```
cell/item write (or date sweep) ─▶ _automation_run
  └─ action.type = 'ai_step'
       ├─ INSERT automation_ai_jobs (run_id, automation_id, item_id, org_id, board_id,
       │                             config jsonb, status='pending')            ← audit + idempotency
       └─ net.http_post( <embed/decide endpoint>, signed body {job_id} )        ← pg_net, non-blocking
                                   │  (async; transaction commits immediately)
                                   ▼
        POST /api/ai/automation-step   (Next.js route handler, service-role, HMAC-verified)
          1. load job by id (service read, scoped to job.org_id/board_id)
          2. requireAiEntitlement(org, 'automation_ai_step')   → off/quota ⇒ mark ai_skipped
          3. build a labels+ids board/item context (reuse buildAutomationContext discipline — NO raw
             cell text beyond what the rule needs; privacy parity with E4)
          4. runAi({org,user:agentUserId,feature:'automation_ai_step'}, decideLoop)
                → model emits ONE bounded action (constrained JSON schema; re-validated referentially)
          5. hand the chosen action to the CONFINED executor:
                typedRpc('automation_ai_apply', { p_job, p_action })  (SECURITY DEFINER; runs the
                same per-action confinement + writes the automation_runs outcome + marks job done)
```

- **New action kind** `ai_step` in `automationActionSchema` (Zod union) + a builder row + one branch
  in `_automation_run`. `trigger`/`actions` are opaque jsonb validated only by Zod at the boundary,
  so **no shape migration** — but F13 **does** add the `automation_ai_jobs` ledger table (new table ⇒
  RLS + isolation test).
- **`config`** on the `ai_step` action: a bounded natural-language instruction ("pick the right
  status", "assign the most-recently-active member") + the constrained **allowed action set** for
  this step (a subset of `{set_option, set_percent, move_to_group, notify}`) so the rule author caps
  what the AI may do.
- **Endpoint security:** service-role route, **HMAC-signed** body (a shared secret in server env;
  reuse the webhook-reconcile signing discipline), verifies the job exists + is `pending`, and does
  **all** DB work scoped to `job.org_id`/`board_id`. The **mutation itself** goes back through the
  confined definer (`automation_ai_apply`) so RLS/guards are never bypassed by the AI's choice.
- **Idempotency:** `automation_ai_jobs.status` transitions `pending → done|skipped|error`; a
  redelivered `pg_net` call on a non-`pending` job is a no-op (same discipline as
  `automation_webhook_deliveries`). A minute cron `automation-ai-reconcile` marks long-`pending` jobs
  `error` (timeout) so nothing wedges.

### 4.3 F14 — Autopilot scheduled agent

Builds on F13's async-hop + confined-apply substrate, adds **scheduling** and an **agent identity**.

- **Schedule substrate — reuse the date sweep.** A new `board_agents` table
  (`id, org_id, board_id, enabled, cadence` (`daily|hourly`), `run_at_local_hour`, `config jsonb`
  (which housekeeping tasks are on), `created_by`, timestamps). A pg_cron sweep
  `autopilot-sweep` (reusing the **exact** `_automation_date_sweep` org-`timezone` + fire-ledger
  idempotency pattern; new `board_agent_fires` ledger) selects due agents and, per agent, fires
  `net.http_post → POST /api/ai/autopilot { agent_id, fire_date }`.
- **The endpoint** (service-role, HMAC): entitlement-gate → build read context via the **RLS-safe
  read tools** (reuse `ASK_TOOLS` handlers, run under a scoped client) → `runAi(feature:
'autopilot_run', agentLoop)` where the model, within a bounded round cap, may take a **small,
  reversible housekeeping action set**: triage a new item into a group (`move_to_group`), chase an
  overdue owner (`notify` / an @mention **comment** authored by the agent), nudge a goal rollup
  (`set_percent`). Every write goes through the confined apply path; every run logs a
  `board_agent_runs` row (`status`, per-action outcomes, error).
- **Agent author identity (decision).** Seed **one platform bot** — a dedicated `auth.users` row
  ("Pulse Autopilot") with a `profiles` row rendered with an agent badge — created once via a
  migration/seed. The service-role endpoint authors `item_updates`/`notifications` as that user id
  (`agentUserId`), so attribution is truthful, the frozen-`author_id` trigger is satisfied on later
  edits, and @mentions/notifications render normally. RLS: the bot is a member of the org it acts in
  only via the confined apply path (it is never a real login; no session, no client key).
- **Bounded by construction:** the agent only touches boards its `board_agents` row names; only the
  configured housekeeping tasks; only reversible actions; capped rounds/tokens per run; kill switch =
  `enabled=false` or org `ai_mode=off`.

### 4.4 F15 — Semantic search (pgvector)

**Storage & index (migration-gated).**

- `create extension if not exists vector with schema extensions;` (versioned migration).
- New table (separate from `items` to keep board hydration lean):
  ```sql
  create table public.item_embeddings (
    item_id      uuid primary key references public.items (id) on delete cascade,
    org_id       uuid not null references public.organizations (id) on delete cascade,
    board_id     uuid not null references public.boards (id) on delete cascade,
    embedding    extensions.vector(1536) not null,      -- fixed model dim (§4.5)
    content_hash text not null,                          -- bounds re-embedding
    model        text not null,                          -- embedding model id (index-version guard)
    embedded_at  timestamptz not null default now()
  );
  create index item_embeddings_ann_idx on public.item_embeddings
    using hnsw (embedding extensions.vector_cosine_ops);
  create index item_embeddings_board_idx on public.item_embeddings (board_id);
  ```
  RLS: default-deny; SELECT only for items on readable boards (mirror `search_items` via
  `readable_board_ids()`), no client insert/update (writes only via the service embed endpoint).
- **`match_items` RPC** (SECURITY **INVOKER**, `STABLE`, `set search_path=''`): takes
  `p_query_embedding vector`, `p_limit int (clamped ≤ 50)`, optional `p_board_id`,
  `p_exclude_item_id` (for "find similar"); `ORDER BY embedding <=> p_query_embedding LIMIT k`;
  returns `(item_id, name, board_id, board_name, distance)`. **INVOKER** means the caller's RLS
  SELECT policies scope results — no cross-tenant leakage, and the RPC adds no privilege (same
  security posture as `search_items`).

**HNSW over IVFFlat:** HNSW needs no training pass, supports incremental inserts (items are added
continuously), and gives better recall at our scale. IVFFlat's list-training + rebuild cadence is a
poor fit for a continuously-mutating corpus.

**Embedding pipeline (decision — async, out-of-band). See §6 for the round-trip budget.**

- **Enqueue by staleness, not on the hot path.** A lightweight `AFTER INSERT/UPDATE` trigger on
  `items` (name) and `item_updates` (body_text) sets/inserts an `item_embed_queue(item_id, org_id,
board_id, enqueued_at)` row (on-conflict-do-nothing). The trigger does **zero** model work — it
  only marks staleness, so the group.ts hot-path invariant holds.
- **Batch sweep → model hop.** A pg_cron `embed-sweep` (every N minutes) selects a **bounded batch**
  of queued items and fires `net.http_post → POST /api/ai/embed { batch: [item_id...] }`. The
  endpoint (service-role, HMAC): builds each item's **composite document** (`name` + text-cell
  values + recent comment `body_text`, capped), computes `content_hash`, **skips items whose hash +
  model already match** (re-embedding bound), calls the embedding provider through the new gateway
  embed path (`runAi`, feature `semantic_index`, metered), upserts `item_embeddings`, and clears the
  queue rows. This **reuses the exact `pg_cron`+`pg_net`+ledger mechanism** F13/F14 use — one
  outbound-to-model architecture for the whole epic.
- **Backfill.** A one-time bounded, resumable endpoint/script (`/api/ai/embed?mode=backfill`) pages
  all existing items (369 in DEV) in capped batches through the same embed path; idempotent (skips
  matching hash+model). Runnable by an admin post-migration.
- **Re-embedding is bounded three ways:** (a) content-hash skip (no change ⇒ no call), (b) the queue
  de-dupes multiple edits between sweeps into one re-embed, (c) a per-sweep batch cap bounds cost.

**Query & surfaces.**

- **Semantic query flow:** query text → embed the query (1 metered call, feature `semantic_query`) →
  `match_items` RPC → results. Client-state results, debounced, History-API for any mode toggle — **0
  RSC navigations**.
- **Surfaces (additive):**
  1. **Ask tool `semantic_search_items`** — append to `ASK_TOOLS` (+ Zod guard + `executeAskTool`
     switch-case + RLS-scoped handler). Auto-flows into E3's write `proposeLoop` (read tools are
     shared), giving Ask Pulse a semantic retrieval tool immediately.
  2. **"Find similar" item action** — from the item panel, `match_items(p_query_embedding =
&lt;this item's embedding&gt;, p_exclude_item_id)` → a small ranked list deep-linking to items. If
     the item has no embedding yet (queued), show a graceful "indexing…" state.
  3. **(Optional, behind the same RPC) a semantic mode in ⌘K** — a distinct "Related" group, kept
     separate from the lexical Items group so behavior is legible. Scoped as optional in the plan.

### 4.5 The embedding-provider decision (required item #3)

Anthropic has **no first-party embeddings endpoint** (confirmed against the `claude-api` skill;
managed mode is Anthropic-only for _chat_). An ANN index is only coherent if **every vector comes
from the same model + dimension** — so semantic search **cannot** use per-org BYO embedding models.

**Decision:** a **single, Pulse-managed embedding model** for all orgs, resolved from a **platform
embedding key in server env** (independent of any org's chat `ai_mode`/keys). Recommended default
**`text-embedding-3-small` (OpenAI, 1536-dim, ~\$0.02/M-tok)** — it reuses the existing OpenAI SDK
path already present for the OpenAI chat adapter, so no new dependency; **Voyage
(`voyage-3.5-lite`, Anthropic-recommended) is the documented swap-in** behind an abstracted
`EmbeddingClient` interface (`embed(texts: string[]) → number[][]`), so the model can change with a
migration that re-stamps `item_embeddings.model` + a backfill. The `model` column + `content_hash`
make a model swap a controlled re-index, not a silent corruption.

**Metering:** embeddings still route through the gateway and `record_ai_usage`. Add pricing rows
(`text-embedding-3-small: { input: 0.02, output: 0 }`) and features `semantic_index` /
`semantic_query`. **No `ai_usage` schema change** — the free-text `feature` column already
distinguishes kinds (consistent with the E1 design; a `kind` enum is YAGNI). Embedding calls log
`output_tokens = 0`; `computeCostUsd`/`costToCredits` already handle that arithmetically. For
**managed** orgs, embedding + query spend counts against the monthly ceiling (routes through the same
`requireAiEntitlement`); for BYO/per-user orgs `creditsRemaining = Infinity` (unmetered ceiling) so
it is logged-at-cost but never gates — the platform absorbs the (tiny) embedding cost, which is the
intended product posture.

## 5. Entitlement + metering (required item #4)

| Call                   | feature              | gateway path        | mode behavior                                                               |
| ---------------------- | -------------------- | ------------------- | --------------------------------------------------------------------------- |
| F13 AI action decision | `automation_ai_step` | `runAi` (chat/tool) | `off` ⇒ job marked `ai_skipped`; `managed` metered+capped                   |
| F14 Autopilot run      | `autopilot_run`      | `runAi` (chat/tool) | same                                                                        |
| F15 index a batch      | `semantic_index`     | `runAi` (embed)     | `off` orgs are **not** indexed (no semantic surface for them); else metered |
| F15 query              | `semantic_query`     | `runAi` (embed)     | `off` ⇒ tool/surface returns "AI is turned off"; else metered               |

- Every model/embedding call is preceded by `requireAiEntitlement(orgId, feature)`; every call is
  wrapped in `runAi` so tokens/cost/credits land in `ai_usage` (indexed `(org_id, created_at)`).
- Agentic runs execute under a **service-role endpoint** but still resolve the org's adapter/key via
  `resolveAiAdapter(orgId)` (managed key, or the org's BYO/per-user key for the _chat_ decision) —
  the endpoint passes `orgId`; it does not hold a user session. Only **embeddings** use the fixed
  platform key.
- New adapter surface: `ProviderAdapter.embed?` + an `embeddingClient` for the platform model; a new
  gateway entrypoint `runEmbedding({orgId,userId,feature}, fn)` (a thin `runAi` sibling that meters an
  input-only call). Chat/tool agentic calls reuse `runAi` unchanged.

## 6. Performance & data-fetching budget (AGENTS.md #5)

- **First paint unchanged.** F13/F14 add no page-load surface beyond one builder action-row and a
  Settings "Autopilot" card (both inside already-open dialogs, static). F15's surfaces are static
  entry points / lazy panels (`next/dynamic`, `ssr:false`); the Ask tool adds nothing to first paint.
- **In-page toggles = 0 new server round-trips.** Semantic ⌘K mode / "Related" tab switches are
  **client state + History API** (`pushState`/`replaceState`), never a `<Link>`/router nav — no RSC
  re-run. Confirm cards / result lists live in client state.
- **Server round-trips only on explicit action.** A semantic search = **1 metered embed + 1 bounded
  `match_items`** per debounced submit. "Find similar" = **1 `match_items`** (the item's vector is
  already stored). No round-trip is triggered by tab/filter/sort.
- **The hot write path is untouched.** Item/cell writes do **no** synchronous embedding and add **no**
  `revalidatePath` (respecting the `group.ts` invariant) — a trigger only marks staleness; all
  embedding work is the async sweep. Index maintenance that must warm another surface uses targeted
  `updateTag`, never a board-page revalidate.
- **Bounded, indexed hot-path reads.** `match_items` is `ORDER BY … <=> … LIMIT k` over the **HNSW
  index** (ANN, sub-linear), k clamped ≤ 50 — never an unbounded scan of a growing table. RLS join is
  PK-keyed via `readable_board_ids()` (InitPlan, no N+1). `automation_ai_jobs`, `board_agent_runs`,
  and `item_embed_queue` are all indexed on their sweep/lookup keys and pruned like `automation_runs`.
- **Agentic execution is off the request path entirely** — cron/pg_net driven, so it never competes
  with a user request; per-run round + token caps bound worst-case model spend.

## 7. Testing strategy (TDD — written and executed; required item #5)

Matching the repo's `unit` (mocked Supabase / injected Anthropic client) + `integration`
(live-DB, `@example.com` throwaway orgs, `describe.skipIf(!PULSE_TEST_DB)`) split.

- **Pure units.** `ai_step` action Zod schema (rejects webhook/unknown in the allowed set); the F13
  decision validator (referential id/kind checks, drops invalid, empty-decision guard); the composite
  **document builder** for embeddings (asserts the serialized doc contains the intended text and
  **no** disallowed fields); `content_hash` stability (same input → same hash; changed text → changed
  hash); the `EmbeddingClient` (injected/mocked — **no real API calls**); `match_items` result mapper;
  the autopilot action validator.
- **Server/endpoint units.** The `/api/ai/automation-step`, `/api/ai/autopilot`, `/api/ai/embed`
  handlers with Supabase + gateway mocked: assert **HMAC verification rejects unsigned/tampered
  bodies**, `requireAiEntitlement` gates before token spend, `off`/quota short-circuit to
  `ai_skipped`/no-index, the chosen action is applied **only** via the confined path, idempotency
  (non-`pending` job ⇒ no-op), and per-run caps.
- **RLS boundary integration (one per new table — mandatory).**
  `item_embeddings`, `automation_ai_jobs`, `board_agent_runs`/`board_agents`, `item_embed_queue`:
  provision two orgs; assert org B **cannot** SELECT org A rows and has **no** client insert path.
  `match_items` RLS: org B's caller searching the same vector gets **none** of org A's items (proves
  SECURITY INVOKER + RLS scoping). Agentic confinement: an `ai_step` whose chosen action targets a
  foreign board/column is rejected by `automation_ai_apply` (reuses `_automation_run` guards) and
  logged, never applied.
- **Semantic quality integration.** Seed items with semantically-related but lexically-disjoint names,
  backfill embeddings (real platform key gated by `PULSE_TEST_DB`, or a deterministic fake embedder
  for CI), assert the related item ranks above an unrelated one and above what trigram would return.
- **All four gates green before any task is done:** `pnpm typecheck && pnpm lint && pnpm test &&
pnpm build`.

## 8. Migration-gating & ops

- **Migrations (via `scripts/new-migration.sh <slug>` only; applied by the USER to DEV, then
  `pnpm db:types` + advisors):** `vector` extension + `item_embeddings` + HNSW/board indexes +
  `match_items` RPC + `item_embed_queue` + its stale-marking triggers + `embed-sweep` cron (F15);
  `automation_ai_jobs` + `ai_step` branch in `_automation_run` + `automation_ai_apply` confined RPC +
  `automation-ai-reconcile` cron (F13); `board_agents` + `board_agent_runs` + `board_agent_fires` +
  `autopilot-sweep` cron + the **platform bot** auth/profiles seed (F14). Each is minted with a real
  UTC stamp, applied with the **same version+name** via `supabase-dev` MCP, and the ledger verified.
- **New env:** a **platform embedding key** (`OPENAI_EMBEDDING_API_KEY` or `VOYAGE_API_KEY`), and an
  **HMAC signing secret** for the `pg_net → endpoint` hops (server-only; never reaches the browser).
- **Advisors after each migration** (RLS/index/security). The bot user + service-role endpoints are
  the highest-risk surface — reviewed explicitly.

## 9. Execution DAG & parallelization (AGENTS.md #6)

**Independent units.** The two workstreams share **no files and no runtime state**, so they run in
**parallel worktrees**. Within them: F13→F14 is a hard sequential chain (F14 consumes F13's async-hop

- confined-apply substrate + the reconcile discipline). F15 splits into infra → pipeline → surfaces.

Per-task `Interfaces: Consumes / Produces` and the synthesized DAG live in the plan. Summary:

- **Track A — Agentic (critical path).**
  A1 async-hop substrate (`automation_ai_jobs`, HMAC endpoint scaffold, `automation-ai-reconcile`
  cron) → A2 `ai_step` action + confined `automation_ai_apply` + decision loop + builder row +
  dry-run → **A3 Autopilot** (`board_agents`/runs/fires, `autopilot-sweep`, bot identity, agent loop,
  Settings card). A1→A2→A3 sequential.
- **Track B — Semantic (parallel to A).**
  B1 pgvector infra (`vector` ext, `item_embeddings`, HNSW, `match_items` RPC) + gateway embed path +
  `EmbeddingClient` ‖ (parallel) B0 embedding-provider spike is folded into B1 → B2 async pipeline
  (queue + triggers + `embed-sweep` cron + `/api/ai/embed` + backfill) → B3 surfaces (`semantic_search_items`
  Ask tool, "find similar", optional ⌘K mode). B1→B2→B3 sequential; B1 has no dependency on Track A.

**Parallel batches (waves of concurrent agents / worktrees):**

- **Batch 1:** `A1` ‖ `B1` (both are the substrate roots; disjoint files; each writes its own
  migration — mint at different seconds per `new-migration.sh` guidance to avoid version collision).
- **Batch 2:** `A2` ‖ `B2`.
- **Batch 3:** `A3` ‖ `B3`.
- Final: joint verification (all four gates against merged state) + the guardrails ADR.

**Critical path = A1 → A2 → A3** (the agentic chain), the real wall-clock floor; Track B rides
alongside within the same three waves. If time-boxed, **A3 (Autopilot) is the natural deferral** — A1

- A2 deliver a usable "AI step in a rule," and B1–B3 deliver semantic search, independently of A3.

## 10. Open questions for reviewer

1. **Autopilot scope (F14).** Ship all three housekeeping tasks (triage / overdue-chase / goal-rollup)
   in v1, or land F13 + F15 first and phase F14 as a follow-on worktree (it is the long pole and the
   only piece needing the bot-identity migration)?
2. **Embedding model.** `text-embedding-3-small` (reuse OpenAI SDK, zero new dep) vs `voyage-3.5-lite`
   (Anthropic-recommended, new dep) — both behind the abstracted `EmbeddingClient`. Default to OpenAI?
3. **Semantic ⌘K mode (F15 surface #3).** Build the "Related" ⌘K group in v1, or ship only the Ask
   tool + "find similar" and add ⌘K semantic mode later?
4. **Composite embedding document.** Confirm the v1 doc = `name` + text-cell values + recent comment
   text (capped). Include status/dropdown **labels** (not ids) too, or names/comments only?
5. **Agentic privacy egress.** F13/F14 decisions send labels+ids (E4 parity). Any board where the AI
   step must see **raw cell text** to decide well? If so, gate it behind an explicit per-rule
   disclosure (mirrors E4/F12's raw-sample disclosure).

## 11. Owner greenlight — resolutions (2026-07-20)

Reviewed and approved for **full build**. The §10 open questions are resolved as:

1. **Autopilot (F14) scope → IN SCOPE for v1.** Build the full agentic chain **A1 → A2 → A3**,
   including the platform-bot `auth.users`/`profiles` seed migration (§4.3). F14 is **not** deferred.
   All three waves of the DAG run (Batch 1 `A1‖B1`, Batch 2 `A2‖B2`, Batch 3 `A3‖B3`, then Z).
2. **Embedding model → `text-embedding-3-small` (OpenAI, 1536-dim).** Reuse the existing OpenAI SDK
   path (zero new dependency). Keep the abstracted `EmbeddingClient` + `model` column + `content_hash`
   so a later swap to Voyage is a controlled re-index, per §4.5.
3. **Semantic ⌘K "Related" mode → deferred (optional).** Ship the two core F15 surfaces first — the
   `semantic_search_items` Ask tool + the "find similar" item action (B3). The ⌘K semantic group can
   land as a fast follow once the RPC is proven; do not block B3 on it.
4. **Composite embedding document → `name` + text-cell values + recent comment text, PLUS
   status/dropdown labels** (labels, never ids). The label add is small and materially improves
   recall for status-driven boards. No raw ids, no attachment bodies (§4.4 non-goals hold).
5. **Agentic privacy egress → labels+ids only (E4 parity) for v1.** No board is granted raw-cell-text
   egress in this build. If a future rule needs it, gate behind the explicit per-rule disclosure
   pattern — out of scope here.

**Build order:** proceed by the §9 execution DAG in three parallel worktree waves. Each migration is
minted via `scripts/new-migration.sh` and applied to DEV (`supabase-dev` MCP, same version+name),
with `pnpm db:types` + advisors after each, before the wave's tests are claimed green.
