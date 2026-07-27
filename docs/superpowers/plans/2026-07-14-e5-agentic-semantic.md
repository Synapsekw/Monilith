# Phase 10 · E5 — Agentic Automations + Semantic Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **UI tasks additionally require the `pulse-ui` + `frontend-design` skills.**

**Goal:** Give the automations engine model-driven, bounded, audited actions (F13) and a scheduled
Autopilot agent (F14), and add greenfield pgvector semantic search (F15) with an async embedding
pipeline — everything metered through the E1 gateway and RLS-confined.

**Architecture:** Two independent workstreams. **Track A (agentic)** reuses the engine's existing
`pg_net` + `pg_cron` + confined `_automation_run` executor, adding one new architectural piece — an
async model hop (`pg_net` → signed service endpoint → gateway → a _chosen_ bounded action applied
back through the confined executor). **Track B (semantic)** adds `vector`/HNSW storage + a
SECURITY-INVOKER `match_items` RPC + an async, out-of-band embedding pipeline (stale-queue → cron →
`/api/ai/embed`), surfaced as an Ask tool and "find similar." F13→F14 is the critical path; Track B
runs fully in parallel.

**Tech Stack:** Next.js 16 (App Router, Route Handlers, Server Actions), Supabase (Postgres +
pgvector + pg_cron + pg_net + RLS), Zod, Vitest, the E1 gateway (`runAi`/`resolveAiAdapter`/
`requireAiEntitlement`), OpenAI embeddings SDK (default embedding provider).

**Spec:** `docs/superpowers/specs/2026-07-14-e5-agentic-semantic-design.md` — read it first.

---

## Ground rules (apply to every task)

- **Migrations:** mint **only** with `scripts/new-migration.sh <slug>`; the **USER applies to DEV**
  (`supabase-dev` MCP, same version+name), then the agent runs `pnpm db:types` + advisors and commits
  the regenerated `src/types/database.types.ts` in the same task. Never hand-stamp a version. When two
  tasks in one batch each add a migration, mint them **seconds apart** (the script guards collisions).
- **Canonical modules (grep before writing a helper):** `ActionResult`/`fail`
  (`src/lib/actions/result.ts`), `typedRpc` (`src/lib/supabase/typed-rpc.ts`), `runAi`/
  `resolveAiAdapter` (`src/lib/ai/gateway.ts`), `requireAiEntitlement` (`src/lib/ai/entitlement.ts`),
  typed AI errors (`src/lib/ai/errors.ts`), the `ASK_TOOLS`/`executeAskTool` registry
  (`src/lib/ai/ask/tools.ts`), the confined executor `_automation_run`, and E3's `executeAction`
  (`src/lib/ai/write/execute.ts`).
- **Gates:** a task is done only when `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass.
- **No real API calls in tests** — inject/mock the Anthropic client and the `EmbeddingClient`.
- **Every new table ships an RLS isolation integration test** (`*.rls.integration.test.ts`,
  `describe.skipIf(!process.env.PULSE_TEST_DB)`).

---

## File structure (what each new/modified file owns)

**Track A — Agentic**

- `supabase/migrations/<stamp>_automation_ai_jobs.sql` — `automation_ai_jobs` ledger + indexes + RLS + `automation-ai-reconcile` cron.
- `supabase/migrations/<stamp>_automation_ai_step_apply.sql` — `ai_step` branch in `_automation_run` + `automation_ai_apply(p_job, p_action)` confined RPC.
- `supabase/migrations/<stamp>_board_agents.sql` — `board_agents`, `board_agent_runs`, `board_agent_fires`, `autopilot-sweep` cron, platform-bot seed.
- `src/lib/validations/automations.ts` — **MODIFY:** add `ai_step` to `automationActionSchema`.
- `src/lib/ai/agentic/decide.ts` — the F13 decision loop (model → one bounded action) + validator.
- `src/lib/ai/agentic/autopilot.ts` — the F14 agent loop.
- `src/lib/ai/agentic/context.ts` — labels+ids job/agent context builder (reuses `buildAutomationContext`).
- `src/lib/ai/agentic/hmac.ts` — sign/verify the `pg_net → endpoint` body.
- `src/app/api/ai/automation-step/route.ts` — F13 endpoint (service-role, HMAC).
- `src/app/api/ai/autopilot/route.ts` — F14 endpoint.
- `src/components/boards/automations/ActionRows.tsx` — **MODIFY:** `AiStepRow` editor.
- `src/components/boards/automations/AutopilotCard.tsx` — F14 board-settings config + kill switch.

**Track B — Semantic**

- `supabase/migrations/<stamp>_pgvector_item_embeddings.sql` — `vector` ext + `item_embeddings` + HNSW + `match_items` RPC.
- `supabase/migrations/<stamp>_item_embed_queue.sql` — `item_embed_queue` + stale-marking triggers + `embed-sweep` cron.
- `src/lib/ai/embeddings/client.ts` — `EmbeddingClient` interface + OpenAI impl (platform key).
- `src/lib/ai/embeddings/document.ts` — composite-document builder + `contentHash`.
- `src/lib/ai/embeddings/index-actions.ts` — `runEmbedding` gateway path; batch upsert.
- `src/lib/ai/embeddings/search.ts` — `semanticSearchItems(query)` + `findSimilarItems(itemId)`.
- `src/app/api/ai/embed/route.ts` — embed endpoint (service-role, HMAC; sweep + backfill modes).
- `src/lib/ai/ask/tools.ts` — **MODIFY:** add `semantic_search_items` tool.
- `src/components/boards/item-panel/FindSimilar.tsx` — "find similar" panel section.

---

# TRACK A — AGENTIC AUTOMATIONS (critical path)

## Task A1: Async-hop substrate — `automation_ai_jobs` + HMAC + reconcile cron

**Interfaces**

- **Consumes:** existing `pg_net`, `pg_cron`, `automation_runs`, `_automation_run` (all present).
- **Produces:** table `public.automation_ai_jobs`; `src/lib/ai/agentic/hmac.ts` (`signBody`/`verifyBody`); cron `automation-ai-reconcile`. Consumed by A2, A3.

**Files:**

- Create: `supabase/migrations/<stamp>_automation_ai_jobs.sql`
- Create: `src/lib/ai/agentic/hmac.ts`, `src/lib/ai/agentic/hmac.test.ts`
- Create: `src/lib/ai/agentic/automation_ai_jobs.rls.integration.test.ts`
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Write the failing HMAC test**

```ts
// src/lib/ai/agentic/hmac.test.ts
import { describe, it, expect } from "vitest";
import { signBody, verifyBody } from "./hmac";

const SECRET = "test-secret";
describe("agentic hmac", () => {
  it("round-trips a signed body", () => {
    const body = JSON.stringify({ job_id: "j1" });
    expect(verifyBody(body, signBody(body, SECRET), SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signBody(JSON.stringify({ job_id: "j1" }), SECRET);
    expect(verifyBody(JSON.stringify({ job_id: "j2" }), sig, SECRET)).toBe(
      false,
    );
  });
  it("rejects a wrong secret", () => {
    const body = JSON.stringify({ job_id: "j1" });
    expect(verifyBody(body, signBody(body, SECRET), "other")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm vitest run src/lib/ai/agentic/hmac.test.ts` → FAIL ("Cannot find module './hmac'").

- [ ] **Step 3: Implement `hmac.ts` (timing-safe)**

```ts
// src/lib/ai/agentic/hmac.ts — server-only
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
export function verifyBody(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signBody(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run it, verify pass.**

- [ ] **Step 5: Write the migration** (`scripts/new-migration.sh automation_ai_jobs`), body:

```sql
create table public.automation_ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  board_id      uuid not null references public.boards (id) on delete cascade,
  item_id       uuid references public.items (id) on delete set null,
  config        jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','done','skipped','error')),
  error         text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index automation_ai_jobs_pending_idx on public.automation_ai_jobs (created_at) where status = 'pending';
create index automation_ai_jobs_org_idx on public.automation_ai_jobs (org_id, created_at desc);

alter table public.automation_ai_jobs enable row level security;
-- read-only to org members; NO client insert/update (engine + service endpoint only)
create policy automation_ai_jobs_select on public.automation_ai_jobs
  for select using (public.is_member_of(org_id, auth.uid()));

-- timeout reconcile: pending > 10 min => error
create or replace function public._automation_ai_reconcile() returns void
language sql security definer set search_path = '' as $$
  update public.automation_ai_jobs
     set status = 'error', error = 'timeout', resolved_at = now()
   where status = 'pending' and created_at < now() - interval '10 minutes';
$$;
revoke execute on function public._automation_ai_reconcile() from public, anon, authenticated;
select cron.schedule('automation-ai-reconcile', '* * * * *',
  $cron$ select public._automation_ai_reconcile() $cron$);
```

> Match the exact `is_member_of` signature used elsewhere (grep the automations migrations). USER applies to DEV, then `pnpm db:types`.

- [ ] **Step 6: Write the RLS isolation integration test** — provision two `@example.com` orgs, insert a job for org A via service role, assert org B's cookie client `select` returns 0 rows and has no insert path. (Model on `src/lib/search/item-search.rls.integration.test.ts` harness.)

- [ ] **Step 7: Run all four gates, commit.**

```bash
git add supabase/migrations src/lib/ai/agentic/hmac.ts src/lib/ai/agentic/hmac.test.ts \
  src/lib/ai/agentic/automation_ai_jobs.rls.integration.test.ts src/types/database.types.ts
git commit -m "feat(ai): async-hop substrate for agentic automations (jobs ledger + hmac + reconcile)"
```

---

## Task A2: F13 — `ai_step` action, decision loop, confined apply, builder row, dry-run

**Interfaces**

- **Consumes:** A1 (`automation_ai_jobs`, hmac); `runAi`/`requireAiEntitlement`; `resolveAiAdapter`; `buildAutomationContext`; `askPulseLoop` shape; `automationActionSchema`; `AutomationBuilder`/`ActionRows`.
- **Produces:** `ai_step` action type; `automation_ai_apply` RPC; `decideAction` loop; `/api/ai/automation-step`; `AiStepRow` + dry-run. Consumed by A3 (reuses `decideAction` + confined apply + endpoint pattern).

**Files:**

- Create: `supabase/migrations/<stamp>_automation_ai_step_apply.sql`
- Modify: `src/lib/validations/automations.ts`, `src/lib/validations/automations.test.ts`
- Create: `src/lib/ai/agentic/context.ts` (+ test), `src/lib/ai/agentic/decide.ts` (+ test)
- Create: `src/app/api/ai/automation-step/route.ts` (+ `route.test.ts`)
- Modify: `src/components/boards/automations/ActionRows.tsx`, `AutomationBuilder.tsx`
- Create: `src/lib/ai/agentic/automation_ai_step.rls.integration.test.ts`

- [ ] **Step 1: Failing Zod test for the `ai_step` action** (append to `automations.test.ts`):

```ts
import { automationActionSchema } from "./automations";
it("accepts an ai_step with a bounded allowed set", () => {
  const r = automationActionSchema.safeParse({
    type: "ai_step",
    instruction: "Pick the right status",
    allow: ["set_option"],
  });
  expect(r.success).toBe(true);
});
it("rejects an ai_step that allows call_webhook", () => {
  const r = automationActionSchema.safeParse({
    type: "ai_step",
    instruction: "x",
    allow: ["call_webhook"],
  });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add the `ai_step` variant** to the `automationActionSchema` discriminated union in `src/lib/validations/automations.ts`:

```ts
const aiStepAction = z.object({
  type: z.literal("ai_step"),
  instruction: z.string().min(3).max(500),
  allow: z
    .array(z.enum(["set_option", "set_percent", "move_to_group", "notify"]))
    .min(1),
});
// add `aiStepAction` to the existing z.discriminatedUnion("type", [...])
```

- [ ] **Step 4: Run Zod test, verify pass.**

- [ ] **Step 5: Failing test for `decideAction`** (`src/lib/ai/agentic/decide.test.ts`) — DI a fake Anthropic client scripted to (a) read context, (b) emit one `set_option` tool call; assert the returned chosen action is referentially valid against a fixture context and that a webhook/foreign-column choice is dropped with a warning. Mirror `src/lib/ai/write/propose.test.ts`.

- [ ] **Step 6: Implement `context.ts` + `decide.ts`.** `context.ts` reuses `buildAutomationContext(...)` (labels+ids, no cell text). `decide.ts` — `decideAction({ apiKey, adapter, context, instruction, allow }) → { action | null, warnings, usage }`: a bounded tool-use loop (copy `askPulseLoop`'s shape, `MAX_ROUNDS = 3`) offering **only** the `allow`ed action tools, then referentially re-validate the chosen action against `context` (drop if the column/group/member id is foreign or the type is not in `allow`). No mutation here — it only decides.

- [ ] **Step 7: Run decide test, verify pass.**

- [ ] **Step 8: Write the migration** (`scripts/new-migration.sh automation_ai_step_apply`):
  - Add an `ai_step` branch to `_automation_run`: `INSERT automation_ai_jobs(...) ; perform net.http_post(<url>, <signed {job_id}>)` (URL + secret from a settings GUC/table; mirror the webhook branch exactly), then log an `ai_pending` outcome.
  - Add `automation_ai_apply(p_job uuid, p_action jsonb)` — `SECURITY DEFINER, search_path=''`: load the job, **re-apply the existing per-action confinement guards** (identical to `_automation_run`'s `set_option`/`set_percent`/`move_to_group`/`notify` branches — factor the shared branch or call an internal helper), write the `automation_runs` outcome (`ai_decided`/`ai_skipped`), set `automation_ai_jobs.status='done'`. `revoke execute ... from public, anon, authenticated; grant execute ... to service_role;`.
  - USER applies; `pnpm db:types`.

- [ ] **Step 9: Failing endpoint test** (`route.test.ts`) — mock Supabase + gateway; assert: unsigned/tampered body → 401; entitlement `off` → job `skipped`, no token spend; valid → `decideAction` called, chosen action applied **only** via `typedRpc("automation_ai_apply", …)`, non-`pending` job → no-op.

- [ ] **Step 10: Implement `/api/ai/automation-step/route.ts`** — service-role client; `verifyBody`; load job (scoped to `job.org_id/board_id`); `requireAiEntitlement(org, "automation_ai_step")` (catch → mark skipped); build context; `runAi({orgId, userId: job created_by ?? agent, feature: "automation_ai_step"}, () => decideAction(...))`; apply via `automation_ai_apply`.

- [ ] **Step 11: Run endpoint + RLS integration tests, verify pass.**

- [ ] **Step 12: Builder UI** (`pulse-ui` + `frontend-design`) — add `AiStepRow` to `ActionRows.tsx` (instruction textarea + allowed-action multiselect) and a **"Test this step"** button that calls a preview action running `decideAction` against a sample item **without** applying (returns the chosen action for display). Wire into `AutomationBuilder`.

- [ ] **Step 13: All four gates, commit.**

```bash
git add supabase/migrations src/lib/validations/automations.ts src/lib/validations/automations.test.ts \
  src/lib/ai/agentic/context.ts src/lib/ai/agentic/decide.ts src/lib/ai/agentic/*.test.ts \
  src/app/api/ai/automation-step src/components/boards/automations/ActionRows.tsx \
  src/components/boards/automations/AutomationBuilder.tsx src/types/database.types.ts
git commit -m "feat(ai): F13 AI action step in automations (decide loop + confined apply + dry-run)"
```

---

## Task A3: F14 — Autopilot scheduled agent (build only after A2 merges)

**Interfaces**

- **Consumes:** A2 (`decideAction`, confined-apply pattern, endpoint pattern), A1 (hmac); `_automation_date_sweep` pattern; `ASK_TOOLS` read handlers; E3 `executeAction`.
- **Produces:** `board_agents`/`board_agent_runs`/`board_agent_fires`; `autopilot-sweep` cron; platform-bot identity; `autopilotRun` loop; `/api/ai/autopilot`; `AutopilotCard`. (Terminal — nothing consumes it.)

**Files:**

- Create: `supabase/migrations/<stamp>_board_agents.sql`
- Create: `src/lib/ai/agentic/autopilot.ts` (+ test), `src/app/api/ai/autopilot/route.ts` (+ test)
- Create: `src/components/boards/automations/AutopilotCard.tsx` (+ test)
- Create: `src/lib/ai/agentic/board_agents.rls.integration.test.ts`

- [ ] **Step 1: Failing test for the agent action validator** — the autopilot loop may only emit `{move_to_group | notify | set_percent}` on the agent's board; a foreign-board or `set_option`-of-foreign-column choice is dropped with a warning. DI a fake Anthropic client.

- [ ] **Step 2: Implement `autopilot.ts`** — `autopilotRun({ apiKey, adapter, agentContext, tasks }) → { actions, warnings, usage }`: read via the `ASK_TOOLS` handlers (RLS-scoped), model chooses a bounded housekeeping action set within a round cap; reuse `decideAction`'s validator for confinement.

- [ ] **Step 3: Run, verify pass.**

- [ ] **Step 4: Migration** (`scripts/new-migration.sh board_agents`):
  - `board_agents(id, org_id, board_id, enabled boolean default true, cadence text check in ('daily','hourly'), run_at_local_hour int, config jsonb, created_by, timestamps)` + RLS (org-member read; admin write) + isolation.
  - `board_agent_runs(...)` audit table (mirror `automation_runs`) + `board_agent_fires(agent_id, fire_date)` idempotency ledger.
  - `autopilot-sweep` cron reusing the **exact** `_automation_date_sweep` org-`timezone` + fire-ledger pattern → `net.http_post → /api/ai/autopilot`.
  - **Platform bot seed:** create one `auth.users` row (`pulse-autopilot@…`, no password/login) + a `profiles` row flagged as an agent; expose its id via a `set-returning` helper `platform_agent_user_id()`.
  - USER applies; `pnpm db:types`.

- [ ] **Step 5: Failing endpoint test** — HMAC reject; entitlement gate; agent authors `item_updates`/`notifications` as `platform_agent_user_id()`; every write via the confined path; `board_agent_runs` row written; idempotent on redelivery.

- [ ] **Step 6: Implement `/api/ai/autopilot/route.ts`** (mirror A2's endpoint) + `AutopilotCard.tsx` (board-settings config + enable kill switch, `pulse-ui`).

- [ ] **Step 7: Run endpoint + RLS integration tests.**

- [ ] **Step 8: All four gates, commit.**

```bash
git commit -m "feat(ai): F14 Autopilot scheduled board agent (bot identity + bounded housekeeping)"
```

---

# TRACK B — SEMANTIC SEARCH (parallel to Track A)

## Task B1: pgvector infra — extension, `item_embeddings`, HNSW, `match_items`, embed gateway path

**Interfaces**

- **Consumes:** `items`/`boards` + `readable_board_ids()`; `runAi`/`record_ai_usage`; pricing.
- **Produces:** `item_embeddings` table + HNSW; `match_items` RPC; `EmbeddingClient` + OpenAI impl; `runEmbedding` gateway path; new pricing row + features. Consumed by B2, B3.

**Files:**

- Create: `supabase/migrations/<stamp>_pgvector_item_embeddings.sql`
- Create: `src/lib/ai/embeddings/client.ts` (+ test)
- Modify: `src/lib/ai/pricing.ts` (+ test), `src/lib/ai/gateway.ts` (add `runEmbedding`)
- Create: `src/lib/ai/embeddings/item_embeddings.rls.integration.test.ts`

- [ ] **Step 1: Failing pricing test** (append to `pricing.test.ts`):

```ts
it("prices the embedding model (input-only)", () => {
  expect(
    computeCostUsd("text-embedding-3-small", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    }),
  ).toBeCloseTo(0.02, 6);
});
```

- [ ] **Step 2: Run, verify fail. Step 3:** add `"text-embedding-3-small": { input: 0.02, output: 0 }` to `MODEL_PRICES_PER_MTOK`. **Step 4:** run, pass.

- [ ] **Step 5: Failing `EmbeddingClient` test** — inject a fake HTTP layer; `embed(["a","b"])` returns two 1536-length vectors; asserts batching + no real network. (`client.test.ts`.)

- [ ] **Step 6: Implement `client.ts`**

```ts
// src/lib/ai/embeddings/client.ts — server-only
import "server-only";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;
export interface EmbeddingClient {
  embed(
    texts: string[],
  ): Promise<{ vectors: number[][]; inputTokens: number; model: string }>;
}
// OpenAI impl reads the PLATFORM embedding key (getServerEnv().OPENAI_EMBEDDING_API_KEY),
// independent of org ai_mode. Voyage is the documented swap behind this same interface.
```

- [ ] **Step 7: Run, verify pass.**

- [ ] **Step 8: Add `runEmbedding` to `gateway.ts`** — a `runAi` sibling that meters an input-only call: `resolveAiAdapter` is bypassed (embeddings use the platform key), but `requireAiEntitlement(orgId, feature)` still gates and `record_ai_usage(org, user, feature, "openai", EMBEDDING_MODEL, inputTokens, 0, cost, credits)` still records.

- [ ] **Step 9: Write the migration** (`scripts/new-migration.sh pgvector_item_embeddings`):

```sql
create extension if not exists vector with schema extensions;

create table public.item_embeddings (
  item_id      uuid primary key references public.items (id) on delete cascade,
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  embedding    extensions.vector(1536) not null,
  content_hash text not null,
  model        text not null,
  embedded_at  timestamptz not null default now()
);
create index item_embeddings_ann_idx on public.item_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);
create index item_embeddings_board_idx on public.item_embeddings (board_id);

alter table public.item_embeddings enable row level security;
create policy item_embeddings_select on public.item_embeddings
  for select using (board_id in (select public.readable_board_ids()));
-- no client insert/update: writes only via the service embed endpoint.

create or replace function public.match_items(
  p_query_embedding extensions.vector,
  p_limit int default 20,
  p_board_id uuid default null,
  p_exclude_item_id uuid default null
) returns table (item_id uuid, name text, board_id uuid, board_name text, distance real)
language sql security invoker stable set search_path = '' as $$
  select e.item_id, i.name, e.board_id, b.name, (e.embedding operator(extensions.<=>) p_query_embedding)
  from public.item_embeddings e
  join public.items i on i.id = e.item_id
  join public.boards b on b.id = e.board_id
  where (p_board_id is null or e.board_id = p_board_id)
    and (p_exclude_item_id is null or e.item_id <> p_exclude_item_id)
  order by e.embedding operator(extensions.<=>) p_query_embedding
  limit least(greatest(p_limit, 1), 50);
$$;
revoke execute on function public.match_items(extensions.vector,int,uuid,uuid) from public;
grant execute on function public.match_items(extensions.vector,int,uuid,uuid) to authenticated, service_role;
```

> Confirm the exact `readable_board_ids()` signature by grepping `search_items`'s migration. USER applies; `pnpm db:types`.

- [ ] **Step 10: RLS isolation integration test** — service-role-insert an embedding for org A; org B's cookie client `select` on `item_embeddings` returns 0, and `match_items` from org B returns none of org A's items.

- [ ] **Step 11: All four gates, commit.**

```bash
git commit -m "feat(ai): pgvector item_embeddings + HNSW + match_items RPC + embed gateway path"
```

---

## Task B2: Async embedding pipeline — stale queue, triggers, sweep cron, embed endpoint, backfill

**Interfaces**

- **Consumes:** B1 (`item_embeddings`, `EmbeddingClient`, `runEmbedding`); A1 hmac; `pg_cron`/`pg_net`; `items`/`item_updates`/`cell_values`.
- **Produces:** `item_embed_queue` + triggers; `embed-sweep` cron; `document.ts` (composite doc + `contentHash`); `/api/ai/embed` (sweep + backfill). Consumed by B3.

**Files:**

- Create: `supabase/migrations/<stamp>_item_embed_queue.sql`
- Create: `src/lib/ai/embeddings/document.ts` (+ test), `src/lib/ai/embeddings/index-actions.ts` (+ test)
- Create: `src/app/api/ai/embed/route.ts` (+ test)
- Create: `src/lib/ai/embeddings/item_embed_queue.rls.integration.test.ts`

- [ ] **Step 1: Failing test for `buildItemDocument` + `contentHash`** (`document.test.ts`):

```ts
import { buildItemDocument, contentHash } from "./document";
it("composes name + text cells + recent comments and excludes non-text fields", () => {
  const doc = buildItemDocument({
    name: "Onboard Dana",
    textCells: ["Send laptop"],
    comments: ["welcome!"],
    statusLabels: ["To do"],
  });
  expect(doc).toContain("Onboard Dana");
  expect(doc).toContain("Send laptop");
});
it("hash is stable and change-sensitive", () => {
  const a = buildItemDocument({
    name: "x",
    textCells: [],
    comments: [],
    statusLabels: [],
  });
  expect(contentHash(a)).toBe(contentHash(a));
  expect(contentHash(a)).not.toBe(
    contentHash(
      buildItemDocument({
        name: "y",
        textCells: [],
        comments: [],
        statusLabels: [],
      }),
    ),
  );
});
```

- [ ] **Step 2: Run fail. Step 3:** implement `document.ts` (`buildItemDocument(parts)` joins capped text; `contentHash` = sha256 hex). **Step 4:** run pass.

- [ ] **Step 5: Failing test for `index-actions.embedBatch`** — inject a fake `EmbeddingClient`; assert items whose stored `content_hash + model` already match are **skipped** (no embed call), changed items are embedded + upserted, and `runEmbedding` meters once per batch.

- [ ] **Step 6: Implement `index-actions.ts`** — `embedBatch(itemIds)`: service-role read of each item's composite parts, build doc + hash, skip-if-unchanged, `runEmbedding(feature:"semantic_index", () => client.embed(docs))`, upsert `item_embeddings`, clear queue rows.

- [ ] **Step 7: Run, verify pass.**

- [ ] **Step 8: Migration** (`scripts/new-migration.sh item_embed_queue`):
  - `item_embed_queue(item_id uuid primary key references items(id) on delete cascade, org_id, board_id, enqueued_at timestamptz default now())`, RLS (no client access; service only).
  - `AFTER INSERT OR UPDATE OF name ON items` and `AFTER INSERT OR UPDATE OF body_text ON item_updates` triggers that `insert ... on conflict (item_id) do nothing` into the queue — **zero model work** (hot-path safe).
  - `embed-sweep` cron (every 2 min): select a bounded batch of queued item_ids → `net.http_post → /api/ai/embed {mode:'sweep', batch}` (signed).
  - USER applies; `pnpm db:types`.

- [ ] **Step 9: Failing endpoint test** — HMAC reject; `sweep` mode embeds the batch via `embedBatch`; `backfill` mode pages `items` in capped batches and is resumable/idempotent (re-run skips matching hash+model).

- [ ] **Step 10: Implement `/api/ai/embed/route.ts`** (service-role, `verifyBody`; `mode ∈ {sweep, backfill}`).

- [ ] **Step 11: Run endpoint + RLS tests. Step 12: gates, commit.**

```bash
git commit -m "feat(ai): async embedding pipeline (stale queue + sweep cron + embed endpoint + backfill)"
```

---

## Task B3: Semantic surfaces — Ask tool + "find similar"

**Interfaces**

- **Consumes:** B1 (`match_items`), B2 (embeddings populated), `EmbeddingClient`/`runEmbedding`; `ASK_TOOLS`/`executeAskTool`; `pulse-ui`.
- **Produces:** `semantic_search_items` Ask tool; `semanticSearchItems`/`findSimilarItems`; `FindSimilar` panel. (Terminal.)

**Files:**

- Create: `src/lib/ai/embeddings/search.ts` (+ test)
- Modify: `src/lib/ai/ask/tools.ts` (+ `tools.test.ts`)
- Create: `src/components/boards/item-panel/FindSimilar.tsx` (+ test)
- Create: `src/lib/ai/embeddings/search.rls.integration.test.ts`

- [ ] **Step 1: Failing test for `semanticSearchItems`** — mock `EmbeddingClient` (returns a fixed vector) + `typedRpc("match_items")`; assert one embed call (feature `semantic_query`, gated by `requireAiEntitlement`) then one `match_items` call, rows mapped to `{ id, name, boardId, boardName }`, `[]` on error (never throws).

- [ ] **Step 2: Run fail. Step 3:** implement `search.ts` — `semanticSearchItems(query)` (Zod `min(2).max(100)`; embed query; `typedRpc("match_items", {...})`) and `findSimilarItems(itemId)` (read the item's stored embedding; `match_items` with `p_exclude_item_id`; graceful "not indexed yet" when absent). **Step 4:** run pass.

- [ ] **Step 5: Failing test for the Ask tool** — assert `ASK_TOOLS` now contains `semantic_search_items` and `executeAskTool("semantic_search_items", {query}, ctx)` dispatches to the handler and never throws on bad input.

- [ ] **Step 6: Add the tool** to `src/lib/ai/ask/tools.ts` (Zod guard + `ASK_TOOLS` append + `executeAskTool` switch-case + RLS-scoped handler via `search.ts`). It auto-flows into E3's `proposeLoop`.

- [ ] **Step 7: Run pass. Step 8:** RLS integration test — org B `semanticSearchItems` returns none of org A's items.

- [ ] **Step 9: "Find similar" UI** (`pulse-ui` + `frontend-design`) — `FindSimilar.tsx` in the item panel: lazy, client-state, calls `findSimilarItems`, renders a small ranked list deep-linking `/boards/{boardId}?item={id}`; "indexing…" state when unembedded. Component test (mock the action).

- [ ] **Step 10: All four gates, commit.**

```bash
git commit -m "feat(ai): semantic Ask tool + find-similar over pgvector match_items"
```

---

## Task Z: Joint verification + guardrails ADR

- [ ] Rebase both tracks onto latest `develop`; run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` against the **merged** state.
- [ ] Run Supabase advisors on DEV after all migrations; confirm no new RLS/security warnings (special attention to the two service-role endpoints + the platform-bot user).
- [ ] Write `vault/decisions/2026-07-14-decision-XX-agentic-automation-guardrails.md` (the §4.1 guardrail box: human authorship, constrained reversible vocabulary, confined execution, audit + kill switch, entitlement/metering, dry-run).
- [ ] Author the **"How to test this"** manual walkthrough (below) for the closing message + `/wrapup`.

---

## Execution DAG (AGENTS.md #6)

**Dependency edges** (from each task's `Consumes`):

```
A1 ─▶ A2 ─▶ A3          (agentic chain — critical path)
B1 ─▶ B2 ─▶ B3          (semantic chain)
A1,A2,A3  ⟂  B1,B2,B3   (tracks are file- and runtime-disjoint)
Z depends on {A3, B3}
```

**Parallel batches** (each batch = one wave of concurrent worktree agents via
`superpowers:dispatching-parallel-agents`; the two tasks in a batch touch disjoint files — mint their
migrations seconds apart):

| Batch | Tasks (concurrent) | Notes                                  |
| ----- | ------------------ | -------------------------------------- |
| 1     | **A1 ‖ B1**        | substrate roots; each adds a migration |
| 2     | **A2 ‖ B2**        | A2 needs A1; B2 needs B1               |
| 3     | **A3 ‖ B3**        | A3 needs A2; B3 needs B2               |
| 4     | **Z**              | joint verify + ADR                     |

**Critical path (wall-clock floor):** `A1 → A2 → A3 → Z` — the agentic chain (A2 and A3 are the
heaviest: migration + endpoint + loop + UI each). Track B rides alongside in the same three waves and
does not extend the floor.

**Per-task size (rough):** A1 ≈ S, A2 ≈ L, A3 ≈ L, B1 ≈ M, B2 ≈ L, B3 ≈ M, Z ≈ S.

**Time-box lever:** if the epic must be trimmed, **defer A3 (Autopilot)** to a follow-on worktree — A1

- A2 (AI step in a rule) and B1–B3 (semantic search) are each independently shippable, and A3 is the
  only task needing the platform-bot migration.

---

## How to test this (manual acceptance — fill in at close, per track)

- **F13:** Open a board → Automations → build a rule with an **AI step** (e.g. trigger _item created_,
  action _AI step: "set the status that best fits the item name"_, allow `set_option`) → **Test this
  step** shows the chosen action without applying → **Save + enable** → create an item → confirm the
  status is set and a **Recent Runs** row shows `ai_decided`.
- **F14:** Board settings → **Autopilot** → enable "chase overdue owners, daily 8am" → trigger a manual
  run (or wait for the sweep) → confirm an @mention comment authored by **Monolith Autopilot** and a
  `board_agent_runs` entry.
- **F15:** After backfill, open ⌘K / Ask Monolith and search a **meaning-based** query with no literal
  overlap (e.g. "onboarding" → a "New-hire checklist" item) → open an item → **Find similar** lists
  semantically-related items. Confirm `ai_usage` shows `semantic_index`/`semantic_query` rows.
- Setup: pull `develop`; the USER must have applied all E5 migrations to DEV and set
  `OPENAI_EMBEDDING_API_KEY` + the agentic HMAC secret in the environment.

```

```
