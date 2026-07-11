# AI E1 Foundation Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 10 Epic 1 on the reconciled hybrid model — org-scoped AI settings (`off | managed | org_byo | per_user`, default `per_user`), a single gateway with metering (`ai_usage` ledger), entitlements, org/admin Settings UI, dashboard-gen migrated onto the gateway, and the flagship **Ask Pulse** workspace Q&A (Anthropic-gated, read-only, RLS-scoped tools).

**Architecture:** Extends the shipped per-user BYO foundation (`user_ai_credentials` + provider adapters) rather than replacing it. One migration adds `ai_mode`/`org_ai_settings`/`ai_usage` + Vault definer functions (mirroring the shipped `ai_credential_*` pattern). A new `src/lib/ai/gateway.ts` resolves all four modes and wraps every call in metering; `entitlement.ts` gates before any spend. Adapters gain a usage return + `supportsTools` flag. Ask Pulse runs a capped Anthropic tool-use loop over three RLS-scoped read tools. Spec: `docs/superpowers/specs/2026-07-11-ai-e1-scope-reconciliation-design.md` (delta on `2026-07-05-ai-foundation-and-ask-pulse-design.md`).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Supabase (RLS + Vault + SECURITY DEFINER fns), `@anthropic-ai/sdk` (manual tool-use loop), Zod, Zustand, Vitest + Testing Library.

---

## Global Constraints

Copied from AGENTS.md / the north-star — every task's requirements implicitly include these:

- **Server Components by default.** `"use client"` only for interactivity; **all mutations go through Server Actions**. This is Next.js 16 — confirm framework APIs against `node_modules/next/dist/docs/` before writing them.
- **RLS is the security boundary.** Default-deny, org-scoped; never trust the client. `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser. Vault decrypt paths are service-role-only definer functions.
- **Schema changes are versioned migrations** applied to **DEV via the `supabase-dev` MCP only** (never prod, never dashboard click-ops). After the migration: `pnpm db:types` and commit the regenerated `src/types/database.types.ts` in the same task. Run `get_advisors` — expect zero new warnings.
- **AI is an explicit, on-demand action, never a view toggle.** First paint unchanged; panels lazy (`next/dynamic`, `ssr: false`); in-panel state is client state (0 RSC navigations). Bounded reads only (`query_items` ≤ 50 rows; board payload reads already bounded).
- **No real API calls in tests.** The Anthropic client / adapters are dependency-injected and mocked everywhere.
- **Commit identity pinned.** Author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>`; conventional-commit subjects; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Commit your own work only.** Stage explicitly by path (`git add <paths>`) — never `git add -A`/`.`/`-a`.
- **Isolation.** Work in a worktree: `scripts/start-task.sh ai-e1-foundation` → `.claude/worktrees/ai-e1-foundation` on `task/ai-e1-foundation`. Done = `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green and `scripts/finish-task.sh` merged to `develop`.
- **Tests are mandatory (TDD):** failing test first, minimal change, green — evidence before claims.

## Execution DAG

Single worktree (`task/ai-e1-foundation`) — the tasks share `src/lib/ai/*` and one migration — but internally parallelizable when driven by subagents:

- **Wave 1 (no deps):** Task 1 (migration + types), Task 2 (pricing), Task 3 (errors), Task 4 (adapter usage + `supportsTools`), Task 10 (Ask Pulse tools)
- **Wave 2 (needs 1):** Task 5 (org-settings read), Task 13 (RLS integration tests)
- **Wave 3:** Task 6 (gateway — needs 2,3,4,5), Task 7 (entitlement — needs 3,5), Task 8 (org settings actions — needs 1,5), Task 9 (platform-admin plan control — needs 1,5)
- **Wave 4:** Task 11 (dashboard-gen migration — needs 6,7), Task 12 (Ask Pulse loop + action — needs 6,7,10), Task 14 (Settings UI — needs 8)
- **Wave 5:** Task 15 (Ask Pulse UI — needs 12), then Task 16 (gates + finish)

**Critical path:** 1 → 5 → 6 → 12 → 15 → 16.

**Interfaces (Consumes / Produces) summary:**

| Task | Produces                                                                                                                        | Consumed by       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1    | `ai_mode`, `org_ai_settings`, `ai_usage`, `org_ai_secret_*`, `record_ai_usage`, `ai_credits_used_this_month`, regenerated types | 5, 6, 7, 8, 9, 13 |
| 2    | `computeCostUsd`, `costToCredits`, `MODEL_PRICES_PER_MTOK`                                                                      | 6                 |
| 3    | `AiDisabledError`, `ByoKeyMissingError`, `AiQuotaExceededError`, `ProviderNotCapableError`                                      | 6, 7, 11, 12      |
| 4    | `ProviderAdapter.generateProposal → {proposal, usage}`, `supportsTools`                                                         | 6, 11, 12         |
| 5    | `readOrgAiSettings()`, `DEFAULT_ORG_AI_SETTINGS`                                                                                | 6, 7, 8           |
| 6    | `resolveAiAdapter(orgId)`, `runAi(...)`                                                                                         | 11, 12            |
| 7    | `getAiEntitlement`, `requireAiEntitlement`                                                                                      | 8, 11, 12         |
| 8    | `getOrgAiSettings`, `setAiMode`, `setOrgByoKey`, `removeOrgByoKey`                                                              | 14                |
| 10   | `ASK_TOOLS`, `executeAskTool`                                                                                                   | 12                |
| 12   | `askPulse()` server action                                                                                                      | 15                |

---

### Task 1: Migration — `ai_mode`, `org_ai_settings`, `ai_usage`, definer functions

**Files:**

- Create: `supabase/migrations/<ts>_ai_platform_foundation.sql` (timestamp from `date +%Y%m%d%H%M%S` at authoring time)
- Regenerate: `src/types/database.types.ts` (via `pnpm db:types` — never hand-edit)

**Interfaces:**

- Consumes: existing helpers `public.is_org_member(uuid)`, `public.has_org_role(uuid, org_role[])`, `public.set_updated_at()` (all from `20260614174043_init_auth_tenancy.sql` / `20260615061747_boards_core.sql`), Supabase Vault (`vault.create_secret`, `vault.decrypted_secrets`) — same pattern as `20260706164829_user_ai_credentials.sql`.
- Produces: enum `public.ai_mode`; tables `org_ai_settings`, `ai_usage`; functions `org_ai_secret_set/get/clear`, `record_ai_usage`, `ai_credits_used_this_month`. Missing `org_ai_settings` row ≡ `per_user` (handled in app code — no backfill).

- [ ] **Step 1: Write the migration SQL**

```sql
-- Phase 10 E1: org-scoped AI settings, usage ledger, org BYO secret (Vault).
-- Hybrid model (spec 2026-07-11-ai-e1-scope-reconciliation): ai_mode default
-- 'per_user' preserves the shipped per-user BYO behavior; a missing row is
-- treated as per_user by the app. user_ai_credentials is unchanged.

create type public.ai_mode as enum ('off', 'managed', 'org_byo', 'per_user');

create table public.org_ai_settings (
  org_id               uuid primary key references public.organizations (id) on delete cascade,
  ai_mode              public.ai_mode not null default 'per_user',
  tier                 text not null default 'none',
  monthly_credit_limit integer not null default 0,
  byo_provider         text check (byo_provider in ('anthropic', 'openai', 'google')),
  byo_secret_id        uuid,
  byo_key_last4        text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);

alter table public.org_ai_settings enable row level security;

-- Members read their org's settings (no secret material here — only the
-- opaque Vault id + last4). Admins write. Default-deny otherwise.
create policy "org_ai_settings_select_member"
  on public.org_ai_settings for select
  using (public.is_org_member(org_id));
create policy "org_ai_settings_insert_admin"
  on public.org_ai_settings for insert
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));
create policy "org_ai_settings_update_admin"
  on public.org_ai_settings for update
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create trigger org_ai_settings_set_updated_at
  before update on public.org_ai_settings
  for each row execute function public.set_updated_at();

-- Append-only usage ledger. Admin-readable; no client write path at all —
-- only the record_ai_usage definer (service role) inserts.
create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  user_id       uuid,
  feature       text not null,
  provider      text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10, 6) not null default 0,
  credits       numeric(10, 2) not null default 0,
  created_at    timestamptz not null default now()
);

create index ai_usage_org_created_idx on public.ai_usage (org_id, created_at desc);

alter table public.ai_usage enable row level security;

create policy "ai_usage_select_admin"
  on public.ai_usage for select
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

-- Org BYO secret: raw key lives ONLY in Supabase Vault. Mirrors the shipped
-- ai_credential_* functions (20260706164829), keyed on org instead of user.
create or replace function public.org_ai_secret_set(
  p_org uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_old uuid;
  v_secret_id uuid;
begin
  select byo_secret_id into v_old from public.org_ai_settings where org_id = p_org;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;

  v_secret_id := vault.create_secret(
    p_secret,
    'org_ai_key:' || p_org::text || ':' || p_provider,
    'Org BYO AI provider key'
  );

  insert into public.org_ai_settings (org_id, byo_provider, byo_secret_id, byo_key_last4)
  values (p_org, p_provider, v_secret_id, p_hint)
  on conflict (org_id) do update
    set byo_provider = excluded.byo_provider,
        byo_secret_id = excluded.byo_secret_id,
        byo_key_last4 = excluded.byo_key_last4;
end;
$$;

create or replace function public.org_ai_secret_get(p_org uuid)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select o.byo_provider, s.decrypted_secret
  from public.org_ai_settings o
  join vault.decrypted_secrets s on s.id = o.byo_secret_id
  where o.org_id = p_org;
$$;

create or replace function public.org_ai_secret_clear(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_old uuid;
begin
  select byo_secret_id into v_old from public.org_ai_settings where org_id = p_org;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
  update public.org_ai_settings
    set byo_provider = null, byo_secret_id = null, byo_key_last4 = null,
        ai_mode = case when ai_mode = 'org_byo' then 'per_user'::public.ai_mode else ai_mode end
    where org_id = p_org;
end;
$$;

-- Ledger write: the ONLY insert path into ai_usage; service role only.
create or replace function public.record_ai_usage(
  p_org uuid, p_user uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage
    (org_id, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, credits)
  values
    (p_org, p_user, p_feature, p_provider, p_model, p_input_tokens, p_output_tokens, p_cost_usd, p_credits);
$$;

create or replace function public.ai_credits_used_this_month(p_org uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(credits), 0)
  from public.ai_usage
  where org_id = p_org and created_at >= date_trunc('month', now());
$$;

revoke all on function public.org_ai_secret_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.org_ai_secret_get(uuid) from public, anon, authenticated;
revoke all on function public.org_ai_secret_clear(uuid) from public, anon, authenticated;
revoke all on function public.record_ai_usage(uuid, uuid, text, text, text, integer, integer, numeric, numeric) from public, anon, authenticated;
revoke all on function public.ai_credits_used_this_month(uuid) from public, anon, authenticated;
grant execute on function public.org_ai_secret_set(uuid, text, text, text) to service_role;
grant execute on function public.org_ai_secret_get(uuid) to service_role;
grant execute on function public.org_ai_secret_clear(uuid) to service_role;
grant execute on function public.record_ai_usage(uuid, uuid, text, text, text, integer, integer, numeric, numeric) to service_role;
grant execute on function public.ai_credits_used_this_month(uuid) to service_role;
```

- [ ] **Step 2: Apply to DEV** via the `supabase-dev` MCP `apply_migration` tool (name: `ai_platform_foundation`, query: the SQL above). Never prod.
- [ ] **Step 3: Regenerate types** — Run: `pnpm db:types`. Expected: `src/types/database.types.ts` now contains `ai_mode` enum, `org_ai_settings` / `ai_usage` rows, and the five function signatures.
- [ ] **Step 4: Run advisors** via `supabase-dev` MCP `get_advisors` (both `security` and `performance`). Expected: zero NEW warnings versus before the migration.
- [ ] **Step 5: Typecheck** — Run: `pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_ai_platform_foundation.sql src/types/database.types.ts
git commit -m "feat(ai): org ai settings, usage ledger and org vault secret schema"
```

---

### Task 2: Pricing module

**Files:**

- Create: `src/lib/ai/pricing.ts`
- Test: `src/lib/ai/pricing.test.ts`

**Interfaces:**

- Consumes: nothing (pure).
- Produces: `type AiUsageTokens = { inputTokens: number; outputTokens: number }`, `computeCostUsd(model, usage)`, `costToCredits(costUsd)`, `MODEL_PRICES_PER_MTOK`. **1 credit = $0.01** (so a $5 monthly ceiling = 500 credits). Unknown model → cost 0 (logged tokens still land in the ledger).

- [ ] **Step 1: Write the failing test** — `src/lib/ai/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeCostUsd, costToCredits } from "@/lib/ai/pricing";

describe("pricing", () => {
  it("computes claude-opus-4-8 cost from per-MTok prices ($5 in / $25 out)", () => {
    // 1M input + 1M output = $5 + $25
    expect(
      computeCostUsd("claude-opus-4-8", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(30, 6);
    // 2000 in / 500 out = 2000*5/1e6 + 500*25/1e6 = 0.0225
    expect(
      computeCostUsd("claude-opus-4-8", {
        inputTokens: 2000,
        outputTokens: 500,
      }),
    ).toBeCloseTo(0.0225, 6);
  });

  it("returns 0 for an unknown model (tokens still recorded upstream)", () => {
    expect(
      computeCostUsd("some-future-model", {
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBe(0);
  });

  it("converts cost to credits at 1 credit = $0.01, 2dp", () => {
    expect(costToCredits(0.0225)).toBe(2.25);
    expect(costToCredits(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `pnpm vitest run src/lib/ai/pricing.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Write the implementation** — `src/lib/ai/pricing.ts`:

```ts
export type AiUsageTokens = { inputTokens: number; outputTokens: number };

/**
 * USD per million tokens, by model id. Source of truth for metering.
 * Maintain alongside the provider catalog when models change.
 */
export const MODEL_PRICES_PER_MTOK: Record<
  string,
  { input: number; output: number }
> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

/** Cost in USD for one call. Unknown models cost 0 (tokens are still logged). */
export function computeCostUsd(model: string, usage: AiUsageTokens): number {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) return 0;
  return (
    (usage.inputTokens * price.input + usage.outputTokens * price.output) /
    1_000_000
  );
}

/** 1 credit = $0.01, rounded to 2 decimal places. */
export function costToCredits(costUsd: number): number {
  return Math.round(costUsd * 100 * 100) / 100;
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `pnpm vitest run src/lib/ai/pricing.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/pricing.ts src/lib/ai/pricing.test.ts
git commit -m "feat(ai): per-model price table and credit conversion"
```

---

### Task 3: Typed AI errors

**Files:**

- Create: `src/lib/ai/errors.ts`
- Test: `src/lib/ai/errors.test.ts`

**Interfaces:**

- Consumes: nothing. (`AiNotConfiguredError` stays where it is, in `src/lib/ai/anthropic.ts`, because shipped code imports it from there; `errors.ts` re-exports it so new code has one import site.)
- Produces: `AiDisabledError`, `ByoKeyMissingError`, `AiQuotaExceededError`, `ProviderNotCapableError` — all `extends Error` with fixed `name`s.

- [ ] **Step 1: Write the failing test** — `src/lib/ai/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";

describe("ai errors", () => {
  it("each error has a stable name for instanceof-free checks", () => {
    expect(new AiDisabledError().name).toBe("AiDisabledError");
    expect(new ByoKeyMissingError().name).toBe("ByoKeyMissingError");
    expect(new AiQuotaExceededError().name).toBe("AiQuotaExceededError");
    expect(new ProviderNotCapableError("ask_pulse").name).toBe(
      "ProviderNotCapableError",
    );
  });
});
```

- [ ] **Step 2: Run test** — `pnpm vitest run src/lib/ai/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — `src/lib/ai/errors.ts`:

```ts
export { AiNotConfiguredError } from "@/lib/ai/anthropic";

/** org_ai_settings.ai_mode = 'off'. */
export class AiDisabledError extends Error {
  constructor() {
    super("AI is turned off for this organization.");
    this.name = "AiDisabledError";
  }
}

/** ai_mode = 'org_byo' but no org secret stored. */
export class ByoKeyMissingError extends Error {
  constructor() {
    super("This organization's AI key is missing.");
    this.name = "ByoKeyMissingError";
  }
}

/** Managed org exhausted its monthly credit allowance. */
export class AiQuotaExceededError extends Error {
  constructor() {
    super("This month's AI allowance is used up.");
    this.name = "AiQuotaExceededError";
  }
}

/** Resolved provider can't run this feature (e.g. tool use needs Anthropic). */
export class ProviderNotCapableError extends Error {
  constructor(public readonly feature: string) {
    super(`The configured AI provider can't run ${feature}.`);
    this.name = "ProviderNotCapableError";
  }
}
```

- [ ] **Step 4: Run test** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/ai/errors.ts src/lib/ai/errors.test.ts && git commit -m "feat(ai): typed gateway/entitlement errors"`

---

### Task 4: Adapters return usage + `supportsTools`

**Files:**

- Modify: `src/lib/ai/providers/types.ts` (interface), `src/lib/ai/providers/anthropic.ts`, `src/lib/ai/providers/openai.ts`, `src/lib/ai/providers/google.ts`
- Modify: `src/lib/ai/generate.ts` (return shape passthrough — full rewire happens in Task 11)
- Test: `src/lib/ai/providers/adapters.test.ts` (extend), `src/lib/ai/generate.test.ts` (update return shape)

**Interfaces:**

- Consumes: existing adapter SDK calls.
- Produces: `ProviderAdapter.generateProposal` now returns `Promise<{ proposal: DashboardProposal; usage: AiUsageTokens }>`; new required field `supportsTools: boolean` (`true` only for Anthropic). `generateProposal` in `generate.ts` propagates `{ proposal, usage }`.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/ai/providers/adapters.test.ts` (follow the file's existing SDK-mock setup; the mocked Anthropic response must now include `usage`):

```ts
it("anthropic adapter reports token usage and supports tools", async () => {
  // extend the existing messages.parse mock response with:
  //   usage: { input_tokens: 1200, output_tokens: 340 }
  const { proposal, usage } = await anthropicAdapter.generateProposal({
    apiKey: "sk-ant-test",
    system: "s",
    user: "u",
  });
  expect(proposal).toBeTruthy();
  expect(usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  expect(anthropicAdapter.supportsTools).toBe(true);
});

it("openai/google adapters report usage (0 when absent) and do not support tools", async () => {
  // openai mock: usage: { prompt_tokens: 800, completion_tokens: 200 }
  const o = await openaiAdapter.generateProposal({
    apiKey: "sk-test",
    system: "s",
    user: "u",
  });
  expect(o.usage).toEqual({ inputTokens: 800, outputTokens: 200 });
  expect(openaiAdapter.supportsTools).toBe(false);
  // google mock: no usageMetadata → zeros
  const g = await googleAdapter.generateProposal({
    apiKey: "g-test",
    system: "s",
    user: "u",
  });
  expect(g.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  expect(googleAdapter.supportsTools).toBe(false);
});
```

- [ ] **Step 2: Run** — `pnpm vitest run src/lib/ai/providers/adapters.test.ts`. Expected: FAIL (type + runtime).
- [ ] **Step 3: Implement.** In `types.ts`:

```ts
import type { AiUsageTokens } from "@/lib/ai/pricing";

export interface ProviderAdapter {
  id: AiProvider;
  label: string;
  placeholder: string;
  keyFormat: z.ZodType<string>;
  defaultModel: string;
  /** True when the provider path implements tool use (Ask Pulse etc.). v1: Anthropic only. */
  supportsTools: boolean;
  validateKey(rawKey: string): Promise<void>;
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
  }): Promise<{ proposal: DashboardProposal; usage: AiUsageTokens }>;
}
```

Per adapter, read usage off the SDK response and add the flag:

- `anthropic.ts`: `supportsTools: true`; after `messages.parse` → `usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }`, return `{ proposal, usage }`.
- `openai.ts`: `supportsTools: false`; `usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 }`.
- `google.ts`: `supportsTools: false`; `usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 }`.

In `generate.ts`, change the return type only (resolution unchanged until Task 11):

```ts
export async function generateProposal(
  snap: BoardSnapshot,
  opts: { adapter?: ProviderAdapter; apiKey?: string; feedback?: string } = {},
): Promise<{ proposal: DashboardProposal; usage: AiUsageTokens }> {
  const { adapter, apiKey } =
    opts.adapter && opts.apiKey
      ? { adapter: opts.adapter, apiKey: opts.apiKey }
      : await resolveUserAdapter();
  return adapter.generateProposal({
    apiKey,
    system: buildSystemPrompt(),
    user: buildUserPrompt(snap, opts.feedback),
  });
}
```

Update `src/lib/ai/actions.ts` call site minimally: `const { proposal } = await generateProposal(snap, { feedback });` and fix `generate.test.ts` / `actions.test.ts` mocks to return `{ proposal, usage }`.

- [ ] **Step 4: Run the AI suite** — `pnpm vitest run src/lib/ai`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/ai/providers/*.ts src/lib/ai/generate.ts src/lib/ai/generate.test.ts src/lib/ai/actions.ts src/lib/ai/actions.test.ts && git commit -m "feat(ai): adapters report token usage and a supportsTools capability"`

---

### Task 5: Org settings read — `readOrgAiSettings`

**Files:**

- Create: `src/lib/ai/org-settings.ts`
- Test: `src/lib/ai/org-settings.test.ts`

**Interfaces:**

- Consumes: `org_ai_settings` table (Task 1 types); accepts any Supabase client (service or RLS-scoped) so the gateway and the settings page share one reader.
- Produces:

```ts
export type AiMode = "off" | "managed" | "org_byo" | "per_user";
export type OrgAiSettings = {
  mode: AiMode;
  tier: string;
  monthlyCreditLimit: number;
  byoProvider: AiProvider | null;
  byoKeyLast4: string | null;
};
export const DEFAULT_ORG_AI_SETTINGS: OrgAiSettings; // per_user / 'none' / 0 / nulls
export async function readOrgAiSettings(client, orgId): Promise<OrgAiSettings>;
```

- [ ] **Step 1: Write the failing test** — `src/lib/ai/org-settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORG_AI_SETTINGS,
  readOrgAiSettings,
} from "@/lib/ai/org-settings";

function clientReturning(row: unknown, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as never;
}

describe("readOrgAiSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("missing row resolves to the per_user default", async () => {
    const settings = await readOrgAiSettings(clientReturning(null), "org-1");
    expect(settings).toEqual(DEFAULT_ORG_AI_SETTINGS);
    expect(settings.mode).toBe("per_user");
  });

  it("maps a row to the settings shape", async () => {
    const settings = await readOrgAiSettings(
      clientReturning({
        ai_mode: "managed",
        tier: "pro",
        monthly_credit_limit: 500,
        byo_provider: null,
        byo_key_last4: null,
      }),
      "org-1",
    );
    expect(settings).toEqual({
      mode: "managed",
      tier: "pro",
      monthlyCreditLimit: 500,
      byoProvider: null,
      byoKeyLast4: null,
    });
  });

  it("throws on a DB error (fail closed, not fail open)", async () => {
    await expect(
      readOrgAiSettings(clientReturning(null, { message: "boom" }), "org-1"),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** — `pnpm vitest run src/lib/ai/org-settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — `src/lib/ai/org-settings.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { AiProvider } from "@/lib/ai/providers/catalog";

export type AiMode = Database["public"]["Enums"]["ai_mode"];

export type OrgAiSettings = {
  mode: AiMode;
  tier: string;
  monthlyCreditLimit: number;
  byoProvider: AiProvider | null;
  byoKeyLast4: string | null;
};

/** A missing org_ai_settings row means the shipped default: members' own keys. */
export const DEFAULT_ORG_AI_SETTINGS: OrgAiSettings = {
  mode: "per_user",
  tier: "none",
  monthlyCreditLimit: 0,
  byoProvider: null,
  byoKeyLast4: null,
};

export async function readOrgAiSettings(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgAiSettings> {
  const { data, error } = await client
    .from("org_ai_settings")
    .select("ai_mode, tier, monthly_credit_limit, byo_provider, byo_key_last4")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_ORG_AI_SETTINGS;
  return {
    mode: data.ai_mode,
    tier: data.tier,
    monthlyCreditLimit: data.monthly_credit_limit,
    byoProvider: (data.byo_provider as AiProvider | null) ?? null,
    byoKeyLast4: data.byo_key_last4,
  };
}
```

- [ ] **Step 4: Run** — Expected: PASS. Note: the test file needs no `server-only` shim if the repo's vitest setup already aliases it (check `vitest.config` / existing `credentials.test.ts` — it tests a `server-only` module, so the alias exists).
- [ ] **Step 5: Commit** — `git add src/lib/ai/org-settings.ts src/lib/ai/org-settings.test.ts && git commit -m "feat(ai): org ai settings reader with per_user default"`

---### Task 6: Gateway — `resolveAiAdapter` + `runAi`

**Files:**

- Create: `src/lib/ai/gateway.ts`
- Test: `src/lib/ai/gateway.test.ts`

**Interfaces:**

- Consumes: `readOrgAiSettings` (5), `getAdapter` (registry), `resolveUserAdapter` (shipped), `getServerEnv().ANTHROPIC_API_KEY`, `computeCostUsd`/`costToCredits` (2), errors (3), `createServiceClient`.
- Produces:

```ts
export type ResolvedAi = {
  adapter: ProviderAdapter;
  apiKey: string;
  mode: AiMode;
  provider: AiProvider;
};
export async function resolveAiAdapter(orgId: string): Promise<ResolvedAi>;
export async function runAi<T>(
  args: { orgId: string; userId: string; feature: string },
  fn: (
    resolved: ResolvedAi,
  ) => Promise<{ result: T; usage: AiUsageTokens; model: string }>,
): Promise<T>;
```

Every AI call site goes through `runAi` so nothing is unmetered. Ledger-write failure logs (`console.error`) but does not fail the user's call — telemetry loss must not break the feature; revisit if managed billing hardens (E6).

- [ ] **Step 1: Write the failing test** — `src/lib/ai/gateway.test.ts` (mock module pattern copied from `credentials-actions.test.ts` — lazy `await import` after mocks):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

const resolveUserAdapter = vi.fn();
vi.mock("@/lib/ai/credentials", () => ({
  resolveUserAdapter: (...a: unknown[]) => resolveUserAdapter(...a),
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ ANTHROPIC_API_KEY: process.env.TEST_MANAGED_KEY }),
}));

const anthropicAdapter = { id: "anthropic", supportsTools: true };
const googleAdapter = { id: "google", supportsTools: false };
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: (p: string) =>
    p === "google" ? googleAdapter : anthropicAdapter,
}));

function settingsRow(mode: string, extra: Record<string, unknown> = {}) {
  maybeSingle.mockResolvedValue({
    data: {
      ai_mode: mode,
      tier: "none",
      monthly_credit_limit: 0,
      byo_provider: null,
      byo_key_last4: null,
      ...extra,
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TEST_MANAGED_KEY;
});

describe("resolveAiAdapter — 4-mode matrix", () => {
  it("off → AiDisabledError", async () => {
    settingsRow("off");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter("org-1")).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("managed → anthropic adapter + env key; missing env key → AiNotConfiguredError", async () => {
    settingsRow("managed");
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    await expect(resolveAiAdapter("org-1")).rejects.toMatchObject({
      name: "AiNotConfiguredError",
    });
    process.env.TEST_MANAGED_KEY = "sk-ant-managed";
    const r = await resolveAiAdapter("org-1");
    expect(r).toMatchObject({
      mode: "managed",
      provider: "anthropic",
      apiKey: "sk-ant-managed",
    });
  });

  it("org_byo → org vault secret via rpc; no secret → ByoKeyMissingError", async () => {
    settingsRow("org_byo", { byo_provider: "google" });
    rpc.mockResolvedValueOnce({
      data: [{ provider: "google", secret: "g-key" }],
      error: null,
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter("org-1");
    expect(rpc).toHaveBeenCalledWith("org_ai_secret_get", { p_org: "org-1" });
    expect(r).toMatchObject({
      mode: "org_byo",
      provider: "google",
      apiKey: "g-key",
    });

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveAiAdapter("org-1")).rejects.toMatchObject({
      name: "ByoKeyMissingError",
    });
  });

  it("per_user (and missing row) → resolveUserAdapter passthrough", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null }); // missing row ≡ per_user
    resolveUserAdapter.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    const { resolveAiAdapter } = await import("@/lib/ai/gateway");
    const r = await resolveAiAdapter("org-1");
    expect(r).toMatchObject({ mode: "per_user", apiKey: "sk-user" });
  });
});

describe("runAi", () => {
  it("invokes fn with the resolved adapter and records a ledger row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapter.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    rpc.mockResolvedValue({ data: null, error: null });
    const { runAi } = await import("@/lib/ai/gateway");

    const out = await runAi(
      { orgId: "org-1", userId: "u-1", feature: "dashboard_gen" },
      async () => ({
        result: "ok",
        usage: { inputTokens: 2000, outputTokens: 500 },
        model: "claude-opus-4-8",
      }),
    );

    expect(out).toBe("ok");
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_org: "org-1",
        p_user: "u-1",
        p_feature: "dashboard_gen",
        p_provider: "anthropic",
        p_model: "claude-opus-4-8",
        p_input_tokens: 2000,
        p_output_tokens: 500,
        p_cost_usd: 0.0225,
        p_credits: 2.25,
      }),
    );
  });

  it("a failed ledger write does not fail the call", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    resolveUserAdapter.mockResolvedValue({
      adapter: anthropicAdapter,
      apiKey: "sk-user",
    });
    rpc.mockResolvedValue({ data: null, error: { message: "ledger down" } });
    const { runAi } = await import("@/lib/ai/gateway");
    await expect(
      runAi({ orgId: "o", userId: "u", feature: "f" }, async () => ({
        result: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        model: "m",
      })),
    ).resolves.toBe(1);
  });
});
```

- [ ] **Step 2: Run** — `pnpm vitest run src/lib/ai/gateway.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — `src/lib/ai/gateway.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { getServerEnv } from "@/lib/env.server";
import { AiNotConfiguredError } from "@/lib/ai/anthropic";
import { AiDisabledError, ByoKeyMissingError } from "@/lib/ai/errors";
import { resolveUserAdapter } from "@/lib/ai/credentials";
import { getAdapter } from "@/lib/ai/providers/registry";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";
import {
  computeCostUsd,
  costToCredits,
  type AiUsageTokens,
} from "@/lib/ai/pricing";

export type ResolvedAi = {
  adapter: ProviderAdapter;
  apiKey: string;
  mode: AiMode;
  provider: AiProvider;
};

/** The single chokepoint: picks the key + adapter for the org's ai_mode. */
export async function resolveAiAdapter(orgId: string): Promise<ResolvedAi> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);

  switch (settings.mode) {
    case "off":
      throw new AiDisabledError();
    case "managed": {
      const apiKey = getServerEnv().ANTHROPIC_API_KEY;
      if (!apiKey) throw new AiNotConfiguredError();
      return {
        adapter: getAdapter("anthropic"),
        apiKey,
        mode: "managed",
        provider: "anthropic",
      };
    }
    case "org_byo": {
      const { data, error } = await svc.rpc("org_ai_secret_get", {
        p_org: orgId,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row?.secret) throw new ByoKeyMissingError();
      const provider = row.provider as AiProvider;
      return {
        adapter: getAdapter(provider),
        apiKey: row.secret,
        mode: "org_byo",
        provider,
      };
    }
    case "per_user": {
      const { adapter, apiKey } = await resolveUserAdapter();
      return { adapter, apiKey, mode: "per_user", provider: adapter.id };
    }
  }
}

/**
 * Wraps one AI call: resolve → invoke → meter. All spend flows through here.
 * A ledger-write failure is logged, never surfaced — telemetry loss must not
 * break the user's request (revisit when managed billing hardens in E6).
 */
export async function runAi<T>(
  args: { orgId: string; userId: string; feature: string },
  fn: (
    resolved: ResolvedAi,
  ) => Promise<{ result: T; usage: AiUsageTokens; model: string }>,
): Promise<T> {
  const resolved = await resolveAiAdapter(args.orgId);
  const { result, usage, model } = await fn(resolved);
  const costUsd = computeCostUsd(model, usage);
  const svc = createServiceClient();
  const { error } = await svc.rpc("record_ai_usage", {
    p_org: args.orgId,
    p_user: args.userId,
    p_feature: args.feature,
    p_provider: resolved.provider,
    p_model: model,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cost_usd: costUsd,
    p_credits: costToCredits(costUsd),
  });
  if (error) console.error("[ai] record_ai_usage failed:", error.message);
  return result;
}
```

- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/ai/gateway.ts src/lib/ai/gateway.test.ts && git commit -m "feat(ai): four-mode gateway with metering wrapper"`

---

### Task 7: Entitlements

**Files:**

- Create: `src/lib/ai/entitlement.ts`
- Test: `src/lib/ai/entitlement.test.ts`

**Interfaces:**

- Consumes: `readOrgAiSettings` (5), `ai_credits_used_this_month` RPC (1), errors (3), `createServiceClient`.
- Produces: `getAiEntitlement(orgId)` → `{ mode, tier, creditsLimit, creditsUsed, creditsRemaining }`; `requireAiEntitlement(orgId, feature)` → throws `AiDisabledError` (off) / `AiQuotaExceededError` (managed & remaining ≤ 0), passes otherwise. `creditsRemaining` is `Infinity` for non-managed modes.

- [ ] **Step 1: Write the failing test** — `src/lib/ai/entitlement.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

function settingsRow(mode: string, limit = 0) {
  maybeSingle.mockResolvedValue({
    data: {
      ai_mode: mode,
      tier: "pro",
      monthly_credit_limit: limit,
      byo_provider: null,
      byo_key_last4: null,
    },
    error: null,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("entitlement", () => {
  it("off → requireAiEntitlement throws AiDisabledError", async () => {
    settingsRow("off");
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    await expect(
      requireAiEntitlement("org-1", "ask_pulse"),
    ).rejects.toMatchObject({
      name: "AiDisabledError",
    });
  });

  it("managed within budget passes; exhausted throws AiQuotaExceededError", async () => {
    settingsRow("managed", 500);
    rpc.mockResolvedValueOnce({ data: 100, error: null }); // credits used
    const { requireAiEntitlement, getAiEntitlement } =
      await import("@/lib/ai/entitlement");
    await expect(
      requireAiEntitlement("org-1", "dashboard_gen"),
    ).resolves.toBeUndefined();

    rpc.mockResolvedValueOnce({ data: 500, error: null });
    await expect(
      requireAiEntitlement("org-1", "dashboard_gen"),
    ).rejects.toMatchObject({
      name: "AiQuotaExceededError",
    });

    rpc.mockResolvedValueOnce({ data: 100, error: null });
    expect(await getAiEntitlement("org-1")).toEqual({
      mode: "managed",
      tier: "pro",
      creditsLimit: 500,
      creditsUsed: 100,
      creditsRemaining: 400,
    });
  });

  it("per_user and org_byo pass without a credit check", async () => {
    settingsRow("per_user");
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    await expect(
      requireAiEntitlement("org-1", "ask_pulse"),
    ).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — `src/lib/ai/entitlement.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/errors";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";

export type AiEntitlement = {
  mode: AiMode;
  tier: string;
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
};

export async function getAiEntitlement(orgId: string): Promise<AiEntitlement> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);
  if (settings.mode !== "managed") {
    return {
      mode: settings.mode,
      tier: settings.tier,
      creditsLimit: settings.monthlyCreditLimit,
      creditsUsed: 0,
      creditsRemaining: Infinity,
    };
  }
  const { data, error } = await svc.rpc("ai_credits_used_this_month", {
    p_org: orgId,
  });
  if (error) throw error;
  const used = Number(data ?? 0);
  return {
    mode: "managed",
    tier: settings.tier,
    creditsLimit: settings.monthlyCreditLimit,
    creditsUsed: used,
    creditsRemaining: Math.max(0, settings.monthlyCreditLimit - used),
  };
}

/** Gate every AI Server Action BEFORE doing any work. Fails closed with typed errors. */
export async function requireAiEntitlement(
  orgId: string,
  _feature: string,
): Promise<void> {
  const entitlement = await getAiEntitlement(orgId);
  if (entitlement.mode === "off") throw new AiDisabledError();
  if (entitlement.mode === "managed" && entitlement.creditsRemaining <= 0) {
    throw new AiQuotaExceededError();
  }
}
```

- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/ai/entitlement.ts src/lib/ai/entitlement.test.ts && git commit -m "feat(ai): entitlement gate with managed credit ceiling"`

---

### Task 8: Org AI settings Server Actions

**Files:**

- Create: `src/lib/ai/settings-actions.ts`
- Test: `src/lib/ai/settings-actions.test.ts`

**Interfaces:**

- Consumes: `requireUser`, `getUserOrgs` (`@/lib/auth/session`), `has_org_role` RPC via RLS client (pattern from `src/lib/org/admin-actions.ts:231`), adapter `validateKey` + `keyFormat` (registry), `maskKey` (`@/lib/ai/credentials`), `org_ai_secret_set/clear` RPCs (service client), `getAiEntitlement` (7), `readOrgAiSettings` via RLS client (5), `revalidatePath`.
- Produces (all `ActionResult<T>`, local `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }` per repo convention):
  - `getOrgAiSettings(): Promise<ActionResult<{ mode; tier; creditsLimit; creditsUsed; byoProvider; byoKeyLast4 }>>` — member-readable (RLS read + entitlement math).
  - `setAiMode(input: { mode: AiMode })` — admin only; `org_byo` requires a stored key; upserts the row via service client after the `has_org_role` check.
  - `setOrgByoKey(input: { provider: AiProvider; key: string })` — admin only; shape check → live `validateKey` ping → `org_ai_secret_set` with `maskKey` hint.
  - `removeOrgByoKey()` — admin only; `org_ai_secret_clear` (SQL already falls back `org_byo → per_user`).

The active org is `(await getUserOrgs())[0]` — the repo-wide convention.

- [ ] **Step 1: Write the failing test** — `src/lib/ai/settings-actions.test.ts` (mock setup mirrors `credentials-actions.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const svcRpc = vi.fn();
const svcMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
const svcUpsert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: svcRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: svcMaybeSingle }) }),
      upsert: svcUpsert,
    }),
  }),
}));

const rlsRpc = vi.fn();
const rlsMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rlsRpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: rlsMaybeSingle }) }),
    }),
  })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
  getUserOrgs: vi.fn(async () => [
    { id: "org-1", name: "Org", timezone: "UTC" },
  ]),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const validateKey = vi.fn();
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: () => ({
    id: "anthropic",
    label: "Anthropic",
    keyFormat: {
      safeParse: (v: string) => ({ success: v.startsWith("sk-ant-") }),
    },
    validateKey: (...a: unknown[]) => validateKey(...a),
  }),
}));

const admin = (allowed: boolean) =>
  rlsRpc.mockResolvedValue({ data: allowed, error: null });

beforeEach(() => vi.clearAllMocks());

describe("org ai settings actions", () => {
  it("setOrgByoKey rejects non-admins", async () => {
    admin(false);
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "anthropic",
      key: "sk-ant-valid-key",
    });
    expect(res).toEqual({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("setOrgByoKey validates then stores via org_ai_secret_set", async () => {
    admin(true);
    validateKey.mockResolvedValue(undefined);
    svcRpc.mockResolvedValue({ data: null, error: null });
    const { setOrgByoKey } = await import("@/lib/ai/settings-actions");
    const res = await setOrgByoKey({
      provider: "anthropic",
      key: "sk-ant-valid-key",
    });
    expect(validateKey).toHaveBeenCalledWith("sk-ant-valid-key");
    expect(svcRpc).toHaveBeenCalledWith(
      "org_ai_secret_set",
      expect.objectContaining({
        p_org: "org-1",
        p_provider: "anthropic",
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("setAiMode to org_byo without a stored key fails", async () => {
    admin(true);
    svcMaybeSingle.mockResolvedValueOnce({
      data: {
        ai_mode: "per_user",
        tier: "none",
        monthly_credit_limit: 0,
        byo_provider: null,
        byo_key_last4: null,
      },
      error: null,
    });
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "org_byo" });
    expect(res).toEqual({
      ok: false,
      error: "Add an organization key before switching to it.",
    });
  });

  it("setAiMode upserts for admins", async () => {
    admin(true);
    svcMaybeSingle.mockResolvedValueOnce({
      data: {
        ai_mode: "per_user",
        tier: "none",
        monthly_credit_limit: 0,
        byo_provider: null,
        byo_key_last4: null,
      },
      error: null,
    });
    const { setAiMode } = await import("@/lib/ai/settings-actions");
    const res = await setAiMode({ mode: "off" });
    expect(svcUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org-1",
        ai_mode: "off",
        updated_by: "user-1",
      }),
      { onConflict: "org_id" },
    );
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — `src/lib/ai/settings-actions.ts` (`"use server"`). Shape:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getUserOrgs, requireUser } from "@/lib/auth/session";
import { getAdapter } from "@/lib/ai/providers/registry";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import { maskKey } from "@/lib/ai/credentials";
import { readOrgAiSettings, type AiMode } from "@/lib/ai/org-settings";
import { getAiEntitlement } from "@/lib/ai/entitlement";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

const NOT_ADMIN = "Only organization admins can change AI settings.";

async function requireOrgAdmin(): Promise<{
  userId: string;
  orgId: string;
} | null> {
  const user = await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) return null;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("has_org_role", {
    p_org_id: org.id,
    p_roles: ["owner", "admin"],
  });
  return allowed ? { userId: user.id, orgId: org.id } : null;
}

export async function getOrgAiSettings(): Promise<
  ActionResult<{
    mode: AiMode;
    tier: string;
    creditsLimit: number;
    creditsUsed: number;
    byoProvider: AiProvider | null;
    byoKeyLast4: string | null;
  }>
> {
  await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) return fail("No organization.");
  const supabase = await createClient();
  const settings = await readOrgAiSettings(supabase, org.id); // RLS member read
  const entitlement = await getAiEntitlement(org.id);
  return {
    ok: true,
    data: {
      mode: settings.mode,
      tier: settings.tier,
      creditsLimit: settings.monthlyCreditLimit,
      creditsUsed: entitlement.creditsUsed,
      byoProvider: settings.byoProvider,
      byoKeyLast4: settings.byoKeyLast4,
    },
  };
}

const modeSchema = z.object({
  mode: z.enum(["off", "managed", "org_byo", "per_user"]),
});

export async function setAiMode(input: {
  mode: AiMode;
}): Promise<ActionResult<{ mode: AiMode }>> {
  const parsed = modeSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid AI mode.");
  const admin = await requireOrgAdmin();
  if (!admin) return fail(NOT_ADMIN);
  const svc = createServiceClient();
  if (parsed.data.mode === "org_byo") {
    const settings = await readOrgAiSettings(svc, admin.orgId);
    if (!settings.byoKeyLast4)
      return fail("Add an organization key before switching to it.");
  }
  const { error } = await svc
    .from("org_ai_settings")
    .upsert(
      {
        org_id: admin.orgId,
        ai_mode: parsed.data.mode,
        updated_by: admin.userId,
      },
      { onConflict: "org_id" },
    );
  if (error) return fail("Couldn't update the AI mode. Please try again.");
  revalidatePath("/settings");
  return { ok: true, data: { mode: parsed.data.mode } };
}

const keySchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  key: z.string().trim().min(10).max(300),
});

export async function setOrgByoKey(input: {
  provider: AiProvider;
  key: string;
}): Promise<ActionResult<{ provider: AiProvider; hint: string }>> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid API key.");
  const admin = await requireOrgAdmin();
  if (!admin) return fail(NOT_ADMIN);
  const { provider, key } = parsed.data;
  const adapter = getAdapter(provider);
  if (!adapter.keyFormat.safeParse(key).success) {
    return fail(`That doesn't look like a ${adapter.label} key.`);
  }
  try {
    await adapter.validateKey(key);
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(`That key was rejected by ${adapter.label}.`);
    return fail("Couldn't verify the key. Please try again.");
  }
  const hint = maskKey(key);
  const svc = createServiceClient();
  const { error } = await svc.rpc("org_ai_secret_set", {
    p_org: admin.orgId,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");
  revalidatePath("/settings");
  return { ok: true, data: { provider, hint } };
}

export async function removeOrgByoKey(): Promise<
  ActionResult<Record<never, never>>
> {
  const admin = await requireOrgAdmin();
  if (!admin) return fail(NOT_ADMIN);
  const svc = createServiceClient();
  const { error } = await svc.rpc("org_ai_secret_clear", {
    p_org: admin.orgId,
  });
  if (error) return fail("Couldn't remove the key. Please try again.");
  revalidatePath("/settings");
  return { ok: true, data: {} };
}
```

- [ ] **Step 4: Run** — `pnpm vitest run src/lib/ai/settings-actions.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/ai/settings-actions.ts src/lib/ai/settings-actions.test.ts && git commit -m "feat(ai): org ai settings server actions (mode, org key, member read)"`

---

### Task 9: Platform-admin plan control

**Files:**

- Modify: `src/lib/platform/actions.ts` (add `setOrgAiPlan`)
- Create: `src/components/admin/OrgAiPlanForm.tsx`
- Modify: `src/app/admin/organizations/[id]/page.tsx` (read settings via service client, mount form)
- Test: extend `src/lib/platform/actions.test.ts` (or create if the platform actions have no test file — follow the existing pattern in that folder)

**Interfaces:**

- Consumes: `requirePlatformAdmin` / `isPlatformAdmin` (`@/lib/platform/guard.ts` — follow whichever the existing platform actions use), `createServiceClient`, `org_ai_settings` upsert.
- Produces: `setOrgAiPlan(input: { orgId: string; tier: string; monthlyCreditLimit: number }): Promise<ActionResult<...>>` — the pre-Stripe entitlement lever. Zod: `orgId` uuid, `tier` `z.enum(["none","starter","pro","enterprise"])`, `monthlyCreditLimit` `z.number().int().min(0).max(1_000_000)`.

- [ ] **Step 1: Failing test** — assert: non-platform-admin → `{ ok: false }` and no upsert; platform admin → upsert `{ org_id, tier, monthly_credit_limit }` with `onConflict: "org_id"`. Mock `@/lib/platform/guard` and the service client exactly as in Task 8.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** `setOrgAiPlan` in `src/lib/platform/actions.ts` following that file's existing `ActionResult`/guard conventions (read the file first; keep its error-message style). Note `setOrgAiPlan` does **not** change `ai_mode` — an operator grants the allowance; the org admin still chooses managed mode in Settings.
- [ ] **Step 4: Implement the form** — `src/components/admin/OrgAiPlanForm.tsx` (`"use client"`): props `{ orgId: string; initial: { tier: string; monthlyCreditLimit: number; mode: string } }`; a tier `<select>` + numeric credit-limit input + Save via `useTransition` calling `setOrgAiPlan`; inline error/success text (`role="alert"`), no toast — copy the interaction conventions from `AiProviderForm.tsx`. Load the `pulse-ui` skill before styling.
- [ ] **Step 5: Mount in the admin org page** — in `src/app/admin/organizations/[id]/page.tsx` (already guarded by `requirePlatformAdmin` in the layout + page), read the row with the **service** client (a platform admin may not be an org member, so RLS reads would return null):

```ts
const svc = createServiceClient();
const aiSettings = await readOrgAiSettings(svc, orgId);
```

Render `<OrgAiPlanForm orgId={orgId} initial={{ tier: aiSettings.tier, monthlyCreditLimit: aiSettings.monthlyCreditLimit, mode: aiSettings.mode }} />` in a card beside the members table.

- [ ] **Step 6: Run** — `pnpm vitest run src/lib/platform` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** — `git add src/lib/platform/actions.ts src/lib/platform/*.test.ts src/components/admin/OrgAiPlanForm.tsx "src/app/admin/organizations/[id]/page.tsx" && git commit -m "feat(admin): platform-set org ai plan (tier + monthly credits)"`

---

### Task 10: Ask Pulse read tools

**Files:**

- Create: `src/lib/ai/ask/tools.ts`
- Test: `src/lib/ai/ask/tools.test.ts`

**Interfaces:**

- Consumes: `listMyBoards`, `listSharedBoards`, `getBoardPayload` (`@/lib/boards/queries` — all RLS-scoped via the cookie-bound client, so **RLS is the boundary by construction**), `buildBoardSnapshot` (`@/lib/ai/board-snapshot`).
- Produces:

```ts
export const ASK_TOOLS: Anthropic.Tool[]; // list_boards, get_board_overview, query_items
export const QUERY_ITEMS_MAX = 50;
export async function executeAskTool(
  name: string,
  input: unknown,
  ctx: { workspaceId: string },
): Promise<{ content: string; boardId?: string }>; // content = JSON string for the tool_result
```

Tool behavior:

- `list_boards` (no input): my boards + shared boards filtered to `ctx.workspaceId`; returns `[{ id, name }]`.
- `get_board_overview` (`{ board_id: uuid }`): `getBoardPayload` → `buildBoardSnapshot` (schema + aggregate stats, **no raw rows**); board not visible → `{ error: "board not found" }` content (RLS returns null — never throws cross-org data).
- `query_items` (`{ board_id: uuid, limit?: number ≤ 50 }`): from the payload, first `min(limit, 50)` non-archived items as `{ name, group, values: { [columnName]: cellValue } }`. This is the one place raw cell values are read — bounded and only for boards the asking user can see.
- Zod-validate every tool input; a validation failure returns `{ content: '{"error":"invalid tool input"}' }` rather than throwing (the model should get a chance to correct itself).

- [ ] **Step 1: Failing tests** — `src/lib/ai/ask/tools.test.ts`: mock `@/lib/boards/queries` + `@/lib/ai/board-snapshot`; assert (a) `list_boards` merges my+shared and filters by `workspace_id`; (b) `get_board_overview` returns the snapshot JSON and `boardId`; (c) `query_items` caps at 50 even when `limit: 500` is requested and maps values by column name; (d) unknown tool name and invalid input return error content, not a throw.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** `ASK_TOOLS` as plain `Anthropic.Tool[]` with `input_schema` objects (`additionalProperties: false`, `required` arrays); `executeAskTool` switches on name, Zod-parses input, executes via the queries above, `JSON.stringify`s the result. Keep each tool's returned JSON compact (ids, names, values only — no timestamps/positions) to control tokens.
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: Commit** — `git add src/lib/ai/ask/tools.ts src/lib/ai/ask/tools.test.ts && git commit -m "feat(ai): rls-scoped read tools for ask pulse"`

---

### Task 11: Migrate dashboard-gen onto the gateway

**Files:**

- Modify: `src/lib/ai/actions.ts` (`generateDashboardProposal`), `src/lib/ai/generate.ts` (require resolved adapter — drop the internal `resolveUserAdapter` fallback)
- Test: `src/lib/ai/actions.test.ts`, `src/lib/ai/generate.test.ts` (update)

**Interfaces:**

- Consumes: `resolveAiAdapter`/`runAi` (6), `requireAiEntitlement` (7), `getUserOrgs`, errors (3).
- Produces: `generateDashboardProposal` unchanged signature/`ActionResult` shape — but now entitlement-gated, org-mode-aware, and metered. `generateProposal(snap, { adapter, apiKey, feedback })` — `adapter`/`apiKey` **required** (the gateway is the only resolver; `credentials.ts` keeps `resolveUserAdapter` for the gateway's `per_user` arm).

- [ ] **Step 1: Failing tests** — update `src/lib/ai/actions.test.ts`: mock `@/lib/ai/gateway` (`runAi` invoking its `fn` with a fake resolved adapter, and recording calls), `@/lib/ai/entitlement`, and `@/lib/auth/session.getUserOrgs`. Assert:
  - `requireAiEntitlement` is called with `(orgId, "dashboard_gen")` **before** `generateProposal`.
  - The proposal flows through `runAi` (its `fn` returns `{ result, usage, model }` with the adapter's `defaultModel`).
  - `AiDisabledError` → `fail("AI is turned off for your organization.")`; `AiQuotaExceededError` → `fail("You've used this month's AI allowance.")`; `AiNotConfiguredError` keeps its existing message; `ByoKeyMissingError` → `fail("Your organization's AI key is missing — ask an admin to update Settings.")`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** In `generateDashboardProposal` (after the existing snapshot guards):

```ts
const orgs = await getUserOrgs();
const org = orgs[0];
if (!org) return fail("No organization.");
await requireAiEntitlement(org.id, "dashboard_gen");
const user = await requireUser();
const proposal = await runAi(
  { orgId: org.id, userId: user.id, feature: "dashboard_gen" },
  async ({ adapter, apiKey }) => {
    const { proposal, usage } = await generateProposal(snap, {
      adapter,
      apiKey,
      feedback,
    });
    return { result: proposal, usage, model: adapter.defaultModel };
  },
);
```

Extend the catch block to map the new typed errors by `e.name` (or `instanceof`) to the messages above. In `generate.ts`, make `adapter`/`apiKey` required params and delete the `resolveUserAdapter` import.

- [ ] **Step 4: Run the full AI suite** — `pnpm vitest run src/lib/ai`. Expected: PASS (behavior for `per_user` orgs is unchanged — the gateway resolves the same user key dashboard-gen used before).
- [ ] **Step 5: Commit** — `git add src/lib/ai/actions.ts src/lib/ai/actions.test.ts src/lib/ai/generate.ts src/lib/ai/generate.test.ts && git commit -m "refactor(ai): dashboard generation goes through the metered gateway"`

---

### Task 12: Ask Pulse loop + server action

**Files:**

- Create: `src/lib/ai/ask/ask.ts`, `src/lib/ai/ask/actions.ts`
- Test: `src/lib/ai/ask/ask.test.ts`, `src/lib/ai/ask/actions.test.ts`

**Interfaces:**

- Consumes: `ASK_TOOLS`/`executeAskTool` (10), `MODEL` (`@/lib/ai/anthropic`), `runAi`/`resolveAiAdapter` (6), `requireAiEntitlement` (7), `ProviderNotCapableError` (3), `listWorkspacesCached` + `getActiveWorkspaceId` (`@/lib/workspaces/*` — the active workspace is resolved **server-side from the cookie**, never trusted from the client), `getUserOrgs`/`requireUser`.
- Produces:
  - `askPulseLoop(args: { apiKey; workspaceId; question; client? }): Promise<{ answer: string; boardsConsulted: string[]; usage: AiUsageTokens }>` — client injectable for tests.
  - `askPulse(input: { question: string }): Promise<ActionResult<{ answer: string; boardsConsulted: string[] }>>`.

Loop rules (per E1 spec §4 + the claude-api tool-use shape): manual loop on `client.messages.create({ model: MODEL, max_tokens: 4096, system, tools: ASK_TOOLS, messages })`; while `stop_reason === "tool_use"`, execute **all** tool_use blocks (collect `boardsConsulted` from `executeAskTool` results), append the assistant content + ONE user message of `tool_result` blocks, continue; cap **6 rounds** (on cap, append a final user nudge "Answer now with what you have." and take the next text response); sum `usage.input_tokens`/`output_tokens` across every round. System prompt: answer only from tool results; name the boards consulted; say when you don't know; never fabricate values.

- [ ] **Step 1: Failing tests.**
  - `ask.test.ts`: inject a fake Anthropic client whose `messages.create` is scripted: round 1 returns `stop_reason: "tool_use"` with a `tool_use` block for `list_boards` (+ `usage {input_tokens: 100, output_tokens: 20}`); round 2 returns `end_turn` with a text block (+ usage). Mock `executeAskTool`. Assert: the round-2 request's last message contains a `tool_result` with the round-1 `tool_use.id`; the answer is the final text; usage is summed (`{inputTokens: 100+…, outputTokens: 20+…}`); a client scripted to return `tool_use` forever stops after 6 rounds.
  - `actions.test.ts`: mock gateway/entitlement/workspaces/session. Assert: `requireAiEntitlement(orgId, "ask_pulse")` runs first; a resolved adapter with `supportsTools: false` → `fail("Ask Pulse needs an Anthropic key — dashboards work with any provider.")` **without** calling the loop; question > 1000 chars → fail; happy path returns `{ answer, boardsConsulted }` through `runAi`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement `ask.ts`** (shape — the SDK surface is confirmed against the claude-api skill's TypeScript tool-use docs):

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/anthropic";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import type { AiUsageTokens } from "@/lib/ai/pricing";

const MAX_ROUNDS = 6;

const SYSTEM = [
  "You answer questions about the user's work boards.",
  "Answer ONLY from tool results — never invent boards, items, or values.",
  "Start broad (list_boards, get_board_overview) and use query_items only for the specific rows a question needs.",
  "In your answer, name the boards you consulted. If the tools can't answer the question, say so plainly.",
].join("\n");

export async function askPulseLoop(args: {
  apiKey: string;
  workspaceId: string;
  question: string;
  client?: Anthropic; // DI for tests
}): Promise<{
  answer: string;
  boardsConsulted: string[];
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: args.question },
  ];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const boardsConsulted = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: ASK_TOOLS,
      messages,
    });
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { answer, boardsConsulted: [...boardsConsulted], usage };
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await executeAskTool(block.name, block.input, {
        workspaceId: args.workspaceId,
      });
      if (result.boardId) boardsConsulted.add(result.boardId);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Round cap reached — force a final answer from what's gathered.
  messages.push({ role: "user", content: "Answer now with what you have." });
  const last = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages,
  });
  usage.inputTokens += last.usage.input_tokens;
  usage.outputTokens += last.usage.output_tokens;
  const answer = last.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { answer, boardsConsulted: [...boardsConsulted], usage };
}
```

**Implement `actions.ts`** (`"use server"`): Zod `{ question: z.string().trim().min(3).max(1000) }` (cost guard); resolve org (`getUserOrgs()[0]`) + user; `requireAiEntitlement(org.id, "ask_pulse")`; resolve active workspace server-side (`listWorkspacesCached(org.id)` → `getActiveWorkspaceId(workspaces)`); `runAi({...feature: "ask_pulse"}, async ({ adapter, apiKey }) => { if (!adapter.supportsTools) throw new ProviderNotCapableError("ask_pulse"); const r = await askPulseLoop({ apiKey, workspaceId, question }); return { result: r, usage: r.usage, model: MODEL }; })`. Catch block maps: `ProviderNotCapableError` → `"Ask Pulse needs an Anthropic key — dashboards work with any provider."`, `AiDisabledError` → `"AI is turned off for your organization."`, `AiQuotaExceededError` → `"You've used this month's AI allowance."`, `AiNotConfiguredError` → `"Add an AI provider key in Settings to use Ask Pulse."`, anything else → `"Ask Pulse hit a snag. Please try again."`.

- [ ] **Step 4: Run** — `pnpm vitest run src/lib/ai/ask`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/lib/ai/ask/ && git commit -m "feat(ai): ask pulse tool-use loop and entitlement-gated action"`

---

### Task 13: RLS integration tests

**Files:**

- Create: `src/lib/ai/org-ai-settings.rls.integration.test.ts`

**Interfaces:**

- Consumes: the Task-1 schema on DEV; test helpers `loadIntegrationEnv`/`integrationTargetReady` (`@/test/integration-env`), `signInWithRetry` (`@/test/integration-auth`). Copy the provisioning skeleton from `src/lib/ai/user-ai-credentials.rls.integration.test.ts` verbatim (admin client, `provisionUser`, cleanup), extended with two orgs: use the same org-provisioning approach the repo's other org-scoped RLS suites use (grep `create_organization` usage in existing `*.rls.integration.test.ts` and mirror it).
- Produces: proof the boundary holds. Suite is `describe.skipIf(!integrationTargetReady())` — never runs without `PULSE_TEST_DB`/service key, per the repo's test-DB policy.

- [ ] **Step 1: Write the tests** (they can be written and run in one pass — the implementation is Task 1's schema):
  - member of org A **can** select org A's `org_ai_settings` row; **cannot** see org B's (empty result, not error).
  - non-admin member **cannot** insert/update `org_ai_settings` (error or 0 rows).
  - `ai_usage`: insert as `authenticated` is rejected; admin of org A sees only org A rows (seed rows via the service client's `record_ai_usage`).
  - `org_ai_secret_get` / `org_ai_secret_set` / `record_ai_usage` / `ai_credits_used_this_month` are **not callable** as `authenticated` (`userA.anon.rpc(...)` → permission error).
  - `ai_credits_used_this_month` (service) sums only current-month rows for the given org.
- [ ] **Step 2: Run against DEV** — Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/ai/org-ai-settings.rls.integration.test.ts` (match the env-var convention in `src/test/integration-env.ts`). Expected: PASS. Also run the plain suite (`pnpm vitest run src/lib/ai/org-ai-settings.rls.integration.test.ts`) and confirm it SKIPS.
- [ ] **Step 3: Commit** — `git add src/lib/ai/org-ai-settings.rls.integration.test.ts && git commit -m "test(ai): rls boundary for org ai settings, ledger and vault fns"`

---

### Task 14: Settings UI — org AI card + per-user card gating

**Files:**

- Create: `src/components/settings/OrgAiSettingsForm.tsx`
- Modify: `src/app/(app)/settings/page.tsx` (fetch org AI settings; render the org card for admins; gate the personal card by mode)
- Test: `src/components/settings/OrgAiSettingsForm.test.tsx`

**Interfaces:**

- Consumes: `getOrgAiSettings`/`setAiMode`/`setOrgByoKey`/`removeOrgByoKey` (8), `ALL_PROVIDERS`/`PROVIDER_CATALOG` (catalog), existing `AiProviderForm` + settings page structure (`Card`/`CardHeader`/`CardContent`, masonry columns, `isAdmin` computed at page lines ~52-53).
- Produces: `OrgAiSettingsForm({ initial })` client component where `initial` is the `getOrgAiSettings` data shape (fetched in the page RSC and passed down, matching how `AiProviderForm` gets `initial`).

**Load the `pulse-ui` and `frontend-design` skills before building.** Follow the existing card conventions: `useTransition`, inline `role="alert"` messages, masked key input, no toasts.

- [ ] **Step 1: Failing component test** — `OrgAiSettingsForm.test.tsx` (Testing Library, actions mocked): renders the four modes as a radio/segmented group with the current mode selected; managed shows the credit meter text `"{used} / {limit} credits this month"`; selecting a mode calls `setAiMode`; the org-key panel shows `byoKeyLast4` when present and calls `setOrgByoKey` on save / `removeOrgByoKey` on remove; switching to "Organization key" with no stored key shows the inline error from the action.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement the form.** Mode selector labels: **Off** ("No AI features"), **Managed** ("Included in your plan — uses the workspace allowance"), **Organization key** ("One shared key for everyone"), **Members' own keys** ("Each member adds a personal key" — the default). Show the meter only for managed. Reuse the masked-input + validate-save-remove interaction from `AiProviderForm`.
- [ ] **Step 4: Wire the page.** In `src/app/(app)/settings/page.tsx`: add `getOrgAiSettings()` to the page's data fetching (after org resolution); render:

```tsx
{
  isAdmin && orgAi.ok ? (
    <Card>
      <CardHeader>
        <CardTitle>AI — Organization</CardTitle>
        <CardDescription>
          How AI features are powered for everyone in this org.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OrgAiSettingsForm initial={orgAi.data} />
      </CardContent>
    </Card>
  ) : null;
}
```

Gate the existing personal card: when the mode is **not** `per_user`, replace `<AiProviderForm/>`'s card content with a one-line note (e.g. "AI is managed by your organization — no personal key needed."); when `per_user`, render it exactly as today.

- [ ] **Step 5: Run** — `pnpm vitest run src/components/settings && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add src/components/settings/OrgAiSettingsForm.tsx src/components/settings/OrgAiSettingsForm.test.tsx "src/app/(app)/settings/page.tsx" && git commit -m "feat(settings): org ai mode card with credit meter and org key panel"`

---

### Task 15: Ask Pulse UI — store flag, panel, ⌘K entry, header trigger

**Files:**

- Modify: `src/stores/ui.ts` (+ `src/stores/ui.test.ts`) — add `askPulseOpen: boolean` / `setAskPulseOpen(open)` following the exact `newBoardOpen`/`setNewBoardOpen` pattern.
- Create: `src/components/ai/ask/AskPulse.tsx` (the panel), `src/components/ai/ask/AskPulseHost.tsx` (lazy mount driven by the store)
- Modify: `src/components/command-palette.tsx` (add the entry), `src/components/app-shell.tsx` (header button + host mount)
- Test: `src/components/ai/ask/AskPulse.test.tsx`

**Interfaces:**

- Consumes: `askPulse` action (12), `useUIStore`, `CommandItem`/`run()` pattern (`command-palette.tsx` ~lines 178-192), lazy-mount pattern (`DashboardsNav.tsx:28-35` — `next/dynamic`, `ssr: false`, mounted only when open), `CommandTrigger` as the header-button model.
- Produces: Ask Pulse reachable from ⌘K ("Ask Pulse…") and a header button; **0 RSC navigations**; the chunk (and the action import) loads only on first open. The panel needs no props — the action resolves org/workspace server-side.

**Load the `pulse-ui` and `frontend-design` skills before building.**

- [ ] **Step 1: Failing tests.** `ui.test.ts`: `setAskPulseOpen` toggles `askPulseOpen` (copy the `newBoardOpen` test). `AskPulse.test.tsx` (action mocked): renders a textarea + Ask button; submitting shows the thinking state then the answer and a "Boards consulted" list; an `{ ok: false, error }` result renders the error inline (`role="alert"`); empty question keeps the button disabled.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
  - `ui.ts`: add the flag + setter.
  - `AskPulse.tsx` (`"use client"`): a `Dialog` (shadcn) with a textarea, submit via `useTransition` → `askPulse({ question })`; states: idle / thinking ("Looking across your boards…") / answer (rendered as plain text paragraphs + boards-consulted line) / error. Each ask is stateless (v1 — no conversation history).
  - `AskPulseHost.tsx` (`"use client"`): reads `askPulseOpen` from the store, `const AskPulse = dynamic(() => import("./AskPulse").then(m => m.AskPulse), { ssr: false })`, renders `{askPulseOpen ? <AskPulse open onOpenChange={setAskPulseOpen} /> : null}`.
  - `command-palette.tsx`: in the existing actions group add `<CommandItem onSelect={() => run(() => setAskPulseOpen(true))}><Sparkles className="size-4" /> Ask Pulse…</CommandItem>` (import `Sparkles` from `lucide-react`; take `setAskPulseOpen` from `useUIStore`).
  - `app-shell.tsx`: next to `<CommandTrigger />` add a small `AskPulseTrigger` client button (same visual family as `CommandTrigger`) that flips the store flag, and render `<AskPulseHost />` beside `{commandPalette}` at the shell root.
- [ ] **Step 4: Run** — `pnpm vitest run src/stores src/components/ai && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/stores/ui.ts src/stores/ui.test.ts src/components/ai/ask/ src/components/command-palette.tsx src/components/app-shell.tsx && git commit -m "feat(ai): ask pulse panel, command-palette entry and header trigger"`

---

### Task 16: Gates, finish, manual test guide

- [ ] **Step 1: Full gates in the worktree** — Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all PASS. (If `pnpm test` includes the integration suite, it must SKIP without the test-DB env — verify the skip line appears.)
- [ ] **Step 2: Env check** — confirm `ANTHROPIC_API_KEY` is set in Vercel Production + Preview (it is now the **managed** key). If not, note it in the closing message — managed mode fails closed with a clean error until it's set, and the default `per_user` mode is unaffected.
- [ ] **Step 3: Finish** — Run: `scripts/finish-task.sh` from inside the worktree (rebases onto latest `develop`, re-runs gates, merges, pushes, removes the worktree + branch). Resolve any rebase conflict per its instructions and re-run.
- [ ] **Step 4: Deliver the "How to test this" walkthrough** (in the closing message AND the `/wrapup` session note):
  1. Pull `develop`, run the app, sign in as an **org owner/admin**.
  2. **Settings → AI — Organization** (new card): confirm the mode selector shows "Members' own keys" selected by default, and your existing personal AI key card still renders below it. Dashboard AI generation must work exactly as before (per-user key) — regression check.
  3. Switch mode to **Off** → open a board → Generate dashboard with AI → expect the clean "AI is turned off for your organization." error (no 500). Ask Pulse entry shows its disabled state. Switch back to "Members' own keys".
  4. **Org key path:** paste an Anthropic key in the org-key panel → Validate & save (last4 appears) → switch mode to "Organization key" → dashboard-gen and Ask Pulse now work for a member with **no personal key**.
  5. **Ask Pulse:** press ⌘K → "Ask Pulse…" (or the header button) → ask "what's overdue and unassigned across my boards?" → expect a thinking state, then an answer naming the boards it consulted. Ask something unanswerable → expect an honest "I don't know" style reply, not fabrication.
  6. **Metering:** as admin, in `/admin/organizations/<id>` set tier + a small credit limit (e.g. 1) → switch org mode to **Managed** (requires `ANTHROPIC_API_KEY` on the server) → run one generation → run another → expect "You've used this month's AI allowance." The Settings card's meter shows the spend.
  7. **Provider gate:** store an OpenAI/Google key (org or personal) → dashboard-gen works, Ask Pulse shows "Ask Pulse needs an Anthropic key — dashboards work with any provider."

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** unchanged on every route. The Settings org card is one extra RSC read on `/settings` only; `AskPulseHost` renders `null` until opened; the panel + Anthropic SDK import are in a lazy chunk.
- **Interactions:** opening/closing Ask Pulse and switching Settings tabs are client state — 0 RSC navigations. Server round-trips happen only on explicit actions (`askPulse`, `setAiMode`, `setOrgByoKey`, `setOrgAiPlan`, generate).
- **Bounded/indexed:** Ask Pulse tools read via `getBoardPayload` (existing bounded reads, `board_id`-indexed) and cap `query_items` at 50 rows; `ai_usage` reads roll up via the indexed `(org_id, created_at desc)` path inside a definer function; loop capped at 6 tool rounds; question capped at 1000 chars.
