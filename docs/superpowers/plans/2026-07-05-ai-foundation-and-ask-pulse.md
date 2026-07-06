# AI Platform Foundation + Ask Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md`. Parent scope: `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`.

**Goal:** Build the reusable AI platform layer (one gateway resolving **managed** vs **bring-your-own-key**, a usage ledger with credits, and org entitlements) and ship **Ask Pulse** — a workspace-wide, read-only natural-language Q&A surface — on top of it, migrating the existing dashboard-gen feature onto the gateway to prove it end-to-end.

**Architecture:** A new migration adds `org_ai_settings` + `ai_usage` + `SECURITY DEFINER` Vault functions. A **gateway** (`resolveAiClient(orgId)` + `runAi(orgId, feature, fn)`) is the single chokepoint every AI call routes through — it picks the managed global key or the org's Vault-stored BYO key and meters every call into the ledger. An **entitlement** guard fails AI actions closed when AI is off or the managed monthly credit ceiling is hit. **Ask Pulse** runs an Anthropic tool-use loop whose read tools execute through the RLS-bound server client, so the model can only ever read what the asking user can. All UI is client-state + History API (0 RSC navigations), lazy-loaded.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (RLS + Vault + `SECURITY DEFINER` RPCs), Zod, `@anthropic-ai/sdk` (already installed), Vitest + jsdom, React (useTransition), pulse-ui (shadcn/Tailwind v4), lucide-react.

## Global Constraints

- **Next.js 16, not training-data Next** — confirm any framework API (async `searchParams`, Server Actions, `next/dynamic`) against `node_modules/next/dist/docs/` before use.
- **TS strict, no unjustified `any`** — the SDK boundary is the only place an `any`/cast is tolerable; justify inline (matches the `dashboard_series` precedent in `src/lib/dashboards/actions.ts`).
- **Zod at every boundary** — every Server Action `safeParse`s its input; return `ActionResult<T> = {ok:true;data:T}|{ok:false;error:string}`.
- **RLS is the security boundary** — feature reads use the cookie-bound `createClient()` from `@/lib/supabase/server`; only the gateway's privileged Vault/ledger writes use the service context via `SECURITY DEFINER` RPCs. `SUPABASE_SERVICE_ROLE_KEY` and BYO plaintext keys are **server-only**, never in a client component.
- **Migration is versioned + user-applied** — the agent writes SQL under `supabase/migrations/`; per the classifier gotcha the **user applies** it, then the agent runs `generate_typescript_types` → `src/types/database.types.ts` and `get_advisors`. Never dashboard click-ops.
- **Commit hygiene** — lowercase conventional-commit subjects (commitlint rejects sentence-case), a descriptive body + `Co-Authored-By` trailer, **stage by explicit path** (never `git add -A`), commit identity pinned by the worktree.
- **UI skills mandatory** — load `pulse-ui` + `frontend-design` before any component work. Monochrome chrome, single accent, no "AI glow".
- **SDK tool-use is post-cutoff** — before writing the Ask Pulse loop, **read the `claude-api` skill** (`Skill claude-api`) then its TypeScript tool-use docs for the exact `messages` tool-loop shape. Keep the Anthropic client **dependency-injected** so tests never hit the network.
- **Definition of done** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

---

## Key existing facts (verified — do not re-derive)

- **Existing AI module** `src/lib/ai/`: `anthropic.ts` (`getAnthropicClient()`, `export const MODEL = "claude-opus-4-8"`, `AiNotConfiguredError`, `import "server-only"`), `board-snapshot.ts` (`buildBoardSnapshot({board,columns,items,cellValues})` → schema + aggregate stats, **no raw cells**), `generate.ts` (`generateProposal(snap,{client,feedback})` via `client.messages.parse`), `actions.ts` (dashboard-gen actions).
- **Org/role guards:** DB `has_org_role(p_org_id uuid, p_roles org_role[])` and `is_org_member(p_org_id)` (SECURITY DEFINER, used by RLS). App: `isOrgAdmin()` / `isOrgAdminCached(userId,orgId)` in `src/lib/org/guard.ts`; `isPlatformAdmin()` referenced there for the admin console. `org_role` enum = `('owner','admin','member','guest')`.
- **Session/org context:** `requireUser()`, `getUser()`, `getUserOrgs()` in `src/lib/auth/session.ts`. App is effectively single-org (`orgs[0]`). Derive `org_id` from the resource/session — never trust the client.
- **Server client:** `createClient()` from `@/lib/supabase/server` (cookie-bound, RLS). A service client factory exists for privileged reads — reuse the existing one (grep `createServiceClient`/`service` in `src/lib/supabase/`); if only an inline pattern exists, follow it. `.rpc(name, args)` returns `{data,error}`.
- **Board reads:** `getBoardPayload(boardId)` in `src/lib/boards/queries.ts` → `{board,columns,items,cellValues,...}` RLS-scoped (null if not visible); `listMyBoards()` → `{id,name,workspace_id,position,shared_out}[]`.
- **Cell value JSON shapes** (`cell_values.value`): text `{text}`, status `{optionId}`, dropdown `{optionIds[]}`, people `{userIds[]}`, date `{date:"YYYY-MM-DD"}`, numbers `{n}`, checkbox `{checked}`. Missing `(item_id,column_id)` = empty.
- **Settings page:** `src/app/(app)/settings/page.tsx` reads `getUserOrgs()`; org mutations via `src/lib/org/admin-actions.ts`; forms in `src/components/settings/`. **Admin console:** `src/app/admin/organizations/[id]/page.tsx` (gated by `isPlatformAdmin`).
- **Command palette:** `src/components/command-palette.tsx` (cmdk, `Cmd/Ctrl+K`), open-state in `src/stores/ui.ts` (`useUIStore`, `commandOpen`). Item search `src/lib/search/item-search.ts` (`ilike` only).
- **Supabase Vault** is available on the project (`vault.create_secret(secret text, name text) → uuid`, `vault.decrypted_secrets` view). Extensions already installed: `pg_cron`, `pg_net`, `pg_trgm`.
- **Integration test pattern:** `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` + `config({path:".env.local"})` + `@supabase/supabase-js` admin/anon clients + `signInWithRetry` from `@/test/integration-auth`. See `src/lib/dashboards/dashboards.rls.integration.test.ts`.
- **Structured-output gotcha:** permissive `config:{}` schemas make Opus emit `{}` — keep JSON schemas specific and re-validate with Zod (see gotcha-45).

---

## File structure

**Create — Foundation:**

- `supabase/migrations/<ts>_ai_platform_foundation.sql` — enum, tables, RLS, Vault + ledger definer functions
- `src/lib/ai/pricing.ts` + `.test.ts` — per-model price table, `computeCost`, `costToCredits`
- `src/lib/ai/usage.ts` + `.test.ts` — `recordUsage`, `creditsUsedThisMonth` (RPC wrappers, injectable client)
- `src/lib/ai/entitlement.ts` + `.test.ts` — `getAiEntitlement`, `requireAiEntitlement`, typed errors
- `src/lib/ai/gateway.ts` + `.test.ts` — `resolveAiClient`, `runAi`
- `src/lib/ai/settings-actions.ts` + `.test.ts` — org AI settings + BYO key + admin plan actions
- `src/lib/ai/ai-platform.rls.integration.test.ts` — RLS/Vault boundary coverage
- `src/components/settings/ai/AiSettingsForm.tsx` + `.test.tsx` — mode + BYO key + credit meter
- `src/components/admin/AiPlanControl.tsx` + `.test.tsx` — platform-admin tier/limit control

**Create — Ask Pulse:**

- `src/lib/ai/ask/tools.ts` + `.test.ts` — read-tool definitions + executors (RLS-bound)
- `src/lib/ai/ask/ask.ts` + `.test.ts` — tool-use loop (injectable client)
- `src/lib/ai/ask/actions.ts` + `.test.ts` — `askPulse` action
- `src/components/ai/ask/AskPulse.tsx` + `.test.tsx` — panel UI
- `src/components/ai/ask/AskPulseLauncher.tsx` — lazy loader + ⌘K/header entry

**Modify:**

- `src/lib/ai/anthropic.ts` — add `AiDisabledError`, `ByoKeyMissingError`, `AiQuotaExceededError` typed errors (co-located with `AiNotConfiguredError`)
- `src/lib/ai/generate.ts` + `src/lib/ai/actions.ts` — route dashboard-gen through `runAi(orgId,'dashboard_gen',…)`
- `src/app/(app)/settings/page.tsx` — mount `AiSettingsForm`
- `src/app/admin/organizations/[id]/page.tsx` — mount `AiPlanControl`
- `src/components/command-palette.tsx` — add "Ask Pulse…" entry opening the launcher
- `src/types/database.types.ts` — regenerated after migration (not hand-edited)

---

## Execution DAG

- **Task 0 (migration)** — root; everything else needs the tables/RPCs + regenerated types. User-applied gate.
- **Foundation wave (after 0):**
  - **Batch A (parallel):** Task 1 (pricing), Task 2 (usage), Task 3 (entitlement), Task 8a (typed errors — tiny, fold into 1). Disjoint files. (Task 2 & 3 wrap RPCs; pure math is unit-tested with a mocked client.)
  - **Task 4 (gateway)** — needs 1, 2, and the typed errors.
  - **Task 5 (migrate dashboard-gen onto gateway)** — needs 4.
  - **Task 6 (settings actions)** — needs 2, 3 (+ Vault RPCs from 0).
  - **Batch B (parallel):** Task 7 (RLS integration), Task 9 (Settings UI — needs 6), Task 10 (Admin UI — needs 6). Disjoint files.
- **Ask Pulse wave (after Foundation; needs 3, 4):**
  - **Task 11 (tools)** → **Task 12 (loop)** → **Task 13 (action)** — sequential (each consumes the prior).
  - **Task 14 (Ask Pulse UI)** — needs 13.
- **Task 15 (final wiring + four gates)** — needs all.

**Critical path:** 0 → 4 → (6 → 9) and 0 → 4 → 11 → 12 → 13 → 14 → 15. Ask Pulse is the long internal chain.

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** of `/settings`, `/admin/...`, and every app page: unchanged — `AiSettingsForm`/`AskPulse` are lazy (`next/dynamic`, `ssr:false`); the ⌘K entry is a static row.
- **In-panel interactions** (mode switch, BYO validate, asking): client state + `useTransition`; **0 RSC navigations**.
- **Server round-trips only on explicit actions**: `getOrgAiSettings` (on panel open), `setByoKey` (one validate call), `askPulse` (one action, internal tool loop). None are view toggles.
- **Bounded/indexed**: `query_items` tool caps at 50 rows over `board_id`-indexed reads; overview uses aggregate snapshots; `ai_usage` rollup is indexed `(org_id, created_at desc)`.

---

## Task 0: Migration — settings, ledger, Vault + credit functions

**Files:**

- Create: `supabase/migrations/<ts>_ai_platform_foundation.sql`
- Modify (after apply): `src/types/database.types.ts` (regenerated)

**Interfaces:**

- Produces (DB): table `public.org_ai_settings`, table `public.ai_usage`, enum `public.ai_mode`, functions `public.ai_credits_used_this_month(uuid)→numeric`, `public.record_ai_usage(...)→void`, `public.get_byo_ai_secret(uuid)→text` (service-role only), `public.set_byo_ai_secret(uuid,text,text)→uuid` (admin-guarded), `public.remove_byo_ai_secret(uuid)→void`, `public.set_org_ai_plan(uuid,text,integer)→void` (platform-admin only).

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/<ts>_ai_platform_foundation.sql` (use a timestamp after the latest existing migration; check `supabase/migrations/` for the max). Key contents:

```sql
-- AI platform foundation: per-org AI mode/entitlement, usage ledger, and
-- Supabase-Vault-backed bring-your-own-key storage. BYO plaintext keys never
-- cross RLS to authenticated; decrypt is service-role only.

create type public.ai_mode as enum ('off', 'managed', 'byo');

create table public.org_ai_settings (
  org_id                uuid primary key references public.organizations(id) on delete cascade,
  ai_mode               public.ai_mode not null default 'off',
  tier                  text not null default 'none',
  monthly_credit_limit  integer not null default 0,          -- managed allowance; 0 = none
  byo_provider          text,                                 -- e.g. 'anthropic'
  byo_secret_id         uuid,                                 -- vault.secrets id (opaque handle)
  byo_key_last4         text,                                 -- display only
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id)
);

create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid references auth.users(id),
  feature       text not null,           -- 'dashboard_gen' | 'ask_pulse' | ...
  provider      text,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  credits       numeric(10,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index ai_usage_org_created_idx on public.ai_usage (org_id, created_at desc);

alter table public.org_ai_settings enable row level security;
alter table public.ai_usage         enable row level security;

-- org_ai_settings: members read (no plaintext lives here); admins write.
create policy org_ai_settings_read on public.org_ai_settings
  for select using (public.is_org_member(org_id));
create policy org_ai_settings_write on public.org_ai_settings
  for all using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- ai_usage: admins read own org; NO client insert path (definer writes only).
create policy ai_usage_read on public.ai_usage
  for select using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- credits used this calendar month
create or replace function public.ai_credits_used_this_month(p_org_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(credits), 0)::numeric
  from public.ai_usage
  where org_id = p_org_id
    and created_at >= date_trunc('month', now());
$$;

-- write one ledger row (called by the gateway in service context)
create or replace function public.record_ai_usage(
  p_org_id uuid, p_user_id uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_usage(org_id,user_id,feature,provider,model,input_tokens,output_tokens,cost_usd,credits)
  values (p_org_id,p_user_id,p_feature,p_provider,p_model,p_input_tokens,p_output_tokens,p_cost_usd,p_credits);
end;
$$;

-- BYO secret: admin sets, service reads. Store in Vault; keep only the id + last4 on the row.
create or replace function public.set_byo_ai_secret(p_org_id uuid, p_provider text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid;
begin
  if not public.has_org_role(p_org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_secret_id := vault.create_secret(p_key, 'byo_ai_' || p_org_id::text);
  insert into public.org_ai_settings(org_id, byo_provider, byo_secret_id, byo_key_last4, updated_by)
  values (p_org_id, p_provider, v_secret_id, right(p_key, 4), auth.uid())
  on conflict (org_id) do update
    set byo_provider = excluded.byo_provider,
        byo_secret_id = excluded.byo_secret_id,
        byo_key_last4 = excluded.byo_key_last4,
        updated_at = now(), updated_by = auth.uid();
  return v_secret_id;
end;
$$;

create or replace function public.remove_byo_ai_secret(p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.org_ai_settings
    set byo_provider = null, byo_secret_id = null, byo_key_last4 = null,
        updated_at = now(), updated_by = auth.uid()
  where org_id = p_org_id;
end;
$$;

-- Service-role only: return decrypted BYO key for the gateway.
create or replace function public.get_byo_ai_secret(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select ds.decrypted_secret
  from public.org_ai_settings s
  join vault.decrypted_secrets ds on ds.id = s.byo_secret_id
  where s.org_id = p_org_id;
$$;
revoke execute on function public.get_byo_ai_secret(uuid) from anon, authenticated;

-- Platform-admin sets an org's managed plan (stand-in for Stripe until Epic 6).
create or replace function public.set_org_ai_plan(p_org_id uuid, p_tier text, p_limit integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = auth.uid()) then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  insert into public.org_ai_settings(org_id, tier, monthly_credit_limit, updated_by)
  values (p_org_id, p_tier, p_limit, auth.uid())
  on conflict (org_id) do update
    set tier = excluded.tier, monthly_credit_limit = excluded.monthly_credit_limit,
        updated_at = now(), updated_by = auth.uid();
end;
$$;
```

> Verify the exact `platform_admins` table/column name (`user_id`) against the schema before finalizing — grep `platform_admins` in `supabase/migrations/`. Verify `vault.create_secret` / `vault.decrypted_secrets` signatures against the installed Supabase Vault version.

- [ ] **Step 2: Hand off for apply (classifier gotcha).** Tell the user: "Migration written at `supabase/migrations/<ts>_ai_platform_foundation.sql` — please apply it (agent cannot push migrations)." Wait for confirmation.

- [ ] **Step 3: Regenerate types + advisors.** After apply, run `generate_typescript_types` → overwrite `src/types/database.types.ts`; run `get_advisors` and confirm **zero new warnings** (fix RLS/security advisories before proceeding).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_ai_platform_foundation.sql src/types/database.types.ts
git commit -m "feat(ai): migration for org ai settings, usage ledger, and vault byo keys"
```

---

## Task 1: Pricing — cost + credit computation (pure) + typed errors

**Files:**

- Create: `src/lib/ai/pricing.ts`, `src/lib/ai/pricing.test.ts`
- Modify: `src/lib/ai/anthropic.ts` (add typed errors)

**Interfaces:**

- Produces: `PRICE_TABLE: Record<string,{inputPerMTok:number;outputPerMTok:number}>`, `computeCost(model,input,output)→number` (USD), `costToCredits(usd)→number`; errors `AiDisabledError`, `ByoKeyMissingError`, `AiQuotaExceededError` (exported from `anthropic.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeCost, costToCredits, PRICE_TABLE } from "@/lib/ai/pricing";

describe("computeCost", () => {
  it("prices a known model by input+output MTok rates", () => {
    const p = PRICE_TABLE["claude-opus-4-8"];
    expect(p).toBeDefined();
    const cost = computeCost("claude-opus-4-8", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(p.inputPerMTok + p.outputPerMTok, 6);
  });
  it("falls back to a safe default for an unknown model (never 0)", () => {
    expect(computeCost("mystery-model", 1000, 1000)).toBeGreaterThan(0);
  });
});

describe("costToCredits", () => {
  it("maps USD to whole-ish credits deterministically (100 credits = $1)", () => {
    expect(costToCredits(1)).toBeCloseTo(100, 2);
    expect(costToCredits(0.023)).toBeCloseTo(2.3, 2);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test src/lib/ai/pricing.test.ts`

- [ ] **Step 3: Implement `src/lib/ai/pricing.ts`**

```ts
/** USD per 1M tokens. Update when provider pricing changes. */
export const PRICE_TABLE: Record<
  string,
  { inputPerMTok: number; outputPerMTok: number }
> = {
  "claude-opus-4-8": { inputPerMTok: 15, outputPerMTok: 75 },
};
const DEFAULT_PRICE = { inputPerMTok: 15, outputPerMTok: 75 };

/** Cost in USD for a single call. */
export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICE_TABLE[model] ?? DEFAULT_PRICE;
  return (
    (inputTokens / 1_000_000) * p.inputPerMTok +
    (outputTokens / 1_000_000) * p.outputPerMTok
  );
}

/** 100 credits == $1 of spend. Keeps the user-facing unit friendly. */
export function costToCredits(usd: number): number {
  return Math.round(usd * 100 * 100) / 100;
}
```

- [ ] **Step 4: Add typed errors to `src/lib/ai/anthropic.ts`** (co-located with `AiNotConfiguredError`):

```ts
export class AiDisabledError extends Error {
  constructor() {
    super("AI is turned off for this workspace.");
    this.name = "AiDisabledError";
  }
}
export class ByoKeyMissingError extends Error {
  constructor() {
    super("No AI API key is configured for this workspace.");
    this.name = "ByoKeyMissingError";
  }
}
export class AiQuotaExceededError extends Error {
  constructor() {
    super("You've used this month's AI allowance.");
    this.name = "AiQuotaExceededError";
  }
}
```

- [ ] **Step 5: Run → PASS.** `pnpm test src/lib/ai/pricing.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/pricing.ts src/lib/ai/pricing.test.ts src/lib/ai/anthropic.ts
git commit -m "feat(ai): pricing/credit computation and typed ai errors"
```

---

## Task 2: Usage recording (RPC wrappers, injectable client)

**Files:**

- Create: `src/lib/ai/usage.ts`, `src/lib/ai/usage.test.ts`

**Interfaces:**

- Consumes: `record_ai_usage`, `ai_credits_used_this_month` RPCs (Task 0); `computeCost`, `costToCredits` (Task 1).
- Produces: `type UsageInput`, `recordUsage(client, input): Promise<void>`, `creditsUsedThisMonth(client, orgId): Promise<number>`. `client` is a minimal `{ rpc(name,args) }` shape so tests inject a fake.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/usage.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { recordUsage, creditsUsedThisMonth } from "@/lib/ai/usage";

const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as never;

describe("recordUsage", () => {
  it("computes cost+credits and calls record_ai_usage with them", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await recordUsage(client(rpc), {
      orgId: "o1",
      userId: "u1",
      feature: "ask_pulse",
      provider: "anthropic",
      model: "claude-opus-4-8",
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_ai_usage",
      expect.objectContaining({
        p_org_id: "o1",
        p_feature: "ask_pulse",
        p_input_tokens: 1000,
        p_output_tokens: 500,
      }),
    );
    const args = rpc.mock.calls[0][1];
    expect(args.p_cost_usd).toBeGreaterThan(0);
    expect(args.p_credits).toBeGreaterThan(0);
  });
});

describe("creditsUsedThisMonth", () => {
  it("returns the RPC scalar", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 12.5, error: null });
    expect(await creditsUsedThisMonth(client(rpc), "o1")).toBe(12.5);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/usage.ts`**

```ts
import { computeCost, costToCredits } from "@/lib/ai/pricing";

type Rpc = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export type UsageInput = {
  orgId: string;
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function recordUsage(client: Rpc, u: UsageInput): Promise<void> {
  const cost = computeCost(u.model, u.inputTokens, u.outputTokens);
  const credits = costToCredits(cost);
  const { error } = await client.rpc("record_ai_usage", {
    p_org_id: u.orgId,
    p_user_id: u.userId,
    p_feature: u.feature,
    p_provider: u.provider,
    p_model: u.model,
    p_input_tokens: u.inputTokens,
    p_output_tokens: u.outputTokens,
    p_cost_usd: cost,
    p_credits: credits,
  });
  if (error) throw error;
}

export async function creditsUsedThisMonth(
  client: Rpc,
  orgId: string,
): Promise<number> {
  const { data, error } = await client.rpc("ai_credits_used_this_month", {
    p_org_id: orgId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/usage.ts src/lib/ai/usage.test.ts
git commit -m "feat(ai): usage ledger recording and monthly credit rollup"
```

---

## Task 3: Entitlement guard

**Files:**

- Create: `src/lib/ai/entitlement.ts`, `src/lib/ai/entitlement.test.ts`

**Interfaces:**

- Consumes: `org_ai_settings` read, `creditsUsedThisMonth` (Task 2); errors from `anthropic.ts` (Task 1).
- Produces: `type AiEntitlement = {mode:'off'|'managed'|'byo';tier:string;creditsLimit:number;creditsUsed:number;creditsRemaining:number}`; `getAiEntitlement(client, orgId): Promise<AiEntitlement>`; `requireAiEntitlement(client, orgId, feature): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/entitlement.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getAiEntitlement, requireAiEntitlement } from "@/lib/ai/entitlement";
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/anthropic";

function client(settings: unknown, used = 0) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: settings, error: null }),
        }),
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: used, error: null }),
  } as never;
}

describe("getAiEntitlement", () => {
  it("computes remaining credits for a managed org", async () => {
    const e = await getAiEntitlement(
      client(
        { ai_mode: "managed", tier: "pro", monthly_credit_limit: 1000 },
        250,
      ),
      "o1",
    );
    expect(e).toMatchObject({
      mode: "managed",
      creditsLimit: 1000,
      creditsUsed: 250,
      creditsRemaining: 750,
    });
  });
  it("defaults to off when no row exists", async () => {
    const e = await getAiEntitlement(client(null), "o1");
    expect(e.mode).toBe("off");
  });
});

describe("requireAiEntitlement", () => {
  it("throws AiDisabledError when off", async () => {
    await expect(
      requireAiEntitlement(client(null), "o1", "ask_pulse"),
    ).rejects.toBeInstanceOf(AiDisabledError);
  });
  it("throws AiQuotaExceededError when managed limit reached", async () => {
    await expect(
      requireAiEntitlement(
        client(
          { ai_mode: "managed", tier: "pro", monthly_credit_limit: 100 },
          100,
        ),
        "o1",
        "ask_pulse",
      ),
    ).rejects.toBeInstanceOf(AiQuotaExceededError);
  });
  it("passes for byo regardless of credits", async () => {
    await expect(
      requireAiEntitlement(
        client({ ai_mode: "byo", tier: "none", monthly_credit_limit: 0 }, 9999),
        "o1",
        "ask_pulse",
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/entitlement.ts`**

```ts
import { AiDisabledError, AiQuotaExceededError } from "@/lib/ai/anthropic";
import { creditsUsedThisMonth } from "@/lib/ai/usage";

type Client = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export type AiEntitlement = {
  mode: "off" | "managed" | "byo";
  tier: string;
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
};

export async function getAiEntitlement(
  client: Client,
  orgId: string,
): Promise<AiEntitlement> {
  const { data } = await client
    .from("org_ai_settings")
    .select("ai_mode,tier,monthly_credit_limit")
    .eq("org_id", orgId)
    .maybeSingle();
  const row = (data ?? null) as {
    ai_mode?: string;
    tier?: string;
    monthly_credit_limit?: number;
  } | null;
  const mode = (row?.ai_mode ?? "off") as AiEntitlement["mode"];
  const creditsLimit = row?.monthly_credit_limit ?? 0;
  const creditsUsed =
    mode === "managed" ? await creditsUsedThisMonth(client, orgId) : 0;
  return {
    mode,
    tier: row?.tier ?? "none",
    creditsLimit,
    creditsUsed,
    creditsRemaining: Math.max(0, creditsLimit - creditsUsed),
  };
}

export async function requireAiEntitlement(
  client: Client,
  orgId: string,
  _feature: string,
): Promise<void> {
  const e = await getAiEntitlement(client, orgId);
  if (e.mode === "off") throw new AiDisabledError();
  if (e.mode === "managed" && e.creditsRemaining <= 0)
    throw new AiQuotaExceededError();
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/entitlement.ts src/lib/ai/entitlement.test.ts
git commit -m "feat(ai): org ai entitlement + quota guard"
```

---

## Task 4: Gateway — resolveAiClient + runAi

**Files:**

- Create: `src/lib/ai/gateway.ts`, `src/lib/ai/gateway.test.ts`

**Interfaces:**

- Consumes: `getAnthropicClient`, `MODEL`, `ByoKeyMissingError`, `AiDisabledError` (anthropic.ts); `recordUsage` (Task 2); `get_byo_ai_secret` RPC (Task 0). A service Supabase client for the privileged Vault read + ledger write.
- Produces: `resolveAiClient(serviceClient, orgId): Promise<{client:Anthropic;mode;provider}>`; `runAi<T>(serviceClient, {orgId,userId,feature}, fn:(client)=>Promise<{result:T;usage:{input_tokens:number;output_tokens:number};model:string}>): Promise<T>`.

- [ ] **Step 1: Write the failing test (injected fakes)**

Create `src/lib/ai/gateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runAi } from "@/lib/ai/gateway";

function serviceClient(mode: string, key = "sk-byo-xxxx1234") {
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_byo_ai_secret") return { data: key, error: null };
    return { data: null, error: null }; // record_ai_usage
  });
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { ai_mode: mode, byo_provider: "anthropic" },
            error: null,
          }),
        }),
      }),
    }),
    rpc,
  } as never;
}

describe("runAi", () => {
  it("runs fn and records usage from the returned usage block", async () => {
    const svc = serviceClient("managed");
    const out = await runAi(
      svc,
      { orgId: "o1", userId: "u1", feature: "ask_pulse" },
      async () => ({
        result: "answer",
        usage: { input_tokens: 100, output_tokens: 40 },
        model: "claude-opus-4-8",
      }),
    );
    expect(out).toBe("answer");
    const rpcNames = (
      svc as never as { rpc: ReturnType<typeof vi.fn> }
    ).rpc.mock.calls.map((c) => c[0]);
    expect(rpcNames).toContain("record_ai_usage");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/gateway.ts`**

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  getAnthropicClient,
  AiDisabledError,
  ByoKeyMissingError,
} from "@/lib/ai/anthropic";
import { recordUsage } from "@/lib/ai/usage";

// Minimal shape of the service Supabase client the gateway needs.
type ServiceClient = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

export async function resolveAiClient(svc: ServiceClient, orgId: string) {
  const { data } = await svc
    .from("org_ai_settings")
    .select("ai_mode,byo_provider")
    .eq("org_id", orgId)
    .maybeSingle();
  const row = (data ?? {}) as { ai_mode?: string; byo_provider?: string };
  const mode = (row.ai_mode ?? "off") as "off" | "managed" | "byo";
  if (mode === "off") throw new AiDisabledError();
  if (mode === "byo") {
    const { data: key } = await svc.rpc("get_byo_ai_secret", {
      p_org_id: orgId,
    });
    if (!key || typeof key !== "string") throw new ByoKeyMissingError();
    return {
      client: new Anthropic({ apiKey: key }),
      mode,
      provider: row.byo_provider ?? "anthropic",
    };
  }
  return { client: getAnthropicClient(), mode, provider: "anthropic" };
}

export async function runAi<T>(
  svc: ServiceClient,
  ctx: { orgId: string; userId: string | null; feature: string },
  fn: (
    client: Anthropic,
    provider: string,
  ) => Promise<{
    result: T;
    usage: { input_tokens: number; output_tokens: number };
    model: string;
  }>,
): Promise<T> {
  const { client, provider } = await resolveAiClient(svc, ctx.orgId);
  const { result, usage, model } = await fn(client, provider);
  await recordUsage(svc as never, {
    orgId: ctx.orgId,
    userId: ctx.userId,
    feature: ctx.feature,
    provider,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  });
  return result;
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/gateway.ts src/lib/ai/gateway.test.ts
git commit -m "feat(ai): gateway resolving managed/byo client with metering"
```

---

## Task 5: Migrate dashboard-gen onto the gateway

**Files:**

- Modify: `src/lib/ai/generate.ts`, `src/lib/ai/actions.ts`, and their tests

**Interfaces:**

- Consumes: `runAi` (Task 4). Produces: no new exports; dashboard-gen now records usage + respects entitlement.

- [ ] **Step 1: Update the action.** In `generateDashboardProposal` (`src/lib/ai/actions.ts`): derive `orgId` from the board (already resolved for RLS) + `userId` from session; call `requireAiEntitlement(client, orgId, 'dashboard_gen')` before generating; wrap the Opus call in `runAi(svc, {orgId,userId,feature:'dashboard_gen'}, …)` so `generateProposal` returns `{result, usage, model}`.

- [ ] **Step 2: Update `generateProposal` (`generate.ts`)** to also return the `usage` block off the SDK response (`res.usage`) and `MODEL`, so `runAi` can meter it. Keep the injected-client signature.

- [ ] **Step 3: Update the existing dashboard-gen tests** (`generate.test.ts`, `actions.test.ts`) so the mocked SDK response includes a `usage:{input_tokens,output_tokens}` block, and assert `record_ai_usage` is invoked. Add a test that `generateDashboardProposal` returns the disabled/quota error when `requireAiEntitlement` throws.

- [ ] **Step 4: Run → PASS.** `pnpm test src/lib/ai/`

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/generate.ts src/lib/ai/actions.ts src/lib/ai/generate.test.ts src/lib/ai/actions.test.ts
git commit -m "refactor(ai): route dashboard generation through the metered gateway"
```

---

## Task 6: Settings actions (org AI settings, BYO key, admin plan)

**Files:**

- Create: `src/lib/ai/settings-actions.ts`, `src/lib/ai/settings-actions.test.ts`

**Interfaces:**

- Consumes: `getAiEntitlement` (3); `set_byo_ai_secret`/`remove_byo_ai_secret`/`set_org_ai_plan` RPCs (0); session/org guards; `getAnthropicClient`/`Anthropic` for the BYO validate ping.
- Produces (all `ActionResult<T>`):
  - `getOrgAiSettings(): {mode;tier;creditsLimit;creditsUsed;creditsRemaining;byoProvider?;byoKeyLast4?}`
  - `setAiMode({mode:'off'|'managed'|'byo'})`
  - `setByoKey({provider:'anthropic';key:string})` — validates then stores
  - `removeByoKey()`
  - `setOrgAiPlan({orgId:string;tier:string;monthlyCreditLimit:number})` — platform-admin only

- [ ] **Step 1: Write failing tests** (`settings-actions.test.ts`) — mock `@/lib/supabase/server` `createClient`, `@/lib/auth/session`, and the Anthropic SDK. Cover:
  - `setByoKey` calls a 1-token Anthropic ping; on success calls `rpc('set_byo_ai_secret', {p_org_id,p_provider,p_key})` and returns `{ok:true}`; on ping failure returns `{ok:false, error:/couldn't validate/i}` and **does not** call the RPC.
  - `setAiMode` to `byo` with no stored key returns `{ok:false}` (guard).
  - `getOrgAiSettings` maps entitlement + byo display fields.
  - `setOrgAiPlan` returns `{ok:false}` when `isPlatformAdmin()` is false (assert RPC not called).

Representative test:

```ts
it("validates a byo key before storing it", async () => {
  create.mockResolvedValue({ ok: true }); // Anthropic ping mock resolves
  rpc.mockResolvedValue({ data: "sec-1", error: null });
  const { setByoKey } = await import("@/lib/ai/settings-actions");
  const res = await setByoKey({
    provider: "anthropic",
    key: "sk-test-abcd1234",
  });
  expect(res.ok).toBe(true);
  expect(rpc).toHaveBeenCalledWith(
    "set_byo_ai_secret",
    expect.objectContaining({ p_provider: "anthropic" }),
  );
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/settings-actions.ts`** — `"use server"`, Zod schemas (`mode` enum; `key` `z.string().min(20).max(200)`; `provider` `z.literal('anthropic')`; plan `tier` string + `monthlyCreditLimit` `z.number().int().min(0)`), `ActionResult`, `createClient()`. `setByoKey` does a real validate ping: `new Anthropic({apiKey:key}).messages.create({model:MODEL,max_tokens:1,messages:[{role:'user',content:'ping'}]})` in a try/catch (network/401 → `fail`). Derive `orgId` from `getUserOrgs()[0]`. Admin/platform-admin guards mirror `src/lib/org/admin-actions.ts`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/settings-actions.ts src/lib/ai/settings-actions.test.ts
git commit -m "feat(ai): server actions for ai settings, byo key validate/store, admin plan"
```

---

## Task 7: RLS + Vault integration tests

**Files:**

- Create: `src/lib/ai/ai-platform.rls.integration.test.ts`

Follow `src/lib/dashboards/dashboards.rls.integration.test.ts` (dotenv, `describe.skipIf(!SERVICE_ROLE_KEY)`, admin + anon clients, `signInWithRetry`).

- [ ] **Step 1:** Seed two orgs (A, B) with an owner each (admin client).
- [ ] **Step 2:** User A (anon) can `select` own `org_ai_settings` and **cannot** read org B's (RLS empty).
- [ ] **Step 3:** User A (anon) **cannot** `rpc('get_byo_ai_secret',{p_org_id:A})` (execute revoked from `authenticated`) — expect an error/empty; the admin (service) client **can**.
- [ ] **Step 4:** `ai_usage` inserted via `record_ai_usage` (service) is readable by A only for org A; A cannot insert directly (no policy).
- [ ] **Step 5:** A non-admin member of org A cannot `rpc('set_org_ai_plan',...)` (platform-admin gate).
- [ ] **Step 6:** Run → PASS or SKIP without the key. Commit:

```bash
git add src/lib/ai/ai-platform.rls.integration.test.ts
git commit -m "test(ai): rls + vault boundary coverage for ai platform"
```

---

## Task 8: (folded into Task 1 — typed errors)

_No separate task; the typed errors ship with Task 1. Listed in the DAG for clarity._

---

## Task 9: Settings AI form UI

**Files:**

- Create: `src/components/settings/ai/AiSettingsForm.tsx`, `src/components/settings/ai/AiSettingsForm.test.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

**Load `pulse-ui` + `frontend-design` first.** Client component; state via `useState`+`useTransition`; **no router navigation**.

- [ ] **Step 1: Failing component test** (`AiSettingsForm.test.tsx`, mock `@/lib/ai/settings-actions`): renders current mode; switching to Managed shows the credit meter (used/limit); the BYO panel's "Validate & save" calls `setByoKey` with the typed value; an action `{ok:false,error}` renders in `role="alert"`; when a key is stored, shows `•••• last4` + a "Remove" button that calls `removeByoKey`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `AiSettingsForm.tsx`** — a mode segmented control (Off / Managed / BYO), a credit usage meter (`creditsUsed`/`creditsLimit` as a bar, reuse a battery/progress primitive if present), and the BYO key panel (masked `<input type="password">`, Validate & save, last4 + Remove). Uses shadcn `Button`, `Label`, `Input`, alert. Mount in `src/app/(app)/settings/page.tsx` under a new "AI" section, passing initial settings from a server read (`getOrgAiSettings` in the RSC, or lazy-load the form and fetch on mount — keep first paint unchanged with `next/dynamic`, `ssr:false`).

- [ ] **Step 4: Run → PASS.** Also run the existing `settings` page tests if any.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ai/AiSettingsForm.tsx src/components/settings/ai/AiSettingsForm.test.tsx "src/app/(app)/settings/page.tsx"
git commit -m "feat(ai): settings ai section with mode, credits meter, and byo key"
```

---

## Task 10: Admin plan control UI

**Files:**

- Create: `src/components/admin/AiPlanControl.tsx`, `src/components/admin/AiPlanControl.test.tsx`
- Modify: `src/app/admin/organizations/[id]/page.tsx`

- [ ] **Step 1: Failing test** — renders tier + monthly credit limit inputs; Save calls the mocked `setOrgAiPlan({orgId,tier,monthlyCreditLimit})`; success shows a "Saved" state.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `AiPlanControl.tsx` (client; tier select + numeric limit + Save via `useTransition`). Mount in `src/app/admin/organizations/[id]/page.tsx` (already `isPlatformAdmin`-gated) passing `orgId` + current tier/limit.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AiPlanControl.tsx src/components/admin/AiPlanControl.test.tsx "src/app/admin/organizations/[id]/page.tsx"
git commit -m "feat(ai): platform-admin ai plan control per org"
```

---

## Task 11: Ask Pulse read tools (RLS-bound)

**Files:**

- Create: `src/lib/ai/ask/tools.ts`, `src/lib/ai/ask/tools.test.ts`

**Interfaces:**

- Consumes: `listMyBoards`, `getBoardPayload` (`src/lib/boards/queries.ts`), `buildBoardSnapshot` (`src/lib/ai/board-snapshot.ts`), the cookie-bound `createClient()`.
- Produces: `ASK_TOOLS` (Anthropic tool schema array: `list_boards`, `get_board_overview`, `query_items`), and `executeAskTool(name, input, ctx): Promise<unknown>` where `ctx={workspaceId, supabase}` — the executor runs RLS-scoped reads. `query_items` caps `limit` at 50.

- [ ] **Step 1: Failing test** (`tools.test.ts`) — with a fake `ctx.supabase`/mocked queries: `list_boards` returns only the workspace's boards; `get_board_overview` returns a snapshot with no raw item ids (`expect(JSON.stringify(out)).not.toContain(itemId)`); `query_items` clamps `limit:500` → ≤50 and only returns rows for the requested board.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/ask/tools.ts`** — define the three tool JSON schemas (specific `input_schema`, per gotcha-45 avoid permissive objects) and `executeAskTool`:
  - `list_boards` → `listMyBoards()` filtered to `ctx.workspaceId` → `[{id,name}]`.
  - `get_board_overview({board_id})` → `getBoardPayload(board_id)` (null → "not found/visible") → `buildBoardSnapshot(...)` (schema + stats only).
  - `query_items({board_id, filters?, sort?, limit})` → bounded RLS read over `items`+`cell_values` (limit `Math.min(limit ?? 20, 50)`), returning `[{name, cells:{[columnName]:value}}]` for the requested columns only. Reuse existing query helpers where present; never `select *` unbounded.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/tools.ts src/lib/ai/ask/tools.test.ts
git commit -m "feat(ai): ask pulse rls-scoped read tools"
```

---

## Task 12: Ask Pulse tool-use loop

**Files:**

- Create: `src/lib/ai/ask/ask.ts`, `src/lib/ai/ask/ask.test.ts`

**Before coding, read the `claude-api` skill + its TS tool-use docs** for the exact multi-turn tool loop (`messages.create` with `tools`, handling `stop_reason:"tool_use"`, appending `tool_result` blocks). Keep the client injected.

**Interfaces:**

- Consumes: `ASK_TOOLS`, `executeAskTool` (11); `MODEL`.
- Produces: `askPulseLoop(client, {question, ctx, maxRounds?}): Promise<{answer:string; boardsConsulted:string[]; usage:{input_tokens:number;output_tokens:number}; model:string}>`.

- [ ] **Step 1: Failing test** (`ask.test.ts`) — a fake client whose first `messages.create` returns a `tool_use` for `list_boards`, and whose second returns a final text answer. Assert the executor was called, `boardsConsulted` is populated from `get_board_overview`/`query_items` calls, and the final `answer` text is returned. Accumulate `usage` across turns.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/ask/ask.ts`** — system prompt: "Answer only from tool results. Cite which boards you consulted. If the tools don't contain the answer, say so. Never invent data." Loop: send `tools:ASK_TOOLS`; while `stop_reason==='tool_use'` and rounds < `maxRounds` (default 6), execute each requested tool via `executeAskTool`, append `tool_result`, continue; collect `board_id`s seen; sum `usage`. Return the final assistant text. **Confirm the exact SDK shapes against the claude-api docs** (do not trust this pseudocode for field names).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/ask.ts src/lib/ai/ask/ask.test.ts
git commit -m "feat(ai): ask pulse tool-use loop (workspace q&a)"
```

---

## Task 13: Ask Pulse action

**Files:**

- Create: `src/lib/ai/ask/actions.ts`, `src/lib/ai/ask/actions.test.ts`

**Interfaces:**

- Consumes: `requireAiEntitlement` (3), `runAi` (4), `askPulseLoop` (12), session/org.
- Produces: `askPulse({workspaceId:string; question:string}): Promise<ActionResult<{answer:string; boardsConsulted:string[]}>>`.

- [ ] **Step 1: Failing tests** (`actions.test.ts`, mock supabase/session/`askPulseLoop`): returns disabled error when `requireAiEntitlement` throws `AiDisabledError`; on success returns `{ok:true,data:{answer,boardsConsulted}}` and `record_ai_usage` is called via `runAi`; rejects a `question` > 1000 chars via Zod.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/ai/ask/actions.ts`** — `"use server"`; Zod input (`workspaceId` uuid, `question` `z.string().min(1).max(1000)`); derive `orgId`/`userId`; `requireAiEntitlement(client, orgId, 'ask_pulse')`; build `ctx={workspaceId, supabase:client}`; `runAi(svc, {orgId,userId,feature:'ask_pulse'}, (c)=>askPulseLoop(c,{question,ctx}))` — `askPulseLoop` returns the `{result:{answer,boardsConsulted}, usage, model}` shape `runAi` expects (wrap accordingly). Translate typed errors to `fail(...)`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ask/actions.ts src/lib/ai/ask/actions.test.ts
git commit -m "feat(ai): ask pulse server action with entitlement + metering"
```

---

## Task 14: Ask Pulse UI + ⌘K entry

**Files:**

- Create: `src/components/ai/ask/AskPulse.tsx`, `src/components/ai/ask/AskPulse.test.tsx`, `src/components/ai/ask/AskPulseLauncher.tsx`
- Modify: `src/components/command-palette.tsx`, `src/stores/ui.ts` (add `askPulseOpen` flag)

**Load `pulse-ui` + `frontend-design` first.**

- [ ] **Step 1: Failing test** (`AskPulse.test.tsx`, mock `@/lib/ai/ask/actions`): typing a question + submit calls `askPulse({workspaceId,question})`; a "thinking…" state shows during the transition; the answer + "Consulted: Board A, Board B" render; a `{ok:false,error}` (disabled/quota) renders in `role="alert"` with a link to Settings.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `AskPulse.tsx` (client; textarea + submit via `useTransition`; renders answer, sources, credit note; empty/disabled/quota states first-class — no AI glow, calm styling), `AskPulseLauncher.tsx` (lazy `next/dynamic`, `ssr:false`, controlled by `useUIStore().askPulseOpen`). Add `askPulseOpen`+`setAskPulseOpen` to `src/stores/ui.ts`. In `src/components/command-palette.tsx`, add an "Ask Pulse…" command that sets `askPulseOpen=true` and closes the palette. Pass the active `workspaceId` from existing palette data.

- [ ] **Step 4: Run → PASS.** Also run `command-palette` tests to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/components/ai/ask/AskPulse.tsx src/components/ai/ask/AskPulse.test.tsx src/components/ai/ask/AskPulseLauncher.tsx src/components/command-palette.tsx src/stores/ui.ts
git commit -m "feat(ai): ask pulse panel and command-palette entry"
```

---

## Task 15: Final wiring + verification gates

**Files:** none new — integration + cleanup.

- [ ] **Step 1:** Trace end-to-end against the code: Settings AI (set managed / paste BYO → validate → store) → ⌘K "Ask Pulse…" → ask a workspace question → answer + sources → credit meter reflects spend. Confirm dashboard-gen still works and now records usage. Fix any prop/return-name mismatches.
- [ ] **Step 2: Run the four gates:**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all PASS (RLS integration test SKIPs without `SUPABASE_SERVICE_ROLE_KEY`, per repo norm).

- [ ] **Step 3:** If lint flags an unavoidable `any` at the SDK boundary, justify inline (match the `dashboard_series` precedent). Re-run advisors if any RLS was touched.
- [ ] **Step 4: Commit any fixes**

```bash
git add <paths>
git commit -m "chore(ai): wire ai platform + ask pulse end-to-end and green the gates"
```

---

## Self-review (completed)

- **Spec coverage:** F1 gateway → Task 4; F2 Vault BYO store → Task 0 (funcs) + Task 6 (validate/store) + Task 9 (UI); F3 ledger+credits → Task 0 + Tasks 1,2 + Task 3 (quota); F4 entitlements+controls → Task 3 + Task 6 + Tasks 9,10; F5 Ask Pulse workspace-wide read-only → Tasks 11,12,13,14; dashboard-gen migration → Task 5; security (definer/revoke/RLS) → Task 0 + Task 7; perf budget → stated + lazy/client-state in Tasks 9,14; env/ops → Global Constraints + Task 0 Step 3. No uncovered spec section.
- **Placeholder scan:** pure/load-bearing modules (pricing, usage, entitlement, gateway) ship full code+tests; action/UI/loop tasks give exact signatures, RPC names, Zod bounds, and representative tests — matching the accepted `2026-06-23-ai-dashboard-gen.md` plan style. The Ask Pulse loop (Task 12) explicitly defers SDK field names to the claude-api docs (post-cutoff) and keeps the client injected so tests never hit the network.
- **Type consistency:** `resolveAiClient`, `runAi`, `recordUsage`, `UsageInput`, `getAiEntitlement`, `requireAiEntitlement`, `AiEntitlement`, `computeCost`, `costToCredits`, `AiDisabledError`/`ByoKeyMissingError`/`AiQuotaExceededError`, `executeAskTool`/`ASK_TOOLS`, `askPulseLoop`, `askPulse`, and the RPC names (`record_ai_usage`, `ai_credits_used_this_month`, `get_byo_ai_secret`, `set_byo_ai_secret`, `remove_byo_ai_secret`, `set_org_ai_plan`) are used identically across tasks.
- **Open verification (call out at execution):** exact `platform_admins` column, `vault.create_secret`/`decrypted_secrets` signatures, the repo's service-client factory name, and the Anthropic tool-loop SDK shape — each flagged inline in its task.

```

```
