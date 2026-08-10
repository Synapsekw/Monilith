# Provider & Model Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user hold one API key per provider (Anthropic, OpenAI, Google, Mistral, Kimi), pin any agent to any model those keys can reach, and have new models appear without a deploy.

**Architecture:** Two new tables — `ai_providers` (registry) and `ai_models` (catalog) — replace a three-member TS union and a hardcoded price map. A daily HMAC-signed cron refreshes the catalog from the public Vercel AI Gateway models feed. The `ProviderAdapter` interface, `registry` and `runAi` metering chokepoint survive unchanged in shape; only adapter internals move to AI SDK v6, plus one new generic `openai-compatible` adapter that serves Mistral, Kimi and every provider added later.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase (Postgres + RLS + Vault + pg_cron), TypeScript strict, Zod, Vitest, AI SDK v6.

**Spec:** `docs/superpowers/specs/2026-08-10-provider-model-layer-design.md`

## Global Constraints

- **Server Components by default.** Client components only when interactive; **Server Actions for all mutations**.
- **Validate at boundaries with Zod.** TypeScript strict; avoid `any`.
- **RLS is the security boundary.** Default-deny, org-scoped. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- **Reuse canonical modules.** Server actions return `ActionResult` / `fail` from `src/lib/actions/result.ts`. Typed RPC goes through `src/lib/supabase/typed-rpc.ts`. Grep before writing any helper.
- **One migration for this whole plan** (Task 1). Minted **only** via `scripts/new-migration.sh <slug>`. Applied to DEV via the `supabase-dev` MCP with the **same version + name** as the committed file, then verified with `pnpm db:ledger-check`. Do **not** mint a second migration in a later task — parallel migrations in sibling worktrees collide (gotcha-43).
- **`pnpm db:types` fails inside a task worktree** (`LegacyProjectNotLinkedError`). Regenerate via the `supabase-dev` MCP `generate_typescript_types`, then run prettier on the result.
- **All new/changed SQL functions** stay `security definer`, `set search_path = public, vault`, revoked from `public, anon, authenticated`, granted only to `service_role`.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path — never `git add -A`.
- **Commit subjects must be lowercase** (commitlint `subject-case` rejects sentence-case).
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before `scripts/finish-task.sh`.
- **Seeded providers, exactly these five:** `anthropic`, `openai`, `google`, `mistral`, `moonshotai`.
- **Tier thresholds** (USD per Mtok input): `cheap` ≤ 1.0, `standard` ≤ 5.0, `strong` > 5.0.
- **Gateway feed URL:** `https://ai-gateway.vercel.sh/v1/models` — public, no auth required (verified 2026-08-10, HTTP 200).
- **The Gateway-as-a-provider row is deliberately NOT seeded.** The spec notes it falls out of the registry for free (`adapter_kind: openai-compatible`, `base_url: https://ai-gateway.vercel.sh/v1`, one key reaching all 324 models), but the five named providers are the agreed scope. Adding it later is one row and no code — which is the whole point of Task 1.

## Execution DAG

| Task | Deliverable                                                                         | Depends on |
| ---- | ----------------------------------------------------------------------------------- | ---------- |
| 1    | Migration: `ai_providers`, `ai_models`, FK swaps, credential fns, new columns, cron | —          |
| 2    | Gateway feed parser (pure) + captured fixture                                       | —          |
| 3    | AI SDK v6 adapter rewrite + generic `openai-compatible` adapter                     | —          |
| 4    | Catalog refresh endpoint + wiring                                                   | 1, 2       |
| 5    | Per-provider credentials: server actions + `credentials.ts`                         | 1          |
| 6    | Catalog-backed pricing (`computeCostUsd` takes rates)                               | 1          |
| 7    | `resolveModel` + `model-map` → tier map                                             | 1, 6       |
| 8    | `gateway.ts`: provider threading + price lookup                                     | 3, 5, 6, 7 |
| 9    | Multi-key settings UI                                                               | 5          |
| 10   | Org default-model picker                                                            | 7          |
| 11   | Agent provider/model picker + agent columns                                         | 7, 8       |

- **Batch 1 (parallel):** 1, 2, 3
- **Batch 2 (parallel):** 3a, 4, 5, 6
- **Batch 3 (parallel):** 7, 9
- **Batch 4:** 8
- **Batch 5 (parallel):** 10, 11
- **Critical path:** 1 → 6 → 7 → 8 → 11

---

## File Structure

**Created:**

| File                                                   | Responsibility                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_ai_provider_registry.sql` | All schema for this plan, in one migration                              |
| `src/lib/ai/providers/provider-rows.ts`                | Server-only reads of `ai_providers`; the `ProviderRow` type             |
| `src/lib/ai/models/feed-parse.ts`                      | **Pure** Gateway JSON → catalog rows. No network, no DB                 |
| `src/lib/ai/models/feed-fixture.json`                  | Captured real Gateway response, trimmed to the 5 providers              |
| `src/lib/ai/models/catalog-db.ts`                      | Access seam for `ai_models`                                             |
| `src/lib/ai/models/refresh.ts`                         | Fetch + parse + upsert + retire guard                                   |
| `src/app/api/ai/models/refresh/route.ts`               | HMAC-verified endpoint the cron calls                                   |
| `src/lib/ai/models/resolve.ts`                         | `resolveModel` — the pinned/retired/default/tier matrix                 |
| `src/lib/ai/providers/openai-compatible.ts`            | One generic adapter for Mistral, Kimi, and future providers             |
| `src/components/settings/AiKeyList.tsx`                | Multi-key management UI                                                 |
| `src/components/settings/ModelPicker.tsx`              | Shared provider+model select, used by org settings and the agent editor |

**Modified:** `providers/catalog.ts`, `providers/types.ts`, `providers/registry.ts`, `providers/{anthropic,openai,google}.ts`, `pricing.ts`, `gateway.ts`, `model-map.ts`, `credentials.ts`, `credentials-actions.ts`, `org-settings.ts`, `settings-actions.ts`, `agents/agent-config.ts`, `agents/agents-db.ts`, `agents/actions.ts`, `components/agents/AgentEditor.tsx`, `app/(app)/settings/ai/page.tsx`.

---

## Task 1: Schema — provider registry, model catalog, credentials, cron

**Files:**

- Create: `supabase/migrations/<stamp>_ai_provider_registry.sql` (stamp from the script)
- Create: `src/lib/ai/providers/provider-rows.ts`
- Create: `src/lib/ai/providers/provider-rows.test.ts`
- Create: `src/lib/ai/ai_models.rls.integration.test.ts`
- Modify: `src/types/database.types.ts` (regenerated, never hand-edited)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - Tables `public.ai_providers`, `public.ai_models`.
  - SQL: `ai_credential_set(p_user uuid, p_provider text, p_secret text, p_hint text)` (no longer clears other providers), `ai_credential_delete(p_user uuid, p_provider text)`, `ai_credential_get(p_user uuid, p_provider text)`, `org_ai_secret_get(p_org uuid, p_provider text)`.
  - Columns: `org_ai_settings.default_provider`, `org_ai_settings.default_model_id`, `user_agents.provider`, `user_agents.model_id`.
  - TS: `export type AdapterKind = "anthropic" | "openai" | "google" | "openai-compatible"`, `export type ProviderRow = { id: string; label: string; adapterKind: AdapterKind; baseUrl: string | null; keyPlaceholder: string; keyFormat: string; enabled: boolean }`, `export async function listEnabledProviders(client): Promise<ProviderRow[]>`, `export async function getProviderRow(client, id: string): Promise<ProviderRow | null>`.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh ai_provider_registry
```

Note the printed path. Every SQL step below edits that one file.

- [ ] **Step 2: Write the provider registry + catalog DDL**

Append to the migration file:

```sql
-- 1) Provider registry. Replaces the three-member AiProvider TS union and the
--    two hardcoded `check (provider in (...))` constraints, so a new provider
--    is one row rather than a code change plus a migration.
create table public.ai_providers (
  id               text primary key,
  label            text not null,
  adapter_kind     text not null
    check (adapter_kind in ('anthropic','openai','google','openai-compatible')),
  -- Only meaningful for openai-compatible; the three native SDKs carry their
  -- own base URL. This single value is the whole difference between talking
  -- to Mistral and talking to Kimi.
  base_url         text,
  key_placeholder  text not null,
  -- POSIX regex for the cheap pre-flight shape check, before the live ping.
  key_format       text not null,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint ai_providers_base_url_required
    check (adapter_kind <> 'openai-compatible' or base_url is not null)
);

alter table public.ai_providers enable row level security;

-- Public vendor metadata, no tenant data: readable by any signed-in user so the
-- settings and agent-editor pickers can render server-side. No insert/update/
-- delete policies => writes are default-denied and reach the table only through
-- a migration or the service-role refresh path.
create policy "ai_providers_select_all"
  on public.ai_providers for select to authenticated using (true);

insert into public.ai_providers
  (id, label, adapter_kind, base_url, key_placeholder, key_format)
values
  ('anthropic',  'Anthropic (Claude)', 'anthropic', null,
     'sk-ant-…', '^sk-ant-'),
  ('openai',     'OpenAI',             'openai',    null,
     'sk-…',     '^sk-'),
  ('google',     'Google Gemini',      'google',    null,
     'AIza…',    '^AIza'),
  ('mistral',    'Mistral',            'openai-compatible',
     'https://api.mistral.ai/v1',  '…', '^.{16,}$'),
  ('moonshotai', 'Kimi (Moonshot AI)', 'openai-compatible',
     'https://api.moonshot.ai/v1', 'sk-…', '^sk-')
on conflict (id) do nothing;

-- 2) Model catalog. Source of truth for BOTH selection and pricing, which is
--    what stops the two from drifting.
create table public.ai_models (
  provider                    text not null references public.ai_providers (id),
  model_id                    text not null,
  gateway_id                  text not null,
  label                       text not null,
  context_length              integer,
  max_output_tokens           integer,
  supports_tools              boolean not null default false,
  input_price_per_mtok        numeric,
  output_price_per_mtok       numeric,
  -- Null means "this provider publishes no cache rate". computeCostUsd falls
  -- back to the Anthropic-wide multipliers rather than to zero, so a provider
  -- that returns cache tokens without publishing a cache price is still billed
  -- at today's rates instead of silently free.
  cache_read_price_per_mtok   numeric,
  cache_write_price_per_mtok  numeric,
  tier                        text not null default 'standard'
    check (tier in ('cheap','standard','strong')),
  status                      text not null default 'active'
    check (status in ('active','retired','needs_pricing')),
  last_seen_at                timestamptz not null default now(),
  primary key (provider, model_id)
);

alter table public.ai_models enable row level security;

create policy "ai_models_select_all"
  on public.ai_models for select to authenticated using (true);

-- Every read is "active models for provider X" — this is that index prefix.
create index ai_models_status_provider_idx
  on public.ai_models (status, provider);

-- Seed floor: the models priced in src/lib/ai/pricing.ts today. A refresh that
-- never succeeds still leaves a working picker.
insert into public.ai_models
  (provider, model_id, gateway_id, label, supports_tools,
   input_price_per_mtok, output_price_per_mtok, tier)
values
  ('anthropic','claude-opus-4-8','anthropic/claude-opus-4-8','Claude Opus 4.8',
     true,  5,   25,  'strong'),
  ('anthropic','claude-sonnet-5','anthropic/claude-sonnet-5','Claude Sonnet 5',
     true,  3,   15,  'standard'),
  ('anthropic','claude-haiku-4-5','anthropic/claude-haiku-4-5','Claude Haiku 4.5',
     true,  1,   5,   'cheap'),
  ('openai','gpt-4o','openai/gpt-4o','GPT-4o',
     true,  2.5, 10,  'standard'),
  ('google','gemini-2.0-flash','google/gemini-2.0-flash','Gemini 2.0 Flash',
     true,  0.1, 0.4, 'cheap')
on conflict (provider, model_id) do nothing;
```

- [ ] **Step 3: Write the constraint-swap + new-column DDL**

Append:

```sql
-- 3) The two hardcoded provider check constraints become foreign keys: still
--    constrained, no longer needing a migration per provider.
alter table public.user_ai_credentials
  drop constraint if exists user_ai_credentials_provider_check;
alter table public.user_ai_credentials
  add constraint user_ai_credentials_provider_fkey
  foreign key (provider) references public.ai_providers (id);

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_byo_provider_check;
alter table public.org_ai_settings
  add constraint org_ai_settings_byo_provider_fkey
  foreign key (byo_provider) references public.ai_providers (id);

-- 4) Org default model. Null default_model_id => resolveModel falls back to the
--    cheapest active model of the resolved provider at the feature's tier.
alter table public.org_ai_settings
  add column if not exists default_provider text references public.ai_providers (id),
  add column if not exists default_model_id text;

-- 5) Per-agent pin. Null on both => "use the org default", which is also the
--    backfill value, so every existing agent is unaffected.
alter table public.user_agents
  add column if not exists provider text references public.ai_providers (id),
  add column if not exists model_id text;

-- 6) Did this run fall back off a retired pin? A real boolean, not a prefix
--    stuffed into `error` — the run-history UI must not string-match to avoid
--    rendering an informational note as a hard failure (the trap
--    CLAIM_PLACEHOLDER already documents for `status`).
alter table public.user_agent_runs
  add column if not exists model_substituted boolean not null default false;
```

- [ ] **Step 4: Write the credential-function changes**

Append:

```sql
-- 7) One key PER PROVIDER. The (user_id, provider) primary key already modelled
--    this correctly; only the delete-everything loop below enforced "one active
--    provider". Dropping that loop is the whole change.
create or replace function public.ai_credential_set(
  p_user uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_old uuid;
  v_secret_id uuid;
begin
  -- Replace only THIS provider's key; other providers' keys are untouched.
  select secret_id into v_old
    from public.user_ai_credentials
   where user_id = p_user and provider = p_provider;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
    delete from public.user_ai_credentials
     where user_id = p_user and provider = p_provider;
  end if;

  v_secret_id := vault.create_secret(
    p_secret,
    'ai_key:' || p_user::text || ':' || p_provider,
    'BYO AI provider key'
  );

  insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
  values (p_user, p_provider, v_secret_id, p_hint);
end;
$$;

create or replace function public.ai_credential_delete(
  p_user uuid, p_provider text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_old uuid;
begin
  select secret_id into v_old
    from public.user_ai_credentials
   where user_id = p_user and provider = p_provider;
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
  delete from public.user_ai_credentials
   where user_id = p_user and provider = p_provider;
end;
$$;

-- Decrypt ONE provider's key. Added as an OVERLOAD, not a replacement: the
-- existing 1-arg ai_credential_get(uuid) stays until its last caller moves in
-- Task 5. Dropping it here would break credentials.ts the moment types are
-- regenerated, leaving this task unable to pass its own typecheck gate.
--
-- The 1-arg forms are DEAD after Task 8 but are deliberately NOT dropped here:
-- this plan mints exactly one migration, and dropping them needs a second one.
-- Spec 2's migration drops both. Until then they remain service_role-only, so
-- the leftover surface is a dead function no caller reaches, not an exposure.
create or replace function public.ai_credential_get(p_user uuid, p_provider text)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select c.provider, s.decrypted_secret
  from public.user_ai_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.user_id = p_user and c.provider = p_provider;
$$;

-- Org BYO gains the same per-provider argument, also as an overload. The org
-- still stores one key (byo_secret_id); the argument makes the caller state
-- which provider it expects, so a mismatch resolves to no row rather than the
-- wrong adapter.
create or replace function public.org_ai_secret_get(p_org uuid, p_provider text)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select o.byo_provider, s.decrypted_secret
  from public.org_ai_settings o
  join vault.decrypted_secrets s on s.id = o.byo_secret_id
  where o.org_id = p_org and o.byo_provider = p_provider;
$$;

revoke all on function public.ai_credential_set(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.ai_credential_delete(uuid, text)
  from public, anon, authenticated;
revoke all on function public.ai_credential_get(uuid, text)
  from public, anon, authenticated;
revoke all on function public.org_ai_secret_get(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ai_credential_set(uuid, text, text, text)
  to service_role;
grant execute on function public.ai_credential_delete(uuid, text)
  to service_role;
grant execute on function public.ai_credential_get(uuid, text) to service_role;
grant execute on function public.org_ai_secret_get(uuid, text) to service_role;
```

- [ ] **Step 5: Write the refresh cron**

Append:

```sql
-- 8) Daily catalog refresh. Same pg_net + HMAC shape as embed-sweep and
--    personal-agent-sweep. cron.schedule upserts by job name => re-runnable.
create or replace function public._ai_models_refresh_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_app_url text;
  v_secret  text;
  v_body    jsonb := jsonb_build_object('mode', 'refresh');
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

-- 03:10 UTC daily — off-peak, and clear of the 03:30 automation-runs-prune.
select cron.schedule(
  'ai-models-refresh',
  '10 3 * * *',
  $cron$ select public._ai_models_refresh_tick() $cron$
);
```

- [ ] **Step 6: Apply to DEV and verify the ledger**

Apply via the `supabase-dev` MCP `apply_migration`, using the **same version + name** as the committed filename (e.g. name `20260810HHMMSS_ai_provider_registry`). Then:

```bash
pnpm db:ledger-check
```

Expected: exit 0. If a ledger row has no committed file, that is gotcha-57 — backfill it. If the ledger stamped a different version for this file, repair with `scripts/reconcile-migration-version.sh <ledger-version> <file-version>`.

- [ ] **Step 7: Regenerate types**

`pnpm db:types` throws `LegacyProjectNotLinkedError` inside a worktree. Use the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then:

```bash
pnpm prettier --write src/types/database.types.ts
```

- [ ] **Step 8: Write the failing test for the provider-row seam**

Create `src/lib/ai/providers/provider-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toProviderRow } from "@/lib/ai/providers/provider-rows";

describe("toProviderRow", () => {
  it("maps a native provider row and leaves baseUrl null", () => {
    expect(
      toProviderRow({
        id: "anthropic",
        label: "Anthropic (Claude)",
        adapter_kind: "anthropic",
        base_url: null,
        key_placeholder: "sk-ant-…",
        key_format: "^sk-ant-",
        enabled: true,
      }),
    ).toEqual({
      id: "anthropic",
      label: "Anthropic (Claude)",
      adapterKind: "anthropic",
      baseUrl: null,
      keyPlaceholder: "sk-ant-…",
      keyFormat: "^sk-ant-",
      enabled: true,
    });
  });

  it("carries base_url through for an openai-compatible provider", () => {
    const row = toProviderRow({
      id: "moonshotai",
      label: "Kimi (Moonshot AI)",
      adapter_kind: "openai-compatible",
      base_url: "https://api.moonshot.ai/v1",
      key_placeholder: "sk-…",
      key_format: "^sk-",
      enabled: true,
    });
    expect(row.adapterKind).toBe("openai-compatible");
    expect(row.baseUrl).toBe("https://api.moonshot.ai/v1");
  });

  it("rejects an unknown adapter_kind rather than widening it", () => {
    expect(() =>
      toProviderRow({
        id: "rogue",
        label: "Rogue",
        adapter_kind: "telepathy",
        base_url: null,
        key_placeholder: "x",
        key_format: "^x",
        enabled: true,
      }),
    ).toThrow(/adapter_kind/);
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/providers/provider-rows.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/ai/providers/provider-rows"`.

- [ ] **Step 10: Implement the provider-row seam**

Create `src/lib/ai/providers/provider-rows.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Access seam for `ai_providers`. Every read of the provider registry is
 * narrowed HERE and only here, so the row shape lives in one place.
 * Mirrors `agents/agents-db.ts`.
 */

export const ADAPTER_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export type ProviderRow = {
  id: string;
  label: string;
  adapterKind: AdapterKind;
  /** Non-null exactly when adapterKind is "openai-compatible". */
  baseUrl: string | null;
  keyPlaceholder: string;
  /** POSIX regex source for the cheap pre-flight shape check. */
  keyFormat: string;
  enabled: boolean;
};

type RawProviderRow = {
  id: string;
  label: string;
  adapter_kind: string;
  base_url: string | null;
  key_placeholder: string;
  key_format: string;
  enabled: boolean;
};

const PROVIDER_COLS =
  "id, label, adapter_kind, base_url, key_placeholder, key_format, enabled";

function isAdapterKind(v: string): v is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(v);
}

/**
 * Narrow one DB row. `adapter_kind` is `text` in the generated types (the check
 * constraint is not reflected as an enum), so this is where that widening is
 * closed — throwing rather than casting, because an unknown kind means the
 * registry has drifted ahead of the code and silently picking a default adapter
 * would send a key to the wrong wire format.
 */
export function toProviderRow(raw: RawProviderRow): ProviderRow {
  if (!isAdapterKind(raw.adapter_kind))
    throw new Error(
      `toProviderRow: unknown adapter_kind "${raw.adapter_kind}" for provider "${raw.id}"`,
    );
  return {
    id: raw.id,
    label: raw.label,
    adapterKind: raw.adapter_kind,
    baseUrl: raw.base_url,
    keyPlaceholder: raw.key_placeholder,
    keyFormat: raw.key_format,
    enabled: raw.enabled,
  };
}

export async function listEnabledProviders(
  client: SupabaseClient<Database>,
): Promise<ProviderRow[]> {
  const { data, error } = await client
    .from("ai_providers")
    .select(PROVIDER_COLS)
    .eq("enabled", true)
    .order("label");
  if (error) throw new Error(`listEnabledProviders: ${error.message}`);
  return (data ?? []).map((r) => toProviderRow(r as RawProviderRow));
}

export async function getProviderRow(
  client: SupabaseClient<Database>,
  id: string,
): Promise<ProviderRow | null> {
  const { data, error } = await client
    .from("ai_providers")
    .select(PROVIDER_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProviderRow: ${error.message}`);
  return data ? toProviderRow(data as RawProviderRow) : null;
}
```

- [ ] **Step 11: Run the test again**

```bash
pnpm vitest run src/lib/ai/providers/provider-rows.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 12: Write the RLS integration test**

Create `src/lib/ai/ai_models.rls.integration.test.ts`. Follow the header pattern in `src/lib/ai/user-ai-credentials.rls.integration.test.ts` exactly (same imports, `loadIntegrationEnv()`, `describe.skipIf(!integrationTargetReady())`).

```ts
import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!integrationTargetReady())(
  "RLS: ai_providers / ai_models — public vendor metadata, read-only to clients",
  () => {
    let admin: SupabaseClient<Database>;
    let anon: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      const email = `rls-ai-models-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      createdUserIds.push(created.user!.id);
      anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { persistSession: false },
      });
      await signInWithRetry(anon, email, PASSWORD);
    });

    afterAll(async () => {
      for (const id of createdUserIds)
        await admin.auth.admin.deleteUser(id).catch(() => {});
    });

    it("lets a signed-in user read the seeded providers", async () => {
      const { data, error } = await anon.from("ai_providers").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id).sort()).toEqual([
        "anthropic",
        "google",
        "mistral",
        "moonshotai",
        "openai",
      ]);
    });

    it("lets a signed-in user read the model catalog", async () => {
      const { data, error } = await anon
        .from("ai_models")
        .select("provider, model_id")
        .eq("status", "active");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it("denies a client insert into ai_models", async () => {
      const { error } = await anon.from("ai_models").insert({
        provider: "anthropic",
        model_id: `rogue-${randomUUID()}`,
        gateway_id: "anthropic/rogue",
        label: "Rogue",
      });
      expect(error).not.toBeNull();
    });

    it("denies a client update of a model's price", async () => {
      const { error } = await anon
        .from("ai_models")
        .update({ input_price_per_mtok: 0 })
        .eq("model_id", "claude-sonnet-5");
      // Default-deny yields either an explicit error or zero affected rows;
      // assert the price is unchanged either way.
      const { data } = await admin
        .from("ai_models")
        .select("input_price_per_mtok")
        .eq("provider", "anthropic")
        .eq("model_id", "claude-sonnet-5")
        .single();
      expect(Number(data?.input_price_per_mtok)).toBe(3);
      void error;
    });

    it("denies a client insert into ai_providers", async () => {
      const { error } = await anon.from("ai_providers").insert({
        id: `rogue-${randomUUID()}`,
        label: "Rogue",
        adapter_kind: "openai-compatible",
        base_url: "https://evil.example.com/v1",
        key_placeholder: "x",
        key_format: "^x",
      });
      expect(error).not.toBeNull();
    });
  },
);
```

- [ ] **Step 13: Run the integration test**

```bash
PULSE_TEST_DB=1 pnpm vitest run src/lib/ai/ai_models.rls.integration.test.ts
```

Expected: PASS (5 tests). Without `PULSE_TEST_DB` the suite skips — that is correct and not a failure.

- [ ] **Step 14: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: **all pass, with no exceptions**. The new SQL functions are overloads, not replacements, so every existing caller of `ai_credential_get(p_user)` and `org_ai_secret_get(p_org)` still compiles. If typecheck fails here, something in this task is wrong — do not carry a red gate into Task 5.

- [ ] **Step 15: Commit**

```bash
git add supabase/migrations src/types/database.types.ts \
        src/lib/ai/providers/provider-rows.ts \
        src/lib/ai/providers/provider-rows.test.ts \
        src/lib/ai/ai_models.rls.integration.test.ts
git commit -m "feat(ai): provider registry and model catalog schema

Adds ai_providers + ai_models, swaps the two hardcoded provider check
constraints for foreign keys, makes credential storage per-provider, and
schedules the daily catalog refresh."
```

---

## Task 2: Gateway feed parser

**Files:**

- Create: `src/lib/ai/models/feed-parse.ts`
- Create: `src/lib/ai/models/feed-parse.test.ts`
- Create: `src/lib/ai/models/feed-fixture.json`

**Interfaces:**

- Consumes: nothing (deliberately pure — no DB, no network, so it is trivially testable).
- Produces:
  - `export type CatalogRow = { provider: string; model_id: string; gateway_id: string; label: string; context_length: number | null; max_output_tokens: number | null; supports_tools: boolean; input_price_per_mtok: number | null; output_price_per_mtok: number | null; cache_read_price_per_mtok: number | null; cache_write_price_per_mtok: number | null; tier: "cheap" | "standard" | "strong"; status: "active" | "needs_pricing" }`
  - `export function parseFeed(json: unknown, enabledProviders: string[]): CatalogRow[]`
  - `export function tierFor(inputPricePerMtok: number | null): "cheap" | "standard" | "strong"`

- [ ] **Step 1: Capture the fixture**

```bash
curl -s https://ai-gateway.vercel.sh/v1/models \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
keep={'anthropic','openai','google','mistral','moonshotai'}
sel=[m for m in d['data'] if m['id'].split('/')[0] in keep]
# Trim to a representative slice: keeps the file small but preserves every
# shape the parser must handle (tool-use vs not, cache-priced vs not,
# language vs image).
ids={'anthropic/claude-sonnet-5','openai/gpt-4o','google/gemini-2.0-flash',
     'mistral/mistral-large','moonshotai/kimi-k2'}
out=[m for m in sel if m['id'] in ids] or sel[:8]
json.dump({'object':'list','data':out}, sys.stdout, indent=2)
" > src/lib/ai/models/feed-fixture.json
head -30 src/lib/ai/models/feed-fixture.json
```

Then **hand-append** two synthetic entries to the fixture's `data` array so the parser's filters are exercised deterministically even if the live feed changes:

```json
{
  "id": "bfl/flux-2-pro",
  "owned_by": "bfl",
  "name": "FLUX 2 Pro",
  "type": "image",
  "tags": [],
  "context_window": null,
  "max_tokens": null
},
{
  "id": "openai/unpriced-test-model",
  "owned_by": "openai",
  "name": "Unpriced Test Model",
  "type": "language",
  "tags": ["tool-use"],
  "context_window": 128000,
  "max_tokens": 16384
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/ai/models/feed-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fixture from "@/lib/ai/models/feed-fixture.json";
import { parseFeed, tierFor } from "@/lib/ai/models/feed-parse";

const ENABLED = ["anthropic", "openai", "google", "mistral", "moonshotai"];

describe("tierFor", () => {
  it("bands by input price per Mtok", () => {
    expect(tierFor(0.1)).toBe("cheap");
    expect(tierFor(1)).toBe("cheap");
    expect(tierFor(3)).toBe("standard");
    expect(tierFor(5)).toBe("standard");
    expect(tierFor(15)).toBe("strong");
  });

  it("treats an unpriced model as standard rather than cheapest", () => {
    // A null price must never make a model look like the cheap default, or the
    // tier hint would route bulk features onto an unmetered model.
    expect(tierFor(null)).toBe("standard");
  });
});

describe("parseFeed", () => {
  const rows = parseFeed(fixture, ENABLED);

  it("drops non-language models", () => {
    expect(rows.find((r) => r.model_id === "flux-2-pro")).toBeUndefined();
  });

  it("drops models from providers that are not enabled", () => {
    expect(
      parseFeed(fixture, ["anthropic"]).every(
        (r) => r.provider === "anthropic",
      ),
    ).toBe(true);
  });

  it("splits gateway_id into provider and model_id", () => {
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet).toBeDefined();
    expect(sonnet!.provider).toBe("anthropic");
    expect(sonnet!.gateway_id).toBe("anthropic/claude-sonnet-5");
  });

  it("derives supports_tools from the tags array", () => {
    const sonnet = rows.find((r) => r.model_id === "claude-sonnet-5");
    expect(sonnet!.supports_tools).toBe(true);
  });

  it("converts per-token prices to per-Mtok", () => {
    // Kimi K2 ships input 0.00000057 $/token => 0.57 $/Mtok.
    const kimi = rows.find((r) => r.model_id === "kimi-k2");
    expect(kimi!.input_price_per_mtok).toBeCloseTo(0.57, 6);
    expect(kimi!.tier).toBe("cheap");
  });

  it("marks a model with no pricing as needs_pricing", () => {
    const unpriced = rows.find((r) => r.model_id === "unpriced-test-model");
    expect(unpriced!.status).toBe("needs_pricing");
    expect(unpriced!.input_price_per_mtok).toBeNull();
  });

  it("leaves cache prices null when the provider publishes none", () => {
    const mistral = rows.find((r) => r.provider === "mistral");
    expect(mistral).toBeDefined();
    expect(mistral!.cache_read_price_per_mtok).toBeNull();
  });

  it("returns an empty array for a malformed payload instead of throwing", () => {
    expect(parseFeed({ nope: true }, ENABLED)).toEqual([]);
    expect(parseFeed(null, ENABLED)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/models/feed-parse.test.ts
```

Expected: FAIL — cannot resolve `@/lib/ai/models/feed-parse`.

- [ ] **Step 4: Implement the parser**

Create `src/lib/ai/models/feed-parse.ts`:

```ts
import { z } from "zod";

/**
 * Pure Gateway-feed → catalog-row projection. Deliberately free of `server-only`,
 * network and DB access: the refresh sweep's correctness lives almost entirely
 * in this function, and keeping it pure is what lets it be tested against a
 * captured real response (feed-fixture.json) rather than a live endpoint.
 *
 * Feed shape verified against https://ai-gateway.vercel.sh/v1/models on
 * 2026-08-10. Prices are per-TOKEN decimal strings; we store per-Mtok numbers.
 */

export type ModelTier = "cheap" | "standard" | "strong";

export type CatalogRow = {
  provider: string;
  model_id: string;
  gateway_id: string;
  label: string;
  context_length: number | null;
  max_output_tokens: number | null;
  supports_tools: boolean;
  input_price_per_mtok: number | null;
  output_price_per_mtok: number | null;
  cache_read_price_per_mtok: number | null;
  cache_write_price_per_mtok: number | null;
  tier: ModelTier;
  status: "active" | "needs_pricing";
};

/** USD per Mtok input. Matches the spec's stated thresholds. */
const CHEAP_MAX = 1.0;
const STANDARD_MAX = 5.0;

export function tierFor(inputPricePerMtok: number | null): ModelTier {
  // An unpriced model must NOT read as "cheap" — the tier hint routes bulk
  // features (item_assist, column_fill) to the cheapest model, and an unpriced
  // model bills nothing, so treating it as cheap would silently send volume to
  // an unmetered model. Standard is the conservative middle.
  if (inputPricePerMtok === null) return "standard";
  if (inputPricePerMtok <= CHEAP_MAX) return "cheap";
  if (inputPricePerMtok <= STANDARD_MAX) return "standard";
  return "strong";
}

const pricingSchema = z
  .object({
    input: z.string().optional(),
    output: z.string().optional(),
    cachedInputTokens: z.string().optional(),
    cacheCreationInputTokens: z.string().optional(),
  })
  .partial();

const entrySchema = z.object({
  id: z.string(),
  owned_by: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).nullish(),
  context_window: z.number().nullish(),
  max_tokens: z.number().nullish(),
  pricing: pricingSchema.nullish(),
});

const feedSchema = z.object({ data: z.array(z.unknown()) });

/** Per-token decimal string → per-Mtok number. */
function perMtok(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n * 1_000_000 : null;
}

export function parseFeed(
  json: unknown,
  enabledProviders: string[],
): CatalogRow[] {
  const feed = feedSchema.safeParse(json);
  if (!feed.success) return [];
  const enabled = new Set(enabledProviders);

  const rows: CatalogRow[] = [];
  for (const raw of feed.data.data) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;

    // Only chat models. The feed also carries image, video, audio, rerank and
    // embedding models, none of which may reach a model picker.
    if (e.type !== "language") continue;

    const slash = e.id.indexOf("/");
    if (slash <= 0) continue;
    const provider = e.id.slice(0, slash);
    const modelId = e.id.slice(slash + 1);
    if (!enabled.has(provider)) continue;

    const input = perMtok(e.pricing?.input);
    const output = perMtok(e.pricing?.output);
    // Both rates are required to meter a call; either one missing means we
    // cannot bill it correctly, so the row is quarantined rather than shown.
    const priced = input !== null && output !== null;

    rows.push({
      provider,
      model_id: modelId,
      gateway_id: e.id,
      label: e.name ?? modelId,
      context_length: e.context_window ?? null,
      max_output_tokens: e.max_tokens ?? null,
      supports_tools: (e.tags ?? []).includes("tool-use"),
      input_price_per_mtok: input,
      output_price_per_mtok: output,
      cache_read_price_per_mtok: perMtok(e.pricing?.cachedInputTokens),
      cache_write_price_per_mtok: perMtok(e.pricing?.cacheCreationInputTokens),
      tier: tierFor(input),
      status: priced ? "active" : "needs_pricing",
    });
  }
  return rows;
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm vitest run src/lib/ai/models/feed-parse.test.ts
```

Expected: PASS (10 tests). If the `mistral` or `kimi-k2` assertions fail because the live feed moved, update the **fixture**, not the assertion — then confirm the new numbers by re-reading the fixture.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/models/feed-parse.ts src/lib/ai/models/feed-parse.test.ts \
        src/lib/ai/models/feed-fixture.json
git commit -m "feat(ai): pure gateway feed parser with captured fixture

Projects the AI Gateway models feed onto catalog rows: language-only,
enabled-providers-only, per-token prices converted to per-Mtok, tools
derived from tags, unpriced models quarantined as needs_pricing."
```

---

## Task 3: Adapters on AI SDK v6

**Files:**

- Modify: `src/lib/ai/providers/types.ts`
- Modify: `src/lib/ai/providers/catalog.ts`
- Modify: `src/lib/ai/providers/registry.ts`
- Modify: `src/lib/ai/providers/anthropic.ts`, `openai.ts`, `google.ts`
- Create: `src/lib/ai/providers/openai-compatible.ts`
- Modify: `src/lib/ai/providers/adapters.test.ts`
- Create: `src/lib/ai/providers/openai-compatible.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `AdapterKind` from `provider-rows.ts` (Task 1).
- Produces:
  - `export interface ProviderAdapter { kind: AdapterKind; validateKey(a: { apiKey: string; baseUrl: string | null }): Promise<void>; generateStructured<T>(a: GenerateArgs): Promise<{ data: T; usage: AiUsageTokens; model: string }>; generateProposal(a: GenerateArgs): Promise<{ proposal: DashboardProposal; usage: AiUsageTokens; model: string }> }`
  - `export type GenerateArgs = { apiKey: string; baseUrl: string | null; model: string; system: string; user: string; schema: object; thinking?: ThinkingConfig; effort?: Effort; client?: unknown }`
  - `export function getAdapter(kind: AdapterKind): ProviderAdapter`
  - `export type AiProvider = string`

- [ ] **Step 1: Read the installed AI SDK docs before writing any code**

```bash
ls node_modules/ai/ 2>/dev/null && find node_modules/ai -name "*.md" | head
```

If `ai` is not yet installed, install first (next step), then read. **Do not write AI SDK calls from memory** — confirm `generateObject`, `jsonSchema`, the provider factory names, and the shape of `result.usage` against the installed version. The code below is written against AI SDK v6 and is the intended shape, but the installed version is the authority.

- [ ] **Step 2: Add the dependencies**

```bash
pnpm add ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/openai-compatible
```

- [ ] **Step 3: Write the failing test for the generic adapter**

Create `src/lib/ai/providers/openai-compatible.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { openaiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";

/** Minimal stand-in for an AI SDK model factory, injected via `client`. */
function fakeClient(capture: { model?: string; baseUrl?: string }) {
  return {
    __baseUrl: "https://api.moonshot.ai/v1",
    generateObject: vi.fn(async (args: { model: string }) => {
      capture.model = args.model;
      capture.baseUrl = "https://api.moonshot.ai/v1";
      return {
        object: { ok: true },
        usage: { inputTokens: 11, outputTokens: 7 },
      };
    }),
  };
}

describe("openaiCompatibleAdapter", () => {
  it("sends the REQUESTED model, not a hardcoded default", async () => {
    const capture: { model?: string } = {};
    const res = await openaiCompatibleAdapter.generateStructured({
      apiKey: "sk-test",
      baseUrl: "https://api.moonshot.ai/v1",
      model: "kimi-k2",
      system: "s",
      user: "u",
      schema: { type: "object" },
      client: fakeClient(capture),
    });
    expect(capture.model).toBe("kimi-k2");
    // The reported model must be what actually ran — metering reads this.
    expect(res.model).toBe("kimi-k2");
  });

  it("reports usage from the provider response", async () => {
    const res = await openaiCompatibleAdapter.generateStructured({
      apiKey: "sk-test",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-large",
      system: "s",
      user: "u",
      schema: { type: "object" },
      client: fakeClient({}),
    });
    expect(res.usage.inputTokens).toBe(11);
    expect(res.usage.outputTokens).toBe(7);
  });

  it("refuses to run without a baseUrl", async () => {
    await expect(
      openaiCompatibleAdapter.generateStructured({
        apiKey: "sk-test",
        baseUrl: null,
        model: "kimi-k2",
        system: "s",
        user: "u",
        schema: { type: "object" },
      }),
    ).rejects.toThrow(/baseUrl/);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/providers/openai-compatible.test.ts
```

Expected: FAIL — cannot resolve `@/lib/ai/providers/openai-compatible`.

- [ ] **Step 5: Rewrite the adapter interface**

Replace the contents of `src/lib/ai/providers/types.ts`:

```ts
import type { AdapterKind } from "@/lib/ai/providers/provider-rows";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { DashboardProposal } from "@/lib/ai/proposal-schema";

/** Thrown by an adapter's validateKey when the provider rejects the key. */
export class ProviderAuthError extends Error {
  constructor(public readonly provider: string) {
    super(`Key rejected by ${provider}`);
    this.name = "ProviderAuthError";
  }
}

export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budget_tokens: number };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type GenerateArgs = {
  apiKey: string;
  /** Non-null exactly for the openai-compatible kind. */
  baseUrl: string | null;
  /**
   * The model to run. Resolved upstream by resolveModel against the catalog —
   * an adapter MUST run this and report it back, because runAi meters whatever
   * `model` it returns. Silently substituting a different model mis-bills.
   */
  model: string;
  system: string;
  user: string;
  schema: object;
  /** Anthropic-only request shape; other kinds ignore these. */
  thinking?: ThinkingConfig;
  effort?: Effort;
  client?: unknown; // DI for tests
};

/**
 * One adapter per WIRE FORMAT, not per provider.
 *
 * `supportsTools` is GONE from this interface. It was a per-adapter constant;
 * tool support is really per-MODEL (11 of Google's 17 language models support
 * tools, not all 17), and that now lives on ai_models.supports_tools.
 *
 * But note what the catalog flag does NOT buy yet: the tool-use loops in
 * app/api/ask/route.ts and lib/ai/write/actions.ts construct `new Anthropic()`
 * DIRECTLY, bypassing adapters entirely — so they cannot run on any other
 * provider no matter what the catalog says. Task 3a replaces their capability
 * checks with an explicit provider check, which is the honest description of
 * what the code can do today. Generalizing those loops is Spec 2's tool-grant
 * work, not this spec's.
 */
export interface ProviderAdapter {
  kind: AdapterKind;
  /** Resolves if the key is accepted; throws ProviderAuthError if rejected. */
  validateKey(args: { apiKey: string; baseUrl: string | null }): Promise<void>;
  /**
   * Generic structured-output call against a hand-written JSON schema. The
   * single structured-output primitive — generateProposal delegates to it.
   * `model` in the result is what ACTUALLY ran.
   */
  generateStructured<T = unknown>(
    args: GenerateArgs,
  ): Promise<{ data: T; usage: AiUsageTokens; model: string }>;
  generateProposal(args: Omit<GenerateArgs, "schema">): Promise<{
    proposal: DashboardProposal;
    usage: AiUsageTokens;
    model: string;
  }>;
}
```

- [ ] **Step 6: Widen `AiProvider` and demote the static catalog to seed data**

Replace `src/lib/ai/providers/catalog.ts`:

```ts
// Provider identity now lives in the `ai_providers` table (see provider-rows.ts).
// This module keeps only what a CLIENT component can use without a DB round
// trip, and the seed list the migration inserted.
//
// AiProvider was a three-member union; it is now `string` because the set is
// open by design — adding Kimi must not require a code change. The constraint
// still exists, it just lives in the database as a foreign key.
export type AiProvider = string;

/** The five seeded providers. Display metadata only — the DB row is authoritative. */
export const SEEDED_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "moonshotai",
] as const;
```

Delete `PROVIDER_CATALOG` and `ALL_PROVIDERS`. Every consumer moves to a `ProviderRow` passed down from a server component (Tasks 9–11).

- [ ] **Step 7: Implement the generic adapter**

Create `src/lib/ai/providers/openai-compatible.ts`:

```ts
import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject, jsonSchema } from "ai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import {
  ProviderAuthError,
  type GenerateArgs,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

/**
 * ONE adapter for every OpenAI-compatible provider. Mistral and Kimi both run
 * on it today, and every provider added later without a deploy rides it too —
 * the only thing that differs between them is `baseUrl`, which comes from the
 * ai_providers row. That is why the tests assert baseUrl is honoured.
 */

type Injected = { generateObject: typeof generateObject };

function requireBaseUrl(baseUrl: string | null): string {
  if (!baseUrl)
    throw new Error(
      "openai-compatible adapter requires a baseUrl from its ai_providers row",
    );
  return baseUrl;
}

export const openaiCompatibleAdapter: ProviderAdapter = {
  kind: "openai-compatible",

  async validateKey({ apiKey, baseUrl }) {
    const url = `${requireBaseUrl(baseUrl).replace(/\/$/, "")}/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403)
      throw new ProviderAuthError(baseUrl ?? "provider");
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
  },

  async generateStructured<T>({
    apiKey,
    baseUrl,
    model,
    system,
    user,
    schema,
    client,
  }: GenerateArgs) {
    const url = requireBaseUrl(baseUrl);
    const gen =
      (client as Injected | undefined)?.generateObject ?? generateObject;
    const provider = createOpenAICompatible({
      name: "byo",
      baseURL: url,
      apiKey,
    });
    const res = await gen({
      // `model` is the resolved catalog id — never a hardcoded default.
      model: client ? (model as never) : (provider(model) as never),
      schema: jsonSchema(schema as never),
      system,
      prompt: user,
    });
    return {
      data: res.object as T,
      // Report what actually ran; runAi meters this value.
      model,
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        cacheReadTokens: res.usage?.cachedInputTokens ?? 0,
      },
    };
  },

  async generateProposal(args) {
    const { data, usage, model } = await this.generateStructured({
      ...args,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
```

Note: when `client` is injected the fake receives the model **string** so the test can assert it; in production the provider factory is applied. If the installed AI SDK's `generateObject` signature differs, adjust here and in the test together.

- [ ] **Step 8: Run the generic-adapter test**

```bash
pnpm vitest run src/lib/ai/providers/openai-compatible.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 9: Rewrite the three native adapters**

Each keeps its own file and its own `validateKey` (the three SDKs report auth failures differently), but `generateStructured` moves to `generateObject` and **must run `args.model`**. For `src/lib/ai/providers/anthropic.ts`:

```ts
import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import { generateObject, jsonSchema } from "ai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import {
  ProviderAuthError,
  type GenerateArgs,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

type Injected = { generateObject: typeof generateObject };

export const anthropicAdapter: ProviderAdapter = {
  kind: "anthropic",

  async validateKey({ apiKey }) {
    const client = new Anthropic({ apiKey });
    try {
      await client.models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError)
        throw new ProviderAuthError("anthropic");
      throw e;
    }
  },

  async generateStructured<T>({
    apiKey,
    model,
    system,
    user,
    schema,
    thinking,
    effort,
    client,
  }: GenerateArgs) {
    const gen =
      (client as Injected | undefined)?.generateObject ?? generateObject;
    const provider = createAnthropic({ apiKey });
    const res = await gen({
      model: client ? (model as never) : (provider(model) as never),
      schema: jsonSchema(schema as never),
      system,
      prompt: user,
      providerOptions: {
        anthropic: {
          ...(thinking ? { thinking } : {}),
          // Haiku 4.5 rejects `effort` — omit the key entirely rather than
          // sending undefined, which would still serialize.
          ...(effort ? { effort } : {}),
        },
      },
    });
    return {
      data: res.object as T,
      model,
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        cacheReadTokens: res.usage?.cachedInputTokens ?? 0,
        cacheWriteTokens:
          (
            res.providerMetadata?.anthropic as {
              cacheCreationInputTokens?: number;
            }
          )?.cacheCreationInputTokens ?? 0,
      },
    };
  },

  async generateProposal(args) {
    const { data, usage, model } = await this.generateStructured({
      ...args,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
```

For `src/lib/ai/providers/openai.ts` — note the module-level `const MODEL = "gpt-4o"` is **deleted**; that constant is the bug this task removes:

```ts
import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";
import { generateObject, jsonSchema } from "ai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import {
  ProviderAuthError,
  type GenerateArgs,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

type Injected = { generateObject: typeof generateObject };

export const openaiAdapter: ProviderAdapter = {
  kind: "openai",

  async validateKey({ apiKey }) {
    const client = new OpenAI({ apiKey });
    try {
      await client.models.list();
    } catch (e) {
      if (e instanceof OpenAI.AuthenticationError)
        throw new ProviderAuthError("openai");
      throw e;
    }
  },

  async generateStructured<T>({
    apiKey,
    model,
    system,
    user,
    schema,
    client,
  }: GenerateArgs) {
    const gen =
      (client as Injected | undefined)?.generateObject ?? generateObject;
    const provider = createOpenAI({ apiKey });
    const res = await gen({
      model: client ? (model as never) : (provider(model) as never),
      schema: jsonSchema(schema as never),
      system,
      prompt: user,
    });
    return {
      data: res.object as T,
      model,
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        cacheReadTokens: res.usage?.cachedInputTokens ?? 0,
      },
    };
  },

  async generateProposal(args) {
    const { data, usage, model } = await this.generateStructured({
      ...args,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
```

For `src/lib/ai/providers/google.ts` — the module-level `const MODEL = "gemini-2.0-flash"` is likewise **deleted**, and `validateKey` keeps its deliberate catch-all (the Google SDK does not expose a typed auth error):

```ts
import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";
import { generateObject, jsonSchema } from "ai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import {
  ProviderAuthError,
  type GenerateArgs,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

type Injected = { generateObject: typeof generateObject };

export const googleAdapter: ProviderAdapter = {
  kind: "google",

  async validateKey({ apiKey }) {
    const ai = new GoogleGenAI({ apiKey });
    try {
      // Cheapest authenticated call — a bad key throws (400/403 "API key not valid").
      await ai.models.list({ config: { pageSize: 1 } });
    } catch {
      throw new ProviderAuthError("google");
    }
  },

  async generateStructured<T>({
    apiKey,
    model,
    system,
    user,
    schema,
    client,
  }: GenerateArgs) {
    const gen =
      (client as Injected | undefined)?.generateObject ?? generateObject;
    const provider = createGoogleGenerativeAI({ apiKey });
    const res = await gen({
      model: client ? (model as never) : (provider(model) as never),
      schema: jsonSchema(schema as never),
      system,
      prompt: user,
    });
    return {
      data: res.object as T,
      model,
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
        cacheReadTokens: res.usage?.cachedInputTokens ?? 0,
      },
    };
  },

  async generateProposal(args) {
    const { data, usage, model } = await this.generateStructured({
      ...args,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
```

`withSchemaObject` from `providers/prompt.ts` is no longer needed by either file — `generateObject` + `jsonSchema` handles schema enforcement natively. Leave `prompt.ts` in place if anything else imports it; `grep -rn "withSchemaObject" src` to check before deleting.

- [ ] **Step 10: Rewrite the registry to key on adapter kind**

Replace `src/lib/ai/providers/registry.ts`:

```ts
import "server-only";
import type { AdapterKind } from "@/lib/ai/providers/provider-rows";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { googleAdapter } from "@/lib/ai/providers/google";
import { openaiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";

// Keyed by WIRE FORMAT, not provider id — which is why five providers need
// only four adapters, and a sixth provider needs none.
const ADAPTERS: Record<AdapterKind, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  "openai-compatible": openaiCompatibleAdapter,
};

export function getAdapter(kind: AdapterKind): ProviderAdapter {
  return ADAPTERS[kind];
}
```

- [ ] **Step 11: Update the shared adapter test**

In `src/lib/ai/providers/adapters.test.ts`, replace every `supportsTools` / `defaultModel` / `id` / `label` / `placeholder` assertion (those properties no longer exist) with this contract test, and keep any existing behaviour tests that still apply:

```ts
import { describe, expect, it, vi } from "vitest";
import { getAdapter } from "@/lib/ai/providers/registry";
import { ADAPTER_KINDS } from "@/lib/ai/providers/provider-rows";

describe("every adapter honours the requested model", () => {
  it.each(ADAPTER_KINDS)(
    "%s runs args.model and reports it back",
    async (kind) => {
      const capture: { model?: string } = {};
      const client = {
        generateObject: vi.fn(async (a: { model: string }) => {
          capture.model = a.model;
          return { object: {}, usage: { inputTokens: 1, outputTokens: 1 } };
        }),
      };
      const res = await getAdapter(kind).generateStructured({
        apiKey: "k",
        baseUrl: kind === "openai-compatible" ? "https://example.com/v1" : null,
        model: "some-specific-model",
        system: "s",
        user: "u",
        schema: { type: "object" },
        client,
      });
      expect(capture.model).toBe("some-specific-model");
      expect(res.model).toBe("some-specific-model");
    },
  );
});
```

- [ ] **Step 12: Run the adapter tests**

```bash
pnpm vitest run src/lib/ai/providers/
```

Expected: PASS. This is the test that proves the spec's core regression is closed — no adapter can silently substitute its own model any more.

- [ ] **Step 13: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/ai/providers/
git commit -m "feat(ai): adapters on ai sdk v6, keyed by wire format

Rewrites the three native adapters over generateObject and adds one
generic openai-compatible adapter serving mistral, kimi and any provider
added later. Every adapter now runs the requested model instead of a
module-level constant, and supportsTools moves to a per-model column."
```

---

## Task 3a: Move tool-capability gating off the adapter

**Files:**

- Create: `src/lib/ai/tool-capability.ts`
- Create: `src/lib/ai/tool-capability.test.ts`
- Modify: `src/app/api/ask/route.ts`, `src/lib/ai/write/actions.ts`, `src/lib/ai/column-fill/actions.ts`, `src/lib/ai/item-assist/actions.ts`, `src/lib/ai/summarize/actions.ts`, `src/app/api/ai/personal-agent/route.ts`
- Modify: the matching `*.test.ts` files that stub `supportsTools`

**Interfaces:**

- Consumes: `ProviderNotCapableError` (existing, `src/lib/ai/errors.ts`); `ResolvedAi.provider` (Task 8 — but this task only needs the string, so it can land before Task 8 using `resolved.provider` once available, or `adapter.kind` until then).
- Produces: `export const TOOL_LOOP_PROVIDER = "anthropic"`, `export function assertToolLoopCapable(provider: string, feature: string): void`

**Why this task exists:** Task 3 deletes `supportsTools` from `ProviderAdapter`. Nine source files gate on it. They cannot simply read the catalog's per-model flag, because `app/api/ask/route.ts:208` and `lib/ai/write/actions.ts` construct `new Anthropic({ apiKey })` **directly** — those loops are hardcoded to the Anthropic SDK and cannot run on Kimi, Mistral, GPT or Gemini regardless of what any flag says. An explicit provider check is the truthful gate. The catalog's `supports_tools` column is still populated and still correct; Spec 2 consumes it when it generalizes the loops.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/tool-capability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertToolLoopCapable,
  TOOL_LOOP_PROVIDER,
} from "@/lib/ai/tool-capability";
import { ProviderNotCapableError } from "@/lib/ai/errors";

describe("assertToolLoopCapable", () => {
  it("permits anthropic", () => {
    expect(() => assertToolLoopCapable("anthropic", "ask_pulse")).not.toThrow();
  });

  it("rejects every other provider, naming the feature", () => {
    for (const p of ["openai", "google", "mistral", "moonshotai"]) {
      expect(() => assertToolLoopCapable(p, "ask_pulse")).toThrow(
        ProviderNotCapableError,
      );
    }
  });

  it("names the single capable provider as a constant, not a literal", () => {
    // The loops construct `new Anthropic()` directly; when Spec 2 generalizes
    // them this constant is the one place that changes.
    expect(TOOL_LOOP_PROVIDER).toBe("anthropic");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/ai/tool-capability.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/tool-capability`.

- [ ] **Step 3: Implement the gate**

Create `src/lib/ai/tool-capability.ts`:

```ts
import { ProviderNotCapableError } from "@/lib/ai/errors";

/**
 * The ONLY provider whose tool-use loops are implemented.
 *
 * This is deliberately a provider check and not a read of
 * `ai_models.supports_tools`. The catalog flag is accurate — most models on
 * every provider support tool calling — but the loops in
 * `app/api/ask/route.ts` and `lib/ai/write/actions.ts` construct
 * `new Anthropic({ apiKey })` directly rather than going through an adapter,
 * so they physically cannot run anywhere else. Gating on the catalog flag
 * would advertise a capability the code does not have and fail at the API
 * call instead of at the boundary.
 *
 * Spec 2 generalizes those loops onto the AI SDK's provider-agnostic tool
 * calling; at that point this module is replaced by a per-model catalog read
 * and this constant is the single place that changes.
 */
export const TOOL_LOOP_PROVIDER = "anthropic";

export function assertToolLoopCapable(provider: string, feature: string): void {
  if (provider !== TOOL_LOOP_PROVIDER)
    throw new ProviderNotCapableError(feature);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/lib/ai/tool-capability.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Replace every call site**

Find them all first:

```bash
grep -rn "supportsTools" --include="*.ts" --include="*.tsx" src
```

In each **source** file, replace the adapter check with the provider check. For example, in `src/app/api/ask/route.ts` (around line 206):

```ts
// before
async ({ apiKey, adapter }) => {
  if (!adapter.supportsTools)
    throw new ProviderNotCapableError("ask_pulse");

// after
async ({ apiKey, provider }) => {
  assertToolLoopCapable(provider, "ask_pulse");
```

Apply the same substitution in `write/actions.ts` (`"conversational_action"`), `column-fill/actions.ts`, `item-assist/actions.ts`, `summarize/actions.ts` and `personal-agent/route.ts`, each keeping the feature string it already passes. Add `import { assertToolLoopCapable } from "@/lib/ai/tool-capability";` and drop the now-unused `ProviderNotCapableError` import where nothing else uses it.

**`provider` is already on `ResolvedAi`** (it is in the type today), so no new plumbing is needed.

- [ ] **Step 6: Update the tests that stub `supportsTools`**

In each `*.test.ts` that builds a fake resolved-AI object, delete `supportsTools: true/false` from the adapter stub and set `provider: "anthropic"` (or another provider id for the negative cases) on the resolved object instead. Run:

```bash
grep -rln "supportsTools" --include="*.test.ts" src
```

Expected after the edit: that command returns nothing.

- [ ] **Step 7: Verify nothing references the removed property**

```bash
grep -rn "supportsTools" --include="*.ts" --include="*.tsx" src && echo "STILL PRESENT — fix before committing" || echo "clean"
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `clean`, then all three gates pass. This task exists to keep the tree green between Tasks 3 and 8 — a red typecheck here means it is not done.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/tool-capability.ts src/lib/ai/tool-capability.test.ts \
        src/app/api/ask/route.ts src/lib/ai/write/actions.ts \
        src/lib/ai/column-fill/actions.ts src/lib/ai/item-assist/actions.ts \
        src/lib/ai/summarize/actions.ts src/app/api/ai/personal-agent/route.ts
git add -u src
git commit -m "refactor(ai): gate tool loops on provider, not an adapter flag

The ask and write tool loops construct new Anthropic() directly, so they
cannot run on any other provider whatever a capability flag claims. Gates
on the provider id instead, which is what the code can actually do. The
per-model supports_tools column stays populated for spec 2, which
generalizes the loops onto provider-agnostic tool calling."
```

---

## Task 4: Catalog refresh endpoint

**Files:**

- Create: `src/lib/ai/models/catalog-db.ts`
- Create: `src/lib/ai/models/refresh.ts`
- Create: `src/lib/ai/models/refresh.test.ts`
- Create: `src/app/api/ai/models/refresh/route.ts`

**Interfaces:**

- Consumes: `parseFeed`, `CatalogRow` (Task 2); `listEnabledProviders` (Task 1).
- Produces: `export async function refreshCatalog(deps: { fetchFeed: () => Promise<unknown>; client: SupabaseClient<Database> }): Promise<{ upserted: number; retired: number; skipped: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/models/refresh.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { refreshCatalog } from "@/lib/ai/models/refresh";

/** In-memory stand-in for the two tables refreshCatalog touches. */
function fakeClient(existing: string[]) {
  const state = { upserted: [] as unknown[], retiredIds: [] as string[] };
  const client = {
    from(table: string) {
      if (table === "ai_providers")
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    id: "anthropic",
                    label: "Anthropic",
                    adapter_kind: "anthropic",
                    base_url: null,
                    key_placeholder: "sk-ant-…",
                    key_format: "^sk-ant-",
                    enabled: true,
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      return {
        upsert: async (rows: unknown[]) => {
          state.upserted.push(...rows);
          return { error: null };
        },
        update: () => ({
          lt: () => ({
            eq: async () => {
              state.retiredIds.push(...existing);
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { client, state };
}

const FEED = {
  data: [
    {
      id: "anthropic/claude-sonnet-5",
      owned_by: "anthropic",
      name: "Claude Sonnet 5",
      type: "language",
      tags: ["tool-use"],
      context_window: 1000000,
      max_tokens: 64000,
      pricing: { input: "0.000003", output: "0.000015" },
    },
  ],
};

describe("refreshCatalog", () => {
  it("upserts parsed rows and retires anything not seen", async () => {
    const { client, state } = fakeClient(["stale-model"]);
    const res = await refreshCatalog({
      fetchFeed: async () => FEED,
      client: client as never,
    });
    expect(res.skipped).toBe(false);
    expect(res.upserted).toBe(1);
    expect(state.upserted).toHaveLength(1);
  });

  it("SKIPS everything when the feed is empty — a gateway outage must not retire the catalog", async () => {
    const { client, state } = fakeClient(["claude-sonnet-5"]);
    const res = await refreshCatalog({
      fetchFeed: async () => ({ data: [] }),
      client: client as never,
    });
    expect(res.skipped).toBe(true);
    expect(res.retired).toBe(0);
    expect(state.retiredIds).toEqual([]);
    expect(state.upserted).toEqual([]);
  });

  it("SKIPS when the fetch throws rather than propagating", async () => {
    const { client, state } = fakeClient(["claude-sonnet-5"]);
    const res = await refreshCatalog({
      fetchFeed: async () => {
        throw new Error("gateway 503");
      },
      client: client as never,
    });
    expect(res.skipped).toBe(true);
    expect(state.upserted).toEqual([]);
  });

  it("SKIPS when the payload is malformed", async () => {
    const { client } = fakeClient([]);
    const res = await refreshCatalog({
      fetchFeed: async () => ({ unexpected: true }),
      client: client as never,
    });
    expect(res.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/models/refresh.test.ts
```

Expected: FAIL — cannot resolve `@/lib/ai/models/refresh`.

- [ ] **Step 3: Implement the catalog access seam**

Create `src/lib/ai/models/catalog-db.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ModelTier } from "@/lib/ai/models/feed-parse";

/** Access seam for `ai_models`. Row shapes live here and only here. */

export type ModelRow = {
  provider: string;
  modelId: string;
  label: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean;
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  cacheReadPricePerMtok: number | null;
  cacheWritePricePerMtok: number | null;
  tier: ModelTier;
  status: "active" | "retired" | "needs_pricing";
};

const MODEL_COLS =
  "provider, model_id, label, context_length, max_output_tokens, supports_tools, input_price_per_mtok, output_price_per_mtok, cache_read_price_per_mtok, cache_write_price_per_mtok, tier, status";

type RawModelRow = {
  provider: string;
  model_id: string;
  label: string;
  context_length: number | null;
  max_output_tokens: number | null;
  supports_tools: boolean;
  input_price_per_mtok: number | string | null;
  output_price_per_mtok: number | string | null;
  cache_read_price_per_mtok: number | string | null;
  cache_write_price_per_mtok: number | string | null;
  tier: string;
  status: string;
};

/** Postgres `numeric` arrives as a string over PostgREST. */
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toModelRow(raw: RawModelRow): ModelRow {
  return {
    provider: raw.provider,
    modelId: raw.model_id,
    label: raw.label,
    contextLength: raw.context_length,
    maxOutputTokens: raw.max_output_tokens,
    supportsTools: raw.supports_tools,
    inputPricePerMtok: num(raw.input_price_per_mtok),
    outputPricePerMtok: num(raw.output_price_per_mtok),
    cacheReadPricePerMtok: num(raw.cache_read_price_per_mtok),
    cacheWritePricePerMtok: num(raw.cache_write_price_per_mtok),
    tier: raw.tier as ModelTier,
    status: raw.status as ModelRow["status"],
  };
}

/**
 * Active models for one provider, cheapest input rate first. `.eq("status",…)`
 * plus `.eq("provider",…)` is exactly `ai_models_status_provider_idx`, so this
 * stays an index scan (working agreement #5).
 */
export async function listActiveModels(
  client: SupabaseClient<Database>,
  provider: string,
): Promise<ModelRow[]> {
  const { data, error } = await client
    .from("ai_models")
    .select(MODEL_COLS)
    .eq("status", "active")
    .eq("provider", provider)
    .order("input_price_per_mtok", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listActiveModels: ${error.message}`);
  return (data ?? []).map((r) => toModelRow(r as RawModelRow));
}

/** One model by its composite key, whatever its status (callers check). */
export async function getModel(
  client: SupabaseClient<Database>,
  provider: string,
  modelId: string,
): Promise<ModelRow | null> {
  const { data, error } = await client
    .from("ai_models")
    .select(MODEL_COLS)
    .eq("provider", provider)
    .eq("model_id", modelId)
    .maybeSingle();
  if (error) throw new Error(`getModel: ${error.message}`);
  return data ? toModelRow(data as RawModelRow) : null;
}
```

- [ ] **Step 4: Implement the refresh**

Create `src/lib/ai/models/refresh.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { parseFeed } from "@/lib/ai/models/feed-parse";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";

export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

export async function fetchGatewayFeed(): Promise<unknown> {
  const res = await fetch(GATEWAY_MODELS_URL, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`gateway models feed returned ${res.status}`);
  return res.json();
}

/**
 * Refresh the model catalog from the Gateway feed.
 *
 * The retirement guard is the load-bearing part: retirement runs ONLY when the
 * fetch returned a plausible non-empty parse. A Gateway outage that returns
 * `[]`, a 503, or a malformed body must leave the catalog exactly as it was —
 * mass-retiring on a bad fetch would empty every model picker in the product
 * and orphan every pinned agent at once.
 *
 * Rows are never deleted: user_agents references model ids, so a delete turns a
 * pinned reference into a dangling one instead of a clean `retired` state.
 */
export async function refreshCatalog(deps: {
  fetchFeed: () => Promise<unknown>;
  client: SupabaseClient<Database>;
}): Promise<{ upserted: number; retired: number; skipped: boolean }> {
  const providers = await listEnabledProviders(deps.client);
  const enabledIds = providers.map((p) => p.id);

  let raw: unknown;
  try {
    raw = await deps.fetchFeed();
  } catch (e) {
    console.error("[ai] model catalog refresh: feed fetch failed", e);
    return { upserted: 0, retired: 0, skipped: true };
  }

  const rows = parseFeed(raw, enabledIds);
  if (rows.length === 0) {
    console.error(
      "[ai] model catalog refresh: feed parsed to zero rows — skipping upsert and retirement",
    );
    return { upserted: 0, retired: 0, skipped: true };
  }

  const seenAt = new Date().toISOString();
  const { error: upsertErr } = await deps.client.from("ai_models").upsert(
    rows.map((r) => ({ ...r, last_seen_at: seenAt })),
    { onConflict: "provider,model_id" },
  );
  if (upsertErr) throw new Error(`refreshCatalog upsert: ${upsertErr.message}`);

  // Anything we did not see this run is retired, never deleted.
  const { error: retireErr } = await deps.client
    .from("ai_models")
    .update({ status: "retired" })
    .lt("last_seen_at", seenAt)
    .eq("status", "active");
  if (retireErr) throw new Error(`refreshCatalog retire: ${retireErr.message}`);

  return { upserted: rows.length, retired: 0, skipped: false };
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm vitest run src/lib/ai/models/refresh.test.ts
```

Expected: PASS (4 tests). The three skip cases are the guard; if any of them retires or upserts, the guard is broken.

- [ ] **Step 6: Implement the HMAC endpoint**

Create `src/app/api/ai/models/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { verifyBody } from "@/lib/ai/agentic/hmac";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchGatewayFeed, refreshCatalog } from "@/lib/ai/models/refresh";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). The service client + node:crypto HMAC need Node APIs.
//
// The in-DB `ai-models-refresh` cron signs its body with the shared Vault
// secret; we verify the SAME secret here. This HMAC is the only thing between
// an attacker and a service-role write to the catalog that prices every AI
// call in the product — an unsigned body is rejected before any work.
const SIGNATURE_HEADER = "x-pulse-signature";

export async function POST(req: Request) {
  const secret = getServerEnv().AI_PGNET_HMAC_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "model refresh not provisioned" },
      { status: 503 },
    );

  const raw = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER) ?? "";
  if (!verifyBody(raw, sig, secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await refreshCatalog({
    fetchFeed: fetchGatewayFeed,
    client: createServiceClient(),
  });
  return NextResponse.json(result);
}
```

- [ ] **Step 7: Verify the endpoint end to end against DEV**

```bash
pnpm build && pnpm dev &
sleep 8
BODY='{"mode":"refresh"}'
SIG=$(node -e "console.log(require('crypto').createHmac('sha256', process.env.AI_PGNET_HMAC_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")
curl -s -X POST http://localhost:3000/api/ai/models/refresh \
  -H "Content-Type: application/json" -H "X-Pulse-Signature: $SIG" -d "$BODY"
```

Expected: `{"upserted":<~95>,"retired":0,"skipped":false}`. Then confirm via the `supabase-dev` MCP:

```sql
select provider, count(*) from public.ai_models
 where status = 'active' group by provider order by provider;
```

Expected: rows for all five providers, roughly 41 openai / 17 google / 15 anthropic / 14 mistral / 8 moonshotai. Also verify an unsigned request is rejected:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/api/ai/models/refresh \
  -H "Content-Type: application/json" -d "$BODY"
```

Expected: `401`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/models/catalog-db.ts src/lib/ai/models/refresh.ts \
        src/lib/ai/models/refresh.test.ts \
        src/app/api/ai/models/refresh/route.ts
git commit -m "feat(ai): daily model catalog refresh from the gateway feed

HMAC-verified endpoint driven by the ai-models-refresh cron. Retirement
runs only on a plausible non-empty parse, so a gateway outage leaves the
catalog untouched rather than emptying every model picker."
```

---

## Task 5: Per-provider credentials

**Files:**

- Modify: `src/lib/ai/credentials.ts`
- Modify: `src/lib/ai/credentials-actions.ts`
- Modify: `src/lib/ai/credentials.test.ts` (create if absent)
- Modify: `src/lib/ai/user-ai-credentials.rls.integration.test.ts`

**Interfaces:**

- Consumes: `getProviderRow` (Task 1), `getAdapter` (Task 3).
- Produces:
  - `export async function resolveUserAdapterById(userId: TrustedUserId, provider: string): Promise<{ adapter: ProviderAdapter; apiKey: string; baseUrl: string | null }>`
  - `export async function listMyAiCredentials(): Promise<{ provider: string; hint: string; updatedAt: string }[]>`
  - `export async function saveAiKey(input: { provider: string; key: string }): Promise<ActionResult<{ provider: string; hint: string }>>`
  - `export async function removeAiKey(input: { provider: string }): Promise<ActionResult<Record<never, never>>>`

- [ ] **Step 1: Write the failing test for multi-key listing**

Create/extend `src/lib/ai/credentials.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { maskKey } from "@/lib/ai/credentials";

describe("maskKey", () => {
  it("keeps a head and the last four, never the middle", () => {
    expect(maskKey("sk-ant-api03-ABCDEFGHIJKLMNOP1234")).toBe("sk-ant-…1234");
  });

  it("handles a short key without throwing", () => {
    expect(maskKey("sk-1234")).toBe("sk-…1234");
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm vitest run src/lib/ai/credentials.test.ts
```

Expected: PASS (maskKey is unchanged) — this is the regression guard for the file you are about to edit. If it fails, `maskKey` drifted; fix that first.

- [ ] **Step 3: Update `credentials.ts`**

In `src/lib/ai/credentials.ts`, replace `resolveUserAdapterById` and `getMyAiCredential`:

```ts
/**
 * Session-less resolver for service-role/cron callers. Now takes the PROVIDER
 * as well as the user: an agent pinned to Kimi must resolve the user's Kimi
 * key, not whichever key happens to be first. The TrustedUserId contract is
 * unchanged — see the type's doc comment for what establishes trust.
 */
export async function resolveUserAdapterById(
  userId: TrustedUserId,
  provider: string,
): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
  baseUrl: string | null;
}> {
  const svc = createServiceClient();
  const [{ data, error }, row] = await Promise.all([
    svc.rpc("ai_credential_get", { p_user: userId, p_provider: provider }),
    getProviderRow(svc, provider),
  ]);
  if (error) throw error;
  if (!row || !row.enabled) throw new PersonalAiKeyMissingError();
  const secret = data?.[0];
  if (!secret) throw new PersonalAiKeyMissingError();
  return {
    adapter: getAdapter(row.adapterKind),
    apiKey: secret.secret,
    baseUrl: row.baseUrl,
  };
}

/** RLS self-read for the settings page: ALL of the user's keys, one per provider. */
export async function listMyAiCredentials(): Promise<
  { provider: string; hint: string; updatedAt: string }[]
> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_ai_credentials")
    .select("provider, key_hint, updated_at")
    .eq("user_id", user.id)
    .order("provider");
  return (data ?? []).map((r) => ({
    provider: r.provider,
    hint: r.key_hint,
    updatedAt: r.updated_at,
  }));
}
```

Add the import: `import { getProviderRow } from "@/lib/ai/providers/provider-rows";`. Delete the old single-row `getMyAiCredential`.

- [ ] **Step 4: Update the server actions**

Replace the body of `src/lib/ai/credentials-actions.ts`:

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdapter } from "@/lib/ai/providers/registry";
import { getProviderRow } from "@/lib/ai/providers/provider-rows";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import { maskKey } from "@/lib/ai/credentials";
import { fail, type ActionResult } from "@/lib/actions/result";

// The provider is validated against the ai_providers table, not a hardcoded
// enum — that table is the constraint now, so a provider added by a DB row is
// immediately usable here with no code change.
const saveSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  key: z.string().trim().min(10).max(300),
});

export async function saveAiKey(input: {
  provider: string;
  key: string;
}): Promise<ActionResult<{ provider: string; hint: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid API key.");
  const { provider, key } = parsed.data;

  const user = await requireUser();
  const svc = createServiceClient();
  const row = await getProviderRow(svc, provider);
  if (!row || !row.enabled) return fail("Unknown provider.");

  // Cheap shape check from the row's regex, before the live network ping.
  if (!new RegExp(row.keyFormat).test(key))
    return fail(`That doesn't look like a ${row.label} key.`);

  const adapter = getAdapter(row.adapterKind);
  try {
    await adapter.validateKey({ apiKey: key, baseUrl: row.baseUrl });
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(`That key was rejected by ${row.label}.`);
    return fail("Couldn't verify the key. Please try again.");
  }

  const hint = maskKey(key);
  const { error } = await svc.rpc("ai_credential_set", {
    p_user: user.id,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");

  revalidatePath("/settings/ai");
  return { ok: true, data: { provider, hint } };
}

export async function removeAiKey(input: {
  provider: string;
}): Promise<ActionResult<Record<never, never>>> {
  const parsed = z
    .object({ provider: z.string().trim().min(1).max(64) })
    .safeParse(input);
  if (!parsed.success) return fail("Unknown provider.");
  const user = await requireUser();
  const svc = createServiceClient();
  // Deletes ONLY this provider's key; other providers' keys survive.
  const { error } = await svc.rpc("ai_credential_delete", {
    p_user: user.id,
    p_provider: parsed.data.provider,
  });
  if (error) return fail("Couldn't remove the key. Please try again.");
  revalidatePath("/settings/ai");
  return { ok: true, data: {} };
}
```

- [ ] **Step 5: Add the multi-key isolation integration test**

Append to `src/lib/ai/user-ai-credentials.rls.integration.test.ts`, inside the existing `describe`:

```ts
it("keeps one key PER PROVIDER — saving a second does not clear the first", async () => {
  const svc = admin;
  await svc.rpc("ai_credential_set", {
    p_user: userA.id,
    p_provider: "anthropic",
    p_secret: "sk-ant-test-key-aaaa",
    p_hint: "sk-ant-…aaaa",
  });
  await svc.rpc("ai_credential_set", {
    p_user: userA.id,
    p_provider: "moonshotai",
    p_secret: "sk-kimi-test-key-bbbb",
    p_hint: "sk-kimi…bbbb",
  });

  const { data } = await svc
    .from("user_ai_credentials")
    .select("provider")
    .eq("user_id", userA.id);
  expect((data ?? []).map((r) => r.provider).sort()).toEqual([
    "anthropic",
    "moonshotai",
  ]);
});

it("deletes only the named provider's key", async () => {
  await admin.rpc("ai_credential_delete", {
    p_user: userA.id,
    p_provider: "moonshotai",
  });
  const { data } = await admin
    .from("user_ai_credentials")
    .select("provider")
    .eq("user_id", userA.id);
  expect((data ?? []).map((r) => r.provider)).toEqual(["anthropic"]);
});

it("resolves a specific provider's secret, not an arbitrary one", async () => {
  const { data } = await admin.rpc("ai_credential_get", {
    p_user: userA.id,
    p_provider: "anthropic",
  });
  expect(data?.[0]?.provider).toBe("anthropic");

  const { data: none } = await admin.rpc("ai_credential_get", {
    p_user: userA.id,
    p_provider: "moonshotai",
  });
  expect(none ?? []).toHaveLength(0);
});
```

- [ ] **Step 6: Run the tests**

```bash
pnpm vitest run src/lib/ai/credentials.test.ts
PULSE_TEST_DB=1 pnpm vitest run src/lib/ai/user-ai-credentials.rls.integration.test.ts
```

Expected: both PASS. The first new test is the one that proves the spec's limit #1 is gone.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/credentials.ts src/lib/ai/credentials-actions.ts \
        src/lib/ai/credentials.test.ts \
        src/lib/ai/user-ai-credentials.rls.integration.test.ts
git commit -m "feat(ai): one byo key per provider

saveAiKey/removeAiKey take a provider and touch only that provider's row;
resolveUserAdapterById resolves the requested provider's key and its
base_url. Provider validity now comes from the ai_providers table."
```

---

## Task 6: Catalog-backed pricing

**Files:**

- Modify: `src/lib/ai/pricing.ts`
- Modify: `src/lib/ai/pricing.test.ts`

**Interfaces:**

- Consumes: `ModelRow` (Task 4) — but only structurally, via a narrow `ModelRates` type so pricing stays free of DB imports.
- Produces:
  - `export type ModelRates = { input: number; output: number; cacheRead: number | null; cacheWrite: number | null }`
  - `export function computeCostUsd(rates: ModelRates | null, usage: AiUsageTokens): number`
  - `export const FALLBACK_RATES: Readonly<Record<string, ModelRates>>` (the old `MODEL_PRICES_PER_MTOK`, kept as the floor)
  - `export function ratesForModel(model: string): ModelRates | null`

- [ ] **Step 1: Write the failing test**

Replace the pricing arithmetic tests in `src/lib/ai/pricing.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  computeCostUsd,
  costToCredits,
  ratesForModel,
  type ModelRates,
} from "@/lib/ai/pricing";

const SONNET: ModelRates = {
  input: 3,
  output: 15,
  cacheRead: null,
  cacheWrite: null,
};

describe("computeCostUsd", () => {
  it("bills input and output at the supplied rates", () => {
    expect(
      computeCostUsd(SONNET, { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeCloseTo(3, 9);
    expect(
      computeCostUsd(SONNET, { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBeCloseTo(15, 9);
  });

  it("falls back to the Anthropic multipliers when a provider publishes no cache rate", () => {
    // 0.1x input for reads, 1.25x for writes — preserves today's billing
    // exactly for any model whose feed entry omits cache pricing.
    expect(
      computeCostUsd(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.3, 9);
    expect(
      computeCostUsd(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(3.75, 9);
  });

  it("prefers an explicit cache rate over the multiplier", () => {
    const explicit: ModelRates = {
      input: 3,
      output: 15,
      cacheRead: 0.5,
      cacheWrite: 6,
    };
    expect(
      computeCostUsd(explicit, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.5, 9);
  });

  it("costs 0 for null rates but does not throw", () => {
    expect(
      computeCostUsd(null, { inputTokens: 1000, outputTokens: 1000 }),
    ).toBe(0);
  });
});

describe("ratesForModel", () => {
  it("serves the seeded floor for a known model", () => {
    expect(ratesForModel("claude-sonnet-5")).toEqual({
      input: 3,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
    });
  });

  it("returns null for an unknown model", () => {
    expect(ratesForModel("kimi-k2")).toBeNull();
  });
});

describe("costToCredits", () => {
  it("converts 1 USD to 100 credits", () => {
    expect(costToCredits(1)).toBe(100);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/pricing.test.ts
```

Expected: FAIL — `ratesForModel` is not exported and `computeCostUsd` still takes a model string.

- [ ] **Step 3: Rewrite pricing**

In `src/lib/ai/pricing.ts`, keep `AiUsageTokens` and `costToCredits` unchanged, and replace the rest:

```ts
/**
 * Anthropic-wide cache multipliers. Retained as the FALLBACK for any model
 * whose catalog row carries no explicit cache rate (Mistral publishes none).
 * Falling back to the multiplier rather than to zero means a provider that
 * returns cache tokens without publishing a cache price is still billed at
 * today's rates instead of silently free.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export type ModelRates = {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
};

/**
 * The seeded price floor, formerly MODEL_PRICES_PER_MTOK and formerly the sole
 * source of truth. The `ai_models` catalog is authoritative now; this survives
 * so a catalog read that finds nothing still bills a known model correctly.
 */
export const FALLBACK_RATES: Readonly<Record<string, ModelRates>> = {
  "claude-opus-4-8": {
    input: 5,
    output: 25,
    cacheRead: null,
    cacheWrite: null,
  },
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    cacheRead: null,
    cacheWrite: null,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheRead: null,
    cacheWrite: null,
  },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: null, cacheWrite: null },
  "gemini-2.0-flash": {
    input: 0.1,
    output: 0.4,
    cacheRead: null,
    cacheWrite: null,
  },
  // Fixed platform embedding model (E5 · F15). Input-only.
  "text-embedding-3-small": {
    input: 0.02,
    output: 0,
    cacheRead: null,
    cacheWrite: null,
  },
};

export const PRICED_MODELS = Object.keys(FALLBACK_RATES);

export function ratesForModel(model: string): ModelRates | null {
  return FALLBACK_RATES[model] ?? null;
}

/**
 * Cost in USD for one call, from rates supplied by the caller (which reads the
 * catalog). Deliberately PURE and SYNCHRONOUS: making it async to read the
 * catalog itself would ripple into every metering call site.
 *
 * Null rates cost 0 — tokens are still logged. This is now only reachable for
 * a model missing from BOTH the catalog and the fallback floor, which the
 * needs_pricing quarantine is designed to prevent.
 */
export function computeCostUsd(
  rates: ModelRates | null,
  usage: AiUsageTokens,
): number {
  if (!rates) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const readRate = rates.cacheRead ?? rates.input * CACHE_READ_MULTIPLIER;
  const writeRate = rates.cacheWrite ?? rates.input * CACHE_WRITE_MULTIPLIER;
  return (
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      cacheRead * readRate +
      cacheWrite * writeRate) /
    1_000_000
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm vitest run src/lib/ai/pricing.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/pricing.ts src/lib/ai/pricing.test.ts
git commit -m "refactor(ai): computeCostUsd takes rates instead of a model id

Prices now come from the ai_models catalog; the old map survives as the
fallback floor. A model with no explicit cache rate falls back to the
anthropic multipliers rather than to zero, so cache tokens are never
silently free. The function stays pure and synchronous."
```

---

## Task 7: `resolveModel` and the tier map

**Files:**

- Create: `src/lib/ai/models/resolve.ts`
- Create: `src/lib/ai/models/resolve.test.ts`
- Modify: `src/lib/ai/model-map.ts`
- Modify: `src/lib/ai/model-map.test.ts`
- Modify: `src/lib/ai/org-settings.ts`

**Interfaces:**

- Consumes: `listActiveModels`, `getModel`, `ModelRow` (Task 4); `ratesForModel`, `ModelRates` (Task 6).
- Produces:
  - `export type ResolvedModel = { model: string | null; provider: string; rates: ModelRates | null; supportsTools: boolean; substituted: boolean }` — `model` is null only when the provider has **no** active catalog models at all; callers must handle it (Task 11 throws `ByoKeyMissingError`).
  - `export function pickModel(args: { active: ModelRow[]; requested: string | null; orgDefaultModelId: string | null; tier: ModelTier }): Omit<ResolvedModel, "provider">` — the pure decision matrix, split out so it is testable without a database.
  - `export async function resolveModel(args: { client: SupabaseClient<Database>; provider: string; feature: string; requested?: string | null; orgDefaultModelId?: string | null }): Promise<ResolvedModel>`
  - `export function tierForFeature(feature: string): ModelTier`
  - `OrgAiSettings` gains `defaultProvider: string | null; defaultModelId: string | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/models/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickModel } from "@/lib/ai/models/resolve";
import type { ModelRow } from "@/lib/ai/models/catalog-db";

function row(over: Partial<ModelRow>): ModelRow {
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    label: "Sonnet 5",
    contextLength: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    inputPricePerMtok: 3,
    outputPricePerMtok: 15,
    cacheReadPricePerMtok: null,
    cacheWritePricePerMtok: null,
    tier: "standard",
    status: "active",
    ...over,
  };
}

const CATALOG = [
  row({ modelId: "claude-haiku-4-5", tier: "cheap", inputPricePerMtok: 1 }),
  row({ modelId: "claude-sonnet-5", tier: "standard", inputPricePerMtok: 3 }),
  row({ modelId: "claude-opus-4-8", tier: "strong", inputPricePerMtok: 5 }),
];

describe("pickModel", () => {
  it("uses the pinned model when it is active", () => {
    const r = pickModel({
      active: CATALOG,
      requested: "claude-opus-4-8",
      orgDefaultModelId: "claude-sonnet-5",
      tier: "standard",
    });
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.substituted).toBe(false);
  });

  it("substitutes the org default when the pinned model is gone, and FLAGS it", () => {
    const r = pickModel({
      active: CATALOG,
      requested: "claude-retired-9",
      orgDefaultModelId: "claude-sonnet-5",
      tier: "standard",
    });
    expect(r.model).toBe("claude-sonnet-5");
    // The run must still produce output — a retirement you did not notice must
    // not silently stop a scheduled agent.
    expect(r.substituted).toBe(true);
  });

  it("uses the org default when nothing is pinned", () => {
    const r = pickModel({
      active: CATALOG,
      requested: null,
      orgDefaultModelId: "claude-sonnet-5",
      tier: "cheap",
    });
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.substituted).toBe(false);
  });

  it("falls back to the cheapest model of the requested tier when no default is set", () => {
    const r = pickModel({
      active: CATALOG,
      requested: null,
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.model).toBe("claude-haiku-4-5");
  });

  it("falls back to the overall cheapest when the tier has no members", () => {
    const r = pickModel({
      active: [
        row({ modelId: "only-one", tier: "strong", inputPricePerMtok: 9 }),
      ],
      requested: null,
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.model).toBe("only-one");
  });

  it("returns null when the provider has no active models at all", () => {
    const r = pickModel({
      active: [],
      requested: "anything",
      orgDefaultModelId: "also-anything",
      tier: "cheap",
    });
    expect(r.model).toBeNull();
  });

  it("carries rates and tool support from the chosen row", () => {
    const r = pickModel({
      active: CATALOG,
      requested: "claude-haiku-4-5",
      orgDefaultModelId: null,
      tier: "cheap",
    });
    expect(r.rates).toEqual({
      input: 1,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
    });
    expect(r.supportsTools).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/models/resolve.test.ts
```

Expected: FAIL — cannot resolve `@/lib/ai/models/resolve`.

- [ ] **Step 3: Implement resolution**

Create `src/lib/ai/models/resolve.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ModelTier } from "@/lib/ai/models/feed-parse";
import type { ModelRates } from "@/lib/ai/pricing";
import { listActiveModels, type ModelRow } from "@/lib/ai/models/catalog-db";
import { tierForFeature } from "@/lib/ai/model-map";

export type ResolvedModel = {
  model: string | null;
  provider: string;
  rates: ModelRates | null;
  supportsTools: boolean;
  /** True when a pinned model was unavailable and the default was used. */
  substituted: boolean;
};

function ratesOf(row: ModelRow): ModelRates | null {
  if (row.inputPricePerMtok === null || row.outputPricePerMtok === null)
    return null;
  return {
    input: row.inputPricePerMtok,
    output: row.outputPricePerMtok,
    cacheRead: row.cacheReadPricePerMtok,
    cacheWrite: row.cacheWritePricePerMtok,
  };
}

/**
 * PURE selection step, split out from the DB read so the whole decision matrix
 * is testable without a database. `active` is already filtered to status
 * 'active' for one provider and ordered cheapest input rate first.
 */
export function pickModel(args: {
  active: ModelRow[];
  requested: string | null;
  orgDefaultModelId: string | null;
  tier: ModelTier;
}): Omit<ResolvedModel, "provider"> {
  const { active, requested, orgDefaultModelId, tier } = args;
  const byId = (id: string | null) =>
    id ? (active.find((m) => m.modelId === id) ?? null) : null;

  const pinned = byId(requested);
  if (pinned)
    return {
      model: pinned.modelId,
      rates: ratesOf(pinned),
      supportsTools: pinned.supportsTools,
      substituted: false,
    };

  // A pinned-but-missing model is a SUBSTITUTION (the agent gets flagged); a
  // model that was never pinned is just the ordinary default path.
  const substituted = requested !== null && requested !== "";

  const chosen =
    byId(orgDefaultModelId) ??
    active.find((m) => m.tier === tier) ??
    active[0] ??
    null;

  if (!chosen)
    return { model: null, rates: null, supportsTools: false, substituted };

  return {
    model: chosen.modelId,
    rates: ratesOf(chosen),
    supportsTools: chosen.supportsTools,
    substituted,
  };
}

/** Read the provider's active catalog, then apply {@link pickModel}. */
export async function resolveModel(args: {
  client: SupabaseClient<Database>;
  provider: string;
  feature: string;
  requested?: string | null;
  orgDefaultModelId?: string | null;
}): Promise<ResolvedModel> {
  const active = await listActiveModels(args.client, args.provider);
  const picked = pickModel({
    active,
    requested: args.requested ?? null,
    orgDefaultModelId: args.orgDefaultModelId ?? null,
    tier: tierForFeature(args.feature),
  });
  return { ...picked, provider: args.provider };
}

export { tierForFeature };
```

- [ ] **Step 4: Convert `model-map.ts` to a tier map**

Replace `src/lib/ai/model-map.ts`:

```ts
import type { ModelTier } from "@/lib/ai/models/feed-parse";

/**
 * Per-feature model TIER hint. This file used to emit concrete model ids —
 * `claude-sonnet-5` for all 13 features — which was harmless only because the
 * OpenAI and Google adapters discarded the requested model. Now that every
 * adapter honours it, emitting a Claude id would 400 every feature in an
 * OpenAI-keyed org. So the map emits an abstract tier, and resolveModel turns
 * that into a concrete model from the chosen provider's catalog.
 */

/** Anything unmapped: the conservative middle. */
export const DEFAULT_TIER: ModelTier = "standard";

const FEATURE_TIERS = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ModelTier>, {
    // Tool-use loops — quality-sensitive.
    ask_pulse: "standard",
    conversational_action: "standard",
    automation_ai_step: "standard",
    autopilot_run: "standard",
    // Structured generation — moderate difficulty.
    dashboard_gen: "standard",
    board_gen: "standard",
    automation_gen: "standard",
    import_mapping: "standard",
    report_narrative: "standard",
    thread_summary: "standard",
    personal_agent_run: "standard",
    // Short classification / rewrite — high volume, low difficulty.
    item_assist: "cheap",
    column_fill: "cheap",
  } satisfies Record<string, ModelTier>),
);

export const AI_FEATURES = Object.keys(FEATURE_TIERS);

export function tierForFeature(feature: string): ModelTier {
  return FEATURE_TIERS[feature] ?? DEFAULT_TIER;
}
```

- [ ] **Step 5: Rewrite the model-map test**

Replace `src/lib/ai/model-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AI_FEATURES, DEFAULT_TIER, tierForFeature } from "@/lib/ai/model-map";

describe("tierForFeature", () => {
  it("routes high-volume features to the cheap tier", () => {
    expect(tierForFeature("item_assist")).toBe("cheap");
    expect(tierForFeature("column_fill")).toBe("cheap");
  });

  it("defaults an unmapped feature to the conservative middle", () => {
    expect(tierForFeature("brand_new_feature")).toBe(DEFAULT_TIER);
  });

  it("emits ONLY tiers — never a concrete model id", () => {
    // This is the regression guard: a model id here would be sent verbatim to
    // whichever provider the org's key belongs to, and 400 for four of five.
    for (const f of AI_FEATURES)
      expect(["cheap", "standard", "strong"]).toContain(tierForFeature(f));
  });

  it("still covers all 13 known features", () => {
    expect(AI_FEATURES).toHaveLength(13);
  });
});
```

- [ ] **Step 6: Extend `OrgAiSettings` with the default model**

In `src/lib/ai/org-settings.ts`: add `defaultProvider: string | null;` and `defaultModelId: string | null;` to the `OrgAiSettings` type, add `defaultProvider: null, defaultModelId: null` to `DEFAULT_ORG_AI_SETTINGS`, add `default_provider, default_model_id` to the `.select(...)` column list, and map them in the return:

```ts
    defaultProvider: data.default_provider,
    defaultModelId: data.default_model_id,
```

- [ ] **Step 7: Run the tests**

```bash
pnpm vitest run src/lib/ai/models/resolve.test.ts src/lib/ai/model-map.test.ts
```

Expected: PASS (11 tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/models/resolve.ts src/lib/ai/models/resolve.test.ts \
        src/lib/ai/model-map.ts src/lib/ai/model-map.test.ts \
        src/lib/ai/org-settings.ts
git commit -m "feat(ai): resolveModel and a per-feature tier map

model-map stops emitting concrete model ids — which would 400 every
feature in a non-anthropic org once adapters honour the model — and emits
an abstract tier instead. resolveModel turns pinned/default/tier into a
concrete catalog model, flagging a substitution when a pin has retired."
```

---

## Task 8: Thread the provider through the gateway

**Files:**

- Modify: `src/lib/ai/gateway.ts`
- Modify: `src/lib/ai/gateway.test.ts`
- Modify: `src/lib/ai/errors.ts`

**Interfaces:**

- Consumes: `resolveUserAdapterById` (Task 5), `resolveModel` (Task 7), `computeCostUsd`/`ratesForModel` (Task 6), `getProviderRow`/`getAdapter` (Tasks 1, 3).
- Produces:
  - `export type ResolvedAi = { adapter: ProviderAdapter; apiKey: string; baseUrl: string | null; mode: AiMode; provider: string }`
  - `export async function resolveAiAdapter(orgId: string, userId: string, provider?: string): Promise<ResolvedAi>`
  - `runAi({ orgId, userId, feature, provider? }, fn)` where `fn` returns `{ result, usage, model, rates? }`. `rates` is optional — omitting it falls back to `ratesForModel(model)`, so existing call sites keep compiling unchanged.

- [ ] **Step 1: Name the provider in the key-missing errors**

In `src/lib/ai/errors.ts`, give the two key errors a provider:

```ts
export class PersonalAiKeyMissingError extends AiNotConfiguredError {
  constructor(public readonly provider?: string) {
    super();
    this.name = "PersonalAiKeyMissingError";
    if (provider) this.message = `No personal API key for ${provider}.`;
  }
}

export class ByoKeyMissingError extends Error {
  constructor(public readonly provider?: string) {
    super(
      provider
        ? `No organization API key for ${provider}.`
        : "No organization API key.",
    );
    this.name = "ByoKeyMissingError";
  }
}
```

Keep the existing zero-argument call sites working — the parameter is optional.

- [ ] **Step 2: Write the failing test**

Add to `src/lib/ai/gateway.test.ts`:

```ts
it("resolves the REQUESTED provider's key, not whichever key exists", async () => {
  // An agent pinned to Kimi must spend the Kimi key. Resolving 'whatever key
  // the user has' would send an Anthropic key to Moonshot's endpoint.
  const resolved = await resolveAiAdapter(ORG_ID, USER_ID, "moonshotai");
  expect(resolved.provider).toBe("moonshotai");
  expect(resolved.baseUrl).toBe("https://api.moonshot.ai/v1");
});

it("names the provider when its key is missing", async () => {
  await expect(
    resolveAiAdapter(ORG_ID, USER_ID, "mistral"),
  ).rejects.toMatchObject({ provider: "mistral" });
});
```

Before writing them, **read `src/lib/ai/gateway.test.ts` in full** and reuse its existing harness — it already mocks `createServiceClient`, `readOrgAiSettings` and the `rpc` surface, and a second parallel harness in one file will diverge. Concretely: add `moonshotai` and `mistral` rows to whatever provider fixture the file's `getProviderRow` mock returns, give the `per_user` credential mock a `moonshotai` entry and **no** `mistral` entry, and define `ORG_ID` / `USER_ID` from the constants already declared at the top of the file rather than new ones.

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm vitest run src/lib/ai/gateway.test.ts
```

Expected: FAIL — `resolveAiAdapter` takes two arguments.

- [ ] **Step 4: Update `resolveAiAdapter`**

In `src/lib/ai/gateway.ts`, add the third parameter and thread it through all four `ai_mode` branches:

```ts
export type ResolvedAi = {
  adapter: ProviderAdapter;
  apiKey: string;
  /** Non-null exactly for openai-compatible providers. */
  baseUrl: string | null;
  mode: AiMode;
  provider: string;
};

/**
 * The single chokepoint: picks the key + adapter for the org's ai_mode.
 *
 * `provider` names WHICH provider's key to resolve — supplied when an agent has
 * pinned a model, omitted to take the mode's own provider. `userId` is still
 * required because the `per_user` branch resolves THAT user's key.
 */
export async function resolveAiAdapter(
  orgId: string,
  userId: string,
  provider?: string,
): Promise<ResolvedAi> {
  const svc = createServiceClient();
  const settings = await readOrgAiSettings(svc, orgId);

  switch (settings.mode) {
    case "off":
      throw new AiDisabledError();

    case "managed": {
      // The platform key is Anthropic's; a request for any other provider
      // cannot be served under managed mode.
      const wanted = provider ?? "anthropic";
      if (wanted !== "anthropic") throw new ByoKeyMissingError(wanted);
      const apiKey = getServerEnv().ANTHROPIC_API_KEY;
      if (!apiKey) throw new AiNotConfiguredError();
      const row = await getProviderRow(svc, "anthropic");
      if (!row) throw new AiNotConfiguredError();
      return {
        adapter: getAdapter(row.adapterKind),
        apiKey,
        baseUrl: row.baseUrl,
        mode: "managed",
        provider: "anthropic",
      };
    }

    case "org_byo": {
      const wanted = provider ?? settings.byoProvider;
      if (!wanted) throw new ByoKeyMissingError();
      const { data, error } = await svc.rpc("org_ai_secret_get", {
        p_org: orgId,
        p_provider: wanted,
      });
      if (error) throw error;
      const secret = data?.[0];
      if (!secret?.secret) throw new ByoKeyMissingError(wanted);
      const row = await getProviderRow(svc, wanted);
      if (!row || !row.enabled) throw new ByoKeyMissingError(wanted);
      return {
        adapter: getAdapter(row.adapterKind),
        apiKey: secret.secret,
        baseUrl: row.baseUrl,
        mode: "org_byo",
        provider: wanted,
      };
    }

    // TRUST: `asTrustedUserId(userId)` is safe HERE because every caller is
    // either a Server Action/route that derived `userId` from its own
    // requireUser() session, or a service-role cron handler that derived it
    // from an HMAC-verified request's own DB row (e.g. agent.owner_id) —
    // never from a request parameter passed straight through. This remains
    // the ONE call site allowed to mint a TrustedUserId.
    case "per_user": {
      const wanted = provider ?? "anthropic";
      const { adapter, apiKey, baseUrl } = await resolveUserAdapterById(
        asTrustedUserId(userId),
        wanted,
      );
      return { adapter, apiKey, baseUrl, mode: "per_user", provider: wanted };
    }
  }
}
```

Add imports for `getProviderRow` and keep `getAdapter` (now called with `row.adapterKind`).

- [ ] **Step 5: Update `runAi` and `runEmbedding` to pass rates**

In the same file, change the metering to take rates from the caller, falling back to the seeded floor:

```ts
export async function runAi<T>(
  args: { orgId: string; userId: string; feature: string; provider?: string },
  fn: (resolved: ResolvedAi) => Promise<{
    result: T;
    usage: AiUsageTokens;
    model: string;
    /** From the catalog row resolveModel chose; null falls back to the floor. */
    rates?: ModelRates | null;
  }>,
): Promise<T> {
  const resolved = await resolveAiAdapter(
    args.orgId,
    args.userId,
    args.provider,
  );
  const { result, usage, model, rates } = await fn(resolved);
  const costUsd = computeCostUsd(rates ?? ratesForModel(model), usage);
  const credits = costToCredits(costUsd);
  // …rest of the existing record_ai_usage call unchanged…
}
```

In `runEmbedding`, replace `computeCostUsd(model, usage)` with `computeCostUsd(ratesForModel(model), usage)` — the embedding model is fixed and always in the floor.

- [ ] **Step 6: Run the tests**

```bash
pnpm vitest run src/lib/ai/gateway.test.ts
pnpm typecheck
```

Expected: gateway tests PASS. `rates` is optional, so existing `runAi` call sites are not flagged. Any remaining `PROVIDER_CATALOG` / `adapter.id` usage is fixed by threading a `ProviderRow` from the nearest server component — do not reintroduce a static catalog. `adapter.supportsTools` should already be gone: Task 3a owns that, and if typecheck still flags it here, Task 3a was incomplete rather than this task being wrong.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/gateway.ts src/lib/ai/gateway.test.ts src/lib/ai/errors.ts
git commit -m "feat(ai): resolve keys per requested provider at the chokepoint

resolveAiAdapter takes an optional provider and threads it through all
four ai_mode branches, returning the provider's base_url alongside the
adapter. Key-missing errors now name the provider so the ui can say which
key to add. runAi meters from catalog rates with the seeded floor as
fallback."
```

---

## Task 9: Multi-key settings UI

**Files:**

- Create: `src/components/settings/AiKeyList.tsx`
- Create: `src/components/settings/AiKeyList.test.tsx`
- Delete: `src/components/settings/AiProviderForm.tsx` and `AiProviderForm.test.tsx`
- Modify: `src/app/(app)/settings/ai/page.tsx`

**Interfaces:**

- Consumes: `saveAiKey`, `removeAiKey`, `listMyAiCredentials` (Task 5); `listEnabledProviders`, `ProviderRow` (Task 1).
- Produces: `export function AiKeyList({ providers, initial }: { providers: ProviderRow[]; initial: { provider: string; hint: string; updatedAt: string }[] })`

- [ ] **Step 1: Load the design skills**

UI work requires them (working agreement #3). Load **`pulse-ui`** and **`example-skills:frontend-design`** before writing any JSX. Follow the existing `AiProviderForm` conventions: inline error messages (the app has no toast primitive), `SettingsSection` / `SettingRow` wrappers, shadcn `Button` / `Input` / `Label`.

- [ ] **Step 2: Write the failing test**

Create `src/components/settings/AiKeyList.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiKeyList } from "@/components/settings/AiKeyList";

vi.mock("@/lib/ai/credentials-actions", () => ({
  saveAiKey: vi.fn(),
  removeAiKey: vi.fn(),
}));

const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    adapterKind: "anthropic" as const,
    baseUrl: null,
    keyPlaceholder: "sk-ant-…",
    keyFormat: "^sk-ant-",
    enabled: true,
  },
  {
    id: "moonshotai",
    label: "Kimi (Moonshot AI)",
    adapterKind: "openai-compatible" as const,
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-…",
    keyFormat: "^sk-",
    enabled: true,
  },
];

describe("AiKeyList", () => {
  it("renders a row for every enabled provider", () => {
    render(<AiKeyList providers={PROVIDERS} initial={[]} />);
    expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("Kimi (Moonshot AI)")).toBeInTheDocument();
  });

  it("shows the masked hint for a configured provider and nothing for the rest", () => {
    render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/sk-ant-…1234/)).toBeInTheDocument();
    // The unconfigured provider offers an Add affordance, not a hint.
    expect(screen.getAllByRole("button", { name: /add key/i })).toHaveLength(1);
  });

  it("never renders a raw key back to the page", () => {
    const { container } = render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );
    expect(container.textContent).not.toMatch(/sk-ant-api03/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm vitest run src/components/settings/AiKeyList.test.tsx
```

Expected: FAIL — cannot resolve `@/components/settings/AiKeyList`.

- [ ] **Step 4: Implement `AiKeyList`**

Create `src/components/settings/AiKeyList.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Configured = { provider: string; hint: string; updatedAt: string };

/**
 * Personal Settings → AI: one row per provider, each key added, replaced and
 * removed independently. Replaces AiProviderForm, which modelled a single key
 * because ai_credential_set used to delete every other provider's row.
 *
 * Inline messages, not toasts — the app has no toast primitive (same choice
 * ProfileForm makes). The raw key is never rendered back; only the masked hint
 * the server action returns.
 */
export function AiKeyList({
  providers,
  initial,
}: {
  providers: ProviderRow[];
  initial: Configured[];
}) {
  const [configured, setConfigured] = useState<Record<string, Configured>>(
    Object.fromEntries(initial.map((c) => [c.provider, c])),
  );
  // Which provider's input is open. Only one at a time keeps the page calm.
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function save(provider: string) {
    setErrors((e) => ({ ...e, [provider]: "" }));
    start(async () => {
      const res = await saveAiKey({ provider, key: key.trim() });
      if (res.ok) {
        setConfigured((c) => ({
          ...c,
          [provider]: {
            provider,
            hint: res.data.hint,
            updatedAt: new Date().toISOString(),
          },
        }));
        setKey("");
        setEditing(null);
      } else {
        setErrors((e) => ({ ...e, [provider]: res.error }));
      }
    });
  }

  function remove(provider: string) {
    setErrors((e) => ({ ...e, [provider]: "" }));
    start(async () => {
      const res = await removeAiKey({ provider });
      if (res.ok) {
        setConfigured((c) => {
          const next = { ...c };
          delete next[provider];
          return next;
        });
      } else {
        setErrors((e) => ({ ...e, [provider]: res.error }));
      }
    });
  }

  return (
    <div className="space-y-2">
      {providers.map((p) => {
        const cfg = configured[p.id];
        const isEditing = editing === p.id;
        const updated = cfg
          ? new Date(cfg.updatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : null;

        return (
          <div key={p.id} className="rounded-md border px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-muted-foreground text-xs">
                  {cfg ? `${cfg.hint} · Updated ${updated}` : "Not configured"}
                </p>
              </div>
              <div className="flex gap-2">
                {cfg ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(isEditing ? null : p.id);
                        setKey("");
                      }}
                    >
                      Replace
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => remove(p.id)}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(isEditing ? null : p.id);
                      setKey("");
                    }}
                  >
                    Add key
                  </Button>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="mt-3 space-y-1.5">
                <Label htmlFor={`ai-key-${p.id}`}>API key</Label>
                <Input
                  id={`ai-key-${p.id}`}
                  type="password"
                  value={key}
                  autoComplete="off"
                  placeholder={p.keyPlaceholder}
                  disabled={pending}
                  onChange={(e) => setKey(e.target.value)}
                />
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={pending || key.trim().length < 10}
                    onClick={() => save(p.id)}
                  >
                    {pending ? "Verifying…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setEditing(null);
                      setKey("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {errors[p.id] && (
              <p className="text-destructive mt-2 text-xs">{errors[p.id]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Update the settings page**

In `src/app/(app)/settings/ai/page.tsx`, replace the `getMyAiCredential()` call with `listMyAiCredentials()`, add a `listEnabledProviders(await createClient())` read to the same `Promise.all`, and render `<AiKeyList providers={providers} initial={credentials} />` in place of `<AiProviderForm initial={aiCredential} />`.

- [ ] **Step 6: Run the tests and delete the old component**

```bash
git rm src/components/settings/AiProviderForm.tsx \
       src/components/settings/AiProviderForm.test.tsx
pnpm vitest run src/components/settings/
```

Expected: PASS.

- [ ] **Step 7: Verify in the browser**

```bash
pnpm dev
```

Visit `http://localhost:3000/settings/ai`. Confirm: five provider rows; adding an Anthropic key leaves a Kimi key untouched and vice versa; removing one leaves the other; an invalid key shows the row's inline rejection message.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/AiKeyList.tsx \
        src/components/settings/AiKeyList.test.tsx \
        "src/app/(app)/settings/ai/page.tsx"
git commit -m "feat(settings): manage one ai key per provider

Replaces the single-key form with a per-provider list; each key is added,
replaced and removed independently."
```

---

## Task 10: Org default-model picker

**Files:**

- Create: `src/components/settings/ModelPicker.tsx`
- Create: `src/components/settings/ModelPicker.test.tsx`
- Modify: `src/components/settings/OrgAiSettingsForm.tsx`
- Modify: `src/lib/ai/settings-actions.ts`
- Modify: `src/app/(app)/settings/ai/page.tsx`

**Interfaces:**

- Consumes: `listActiveModels` (Task 4), `OrgAiSettings.defaultProvider/defaultModelId` (Task 7), `ProviderRow` (Task 1).
- Produces:
  - `export type ModelOption = { provider: string; providerLabel: string; modelId: string; label: string; tier: ModelTier; supportsTools: boolean }`
  - `export function ModelPicker(props: { options: ModelOption[]; value: { provider: string; modelId: string } | null; onChange: (v: { provider: string; modelId: string } | null) => void; allowInherit?: boolean; inheritLabel?: string })`
  - `setOrgDefaultModel(input: { provider: string; modelId: string }): Promise<ActionResult<…>>`

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/ModelPicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ModelPicker,
  type ModelOption,
} from "@/components/settings/ModelPicker";

const OPTIONS: ModelOption[] = [
  {
    provider: "anthropic",
    providerLabel: "Anthropic (Claude)",
    modelId: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    tier: "standard",
    supportsTools: true,
  },
  {
    provider: "moonshotai",
    providerLabel: "Kimi (Moonshot AI)",
    modelId: "kimi-k2",
    label: "Kimi K2 Instruct",
    tier: "cheap",
    supportsTools: true,
  },
];

// NOTE: Radix Select renders its groups/items into a portal only while OPEN,
// so grouping is asserted by opening the trigger. The empty and retired states
// render unconditionally and are asserted directly.
describe("ModelPicker", () => {
  it("renders an empty state rather than an empty select when no keys exist", () => {
    render(<ModelPicker options={[]} value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/add an api key/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("flags a value that is no longer in the options as retired", () => {
    render(
      <ModelPicker
        options={OPTIONS}
        value={{ provider: "anthropic", modelId: "claude-retired-9" }}
        onChange={vi.fn()}
      />,
    );
    // The stale value stays visible — a silent reset would hide why an agent's
    // output changed.
    expect(screen.getByText(/claude-retired-9/)).toBeInTheDocument();
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("does NOT flag a value that is present in the options", () => {
    render(
      <ModelPicker
        options={OPTIONS}
        value={{ provider: "moonshotai", modelId: "kimi-k2" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  });

  it("groups options by provider once opened", async () => {
    const user = userEvent.setup();
    render(<ModelPicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("Kimi (Moonshot AI)")).toBeInTheDocument();
  });

  it("offers an inherit option when allowInherit is set", async () => {
    const user = userEvent.setup();
    render(
      <ModelPicker
        options={OPTIONS}
        value={null}
        onChange={vi.fn()}
        allowInherit
        inheritLabel="Use org default"
      />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Use org default")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run src/components/settings/ModelPicker.test.tsx
```

Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement `ModelPicker`**

Create `src/components/settings/ModelPicker.tsx`:

```tsx
"use client";

import type { ModelTier } from "@/lib/ai/models/feed-parse";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ModelOption = {
  provider: string;
  providerLabel: string;
  modelId: string;
  label: string;
  tier: ModelTier;
  supportsTools: boolean;
};

export type ModelValue = { provider: string; modelId: string };

const INHERIT = "__inherit__";
const encode = (v: ModelValue) => `${v.provider}/${v.modelId}`;

/**
 * Shared provider+model select, used by both org settings and the agent editor.
 *
 * Receives EVERY option as a prop from a server component and filters purely in
 * client state — switching provider is 0 server round-trips (working agreement
 * #5). Never fetch the catalog from here.
 *
 * When `value` names a model that is not in `options`, the model has been
 * retired out from under the user. The value stays visible with a banner rather
 * than silently resetting, because a silent reset hides why an agent's output
 * changed.
 */
export function ModelPicker({
  options,
  value,
  onChange,
  allowInherit = false,
  inheritLabel = "Use org default",
}: {
  options: ModelOption[];
  value: ModelValue | null;
  onChange: (v: ModelValue | null) => void;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  if (options.length === 0)
    return (
      <p className="text-muted-foreground text-xs">
        No models available — add an API key for a provider first.
      </p>
    );

  const groups = new Map<string, ModelOption[]>();
  for (const o of options) {
    const list = groups.get(o.providerLabel) ?? [];
    list.push(o);
    groups.set(o.providerLabel, list);
  }

  const retired =
    value !== null &&
    !options.some(
      (o) => o.provider === value.provider && o.modelId === value.modelId,
    );

  return (
    <div className="space-y-1.5">
      <Select
        value={value ? encode(value) : allowInherit ? INHERIT : undefined}
        onValueChange={(v) => {
          if (v === INHERIT) return onChange(null);
          const slash = v.indexOf("/");
          onChange({
            provider: v.slice(0, slash),
            modelId: v.slice(slash + 1),
          });
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Pick a model" />
        </SelectTrigger>
        <SelectContent>
          {allowInherit && (
            <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
          )}
          {[...groups.entries()].map(([providerLabel, models]) => (
            <SelectGroup key={providerLabel}>
              <SelectLabel>{providerLabel}</SelectLabel>
              {models.map((m) => (
                <SelectItem key={encode(m)} value={encode(m)}>
                  {m.label}
                  {!m.supportsTools && " · no tools"}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {retired && (
        <p className="text-destructive text-xs">
          {value.modelId} is no longer available — pick a new model. Runs fall
          back to the org default until you do.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the server action**

**Read `src/lib/ai/settings-actions.ts` first** and copy its existing guard prologue verbatim — every action in that file resolves the active org and asserts the caller is an org admin before touching `org_ai_settings`, and an action that skips it would let any member repoint the org's spend. Substitute that prologue for the `// …` line below:

```ts
const defaultModelSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  modelId: z.string().trim().min(1).max(128),
});

export async function setOrgDefaultModel(input: {
  provider: string;
  modelId: string;
}): Promise<ActionResult<Record<never, never>>> {
  const parsed = defaultModelSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a model.");
  // …reuse this file's existing org + admin resolution, then:
  const svc = createServiceClient();
  // Validated against the catalog, not trusted from the client: a model that
  // is not active must never become the org-wide fallback.
  const model = await getModel(svc, parsed.data.provider, parsed.data.modelId);
  if (!model || model.status !== "active")
    return fail("That model isn't available.");
  const { error } = await svc
    .from("org_ai_settings")
    .update({
      default_provider: parsed.data.provider,
      default_model_id: parsed.data.modelId,
    })
    .eq("org_id", org.id);
  if (error) return fail("Couldn't save the default model.");
  revalidatePath("/settings/ai");
  return { ok: true, data: {} };
}
```

- [ ] **Step 5: Wire it into the org settings form and page**

In `src/app/(app)/settings/ai/page.tsx`, build `ModelOption[]` server-side — one catalog read per provider the user holds a key for, then a flat list handed to the client:

```tsx
import { createClient } from "@/lib/supabase/server";
import { listEnabledProviders } from "@/lib/ai/providers/provider-rows";
import { listActiveModels } from "@/lib/ai/models/catalog-db";
import { listMyAiCredentials } from "@/lib/ai/credentials";
import type { ModelOption } from "@/components/settings/ModelPicker";

// …inside the page component, after `org` is resolved:
const supabase = await createClient();
const [providers, credentials] = await Promise.all([
  listEnabledProviders(supabase),
  listMyAiCredentials(),
]);

// Only offer models the org can actually reach: a picker entry with no key
// behind it is a run that fails at 7am instead of a choice.
const keyed = new Set(credentials.map((c) => c.provider));
const usable = providers.filter((p) => keyed.has(p.id));

const modelOptions: ModelOption[] = (
  await Promise.all(
    usable.map(async (p) => {
      const models = await listActiveModels(supabase, p.id);
      return models.map((m) => ({
        provider: p.id,
        providerLabel: p.label,
        modelId: m.modelId,
        label: m.label,
        tier: m.tier,
        supportsTools: m.supportsTools,
      }));
    }),
  )
).flat();
```

Pass `modelOptions` and the current default into `OrgAiSettingsForm`, and render the picker inside it:

```tsx
<div className="space-y-1.5">
  <Label>Default model</Label>
  <ModelPicker
    options={modelOptions}
    value={
      initial.defaultProvider && initial.defaultModelId
        ? { provider: initial.defaultProvider, modelId: initial.defaultModelId }
        : null
    }
    onChange={(v) => {
      if (!v) return;
      start(async () => {
        const res = await setOrgDefaultModel(v);
        if (!res.ok) setError(res.error);
      });
    }}
  />
  <p className="text-muted-foreground text-xs">
    Used by every AI feature, and by any agent that hasn&apos;t pinned its own
    model.
  </p>
</div>
```

- [ ] **Step 6: Run tests and verify**

```bash
pnpm vitest run src/components/settings/
pnpm dev
```

Visit `/settings/ai`. Confirm the default-model select lists only providers with a key, that switching provider does **not** trigger a page navigation or a server fetch (check the Network tab — this is the working-agreement-#5 assertion), and that saving persists across a reload.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/ModelPicker.tsx \
        src/components/settings/ModelPicker.test.tsx \
        src/components/settings/OrgAiSettingsForm.tsx \
        src/lib/ai/settings-actions.ts \
        "src/app/(app)/settings/ai/page.tsx"
git commit -m "feat(settings): org default model picker

Grouped by provider, limited to providers with a resolvable key and to
active catalog models. Filtering is client state — no server round-trip
per interaction."
```

---

## Task 11: Agent provider/model picker

**Files:**

- Modify: `src/lib/agents/agent-config.ts`
- Modify: `src/lib/agents/agents-db.ts`
- Modify: `src/lib/agents/actions.ts`
- Modify: `src/components/agents/AgentEditor.tsx`
- Modify: `src/components/agents/AgentEditor.test.tsx` (create if absent)
- Modify: `src/app/api/ai/personal-agent/route.ts`
- Modify: `src/lib/agents/agents-db.test.ts`

**Interfaces:**

- Consumes: `ModelPicker` / `ModelOption` (Task 10), `resolveModel` (Task 7), `runAi` with `provider` (Task 8).
- Produces: `personalAgentSettingsSchema` gains `provider: string | null` and `modelId: string | null`; `UserAgentRow` gains `provider: string | null; model_id: string | null`.

- [ ] **Step 1: Write the failing schema test**

Add to `src/lib/agents/agent-config.test.ts`:

```ts
it("accepts a pinned provider and model", () => {
  const r = personalAgentSettingsSchema.safeParse({
    name: "Proposal Writer",
    templateId: "morning-brief",
    instructions: "Do the thing.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
    enabled: true,
    provider: "moonshotai",
    modelId: "kimi-k2",
  });
  expect(r.success).toBe(true);
});

it("treats a null provider+model as 'use the org default'", () => {
  const r = personalAgentSettingsSchema.safeParse({
    name: "Morning Brief",
    templateId: "morning-brief",
    instructions: "Do the thing.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
    enabled: true,
    provider: null,
    modelId: null,
  });
  expect(r.success).toBe(true);
});

it("rejects a model pinned without a provider — the pair is meaningless alone", () => {
  const r = personalAgentSettingsSchema.safeParse({
    name: "Broken",
    templateId: "morning-brief",
    instructions: "Do the thing.",
    boardScope: { mode: "all" },
    cadence: "daily",
    runAtLocalHour: 7,
    enabled: true,
    provider: null,
    modelId: "kimi-k2",
  });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run src/lib/agents/agent-config.test.ts
```

Expected: FAIL on the third test — the schema currently strips unknown keys, so `provider: null, modelId: "kimi-k2"` parses successfully.

- [ ] **Step 3: Extend the schema**

In `src/lib/agents/agent-config.ts`, add to `personalAgentSettingsSchema` and close it with a refinement:

```ts
export const personalAgentSettingsSchema = z
  .object({
    // …existing fields unchanged…
    /** Null on both => inherit the org default. A model without a provider is
     *  not resolvable, so the pair is validated together. */
    provider: z.string().trim().min(1).max(64).nullable().default(null),
    modelId: z.string().trim().min(1).max(128).nullable().default(null),
  })
  .refine((v) => !(v.modelId !== null && v.provider === null), {
    message: "Pick a provider for that model.",
    path: ["provider"],
  });
```

- [ ] **Step 4: Extend the DB seam**

In `src/lib/agents/agents-db.ts`, add `provider: string | null;` and `model_id: string | null;` to `UserAgentRow`, and append `, provider, model_id` to the `AGENT_COLS` constant.

- [ ] **Step 5: Persist the fields**

In `src/lib/agents/actions.ts`, add `provider: parsed.data.provider, model_id: parsed.data.modelId` to the insert in `createAgent` and the update in `updateAgent`.

- [ ] **Step 6: Use the pin at run time**

In `src/app/api/ai/personal-agent/route.ts`, resolve the model before the run and pass both through:

```ts
const svc = createServiceClient();
const orgSettings = await readOrgAiSettings(svc, agent.org_id);
const provider = agent.provider ?? orgSettings.defaultProvider ?? "anthropic";
const resolvedModel = await resolveModel({
  client: svc,
  provider,
  feature: FEATURE,
  requested: agent.model_id,
  orgDefaultModelId: orgSettings.defaultModelId,
});
if (!resolvedModel.model) throw new ByoKeyMissingError(provider);

// A retirement must not silently stop a scheduled agent: the run proceeds on
// the substituted model and records that it happened, so the roster can flag
// the agent rather than the user discovering a missing 7am brief.
const summary = await runAi(
  { orgId: agent.org_id, userId: agent.owner_id, feature: FEATURE, provider },
  async (resolved) =>
    summariseBriefing({
      resolved,
      model: resolvedModel.model!,
      rates: resolvedModel.rates,
      briefing,
      instructions: agent.instructions,
    }),
);
```

Then extend `finalizeRun`'s patch with `model_substituted: resolvedModel.substituted` **only if** you also add that column — otherwise record it in the existing `error` field as an informational note. **Do not add a second migration** (Global Constraints); use the existing `error` column with a non-failing prefix, matching how `CLAIM_PLACEHOLDER` reuses `status`.

Update `summariseBriefing` in `src/lib/agents/summarise.ts` to accept and forward `model` + `rates` to the adapter and back out of `runAi`.

- [ ] **Step 7: Add the model picker to the agent editor**

In `src/components/agents/AgentEditor.tsx`, add the state alongside the existing `name` / `instructions` state:

```tsx
import {
  ModelPicker,
  type ModelOption,
  type ModelValue,
} from "@/components/settings/ModelPicker";

// `options` is a new prop on AgentEditor, built server-side by the page that
// renders it (same construction as Task 10 Step 5). Do NOT fetch the catalog
// from the client — the picker filters in client state, 0 round-trips.
const [model, setModel] = useState<ModelValue | null>(
  initial.provider && initial.modelId
    ? { provider: initial.provider, modelId: initial.modelId }
    : null,
);
```

Render it directly below the Name field (around line 160, after the name error paragraph):

```tsx
<div className="space-y-1.5">
  <Label>Model</Label>
  <ModelPicker
    options={options}
    value={model}
    onChange={setModel}
    allowInherit
    inheritLabel="Use org default"
  />
</div>
```

And include both fields in the payload the save handler builds (around line 75, alongside `name: name.trim()`):

```tsx
provider: model?.provider ?? null,
modelId: model?.modelId ?? null,
```

- [ ] **Step 8: Run the tests**

```bash
pnpm vitest run src/lib/agents/ src/components/agents/
```

Expected: PASS.

- [ ] **Step 9: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. This is the working-agreement #4 gate — do not proceed to `finish-task.sh` until every one is green.

- [ ] **Step 10: Manual verification against DEV**

```bash
pnpm dev
```

1. `/settings/ai` → add an Anthropic key **and** a Kimi key. Both rows show hints.
2. `/settings/ai` → set the org default model to a Claude model. Reload; it persists.
3. `/settings/agents` → create an agent, pin it to **Kimi K2**. Save, reload; the pin persists.
4. Trigger that agent's run (sign the fire body as in Task 4 Step 7, POSTing to `/api/ai/personal-agent`).
5. Confirm via the `supabase-dev` MCP that the usage row recorded Kimi, not Claude:

```sql
select provider, model, input_tokens, output_tokens, credits
  from public.ai_usage order by created_at desc limit 5;
```

Expected: `provider = 'moonshotai'`, `model = 'kimi-k2'`, non-zero credits. **A zero-credit row means the price lookup failed** — check that model's catalog row before proceeding.

- [ ] **Step 11: Commit**

```bash
git add src/lib/agents/ src/components/agents/ \
        src/app/api/ai/personal-agent/route.ts
git commit -m "feat(agents): pin an agent to a provider and model

Null on both inherits the org default. A retired pin falls back to the
default and records the substitution rather than failing the run, so a
scheduled agent never silently stops producing."
```

---

## Closing the task

- [ ] **Run the full gates one final time**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- [ ] **Verify the migration ledger**

```bash
pnpm db:ledger-check
```

Expected: exit 0. A ledger row with no committed file blocks `finish-task.sh` (gotcha-57).

- [ ] **Finish the task**

```bash
scripts/finish-task.sh
```

This rebases onto the latest `develop`, re-runs the gates against the merged state, merges, pushes, and removes the worktree + branch. If it stops on a rebase conflict, resolve `git rebase develop` and re-run.

- [ ] **Write the "How to test this" walkthrough**

Working agreement #1 requires a numbered manual-test guide for the user, in both the closing message and the `/wrapup` session note. Task 11 Step 10 is the basis; state which env (DEV) and that they must pull `develop` first.

---

## Spec coverage

| Spec section                                                                                         | Task                                                                                          |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| §0 `ai_providers` registry, adapter_kind, five seeds                                                 | 1                                                                                             |
| §0 FK swap, `AiProvider` widening, `getAdapter` by kind                                              | 1, 3, 8                                                                                       |
| §1 `ai_models` catalog, RLS, index, seed floor                                                       | 1                                                                                             |
| §2 refresh, `type=='language'` + enabled filters, both guards                                        | 2, 4                                                                                          |
| §3 `resolveAiAdapter(provider)`, `resolveModel` matrix, model-map → tiers                            | 7, 8                                                                                          |
| §4 AI SDK v6 adapters + generic openai-compatible, supports_tools per model                          | 3                                                                                             |
| §5 pure/sync `computeCostUsd` from catalog rates, fallback floor                                     | 6, 8                                                                                          |
| §6 per-provider credentials, org default cols, agent cols                                            | 1, 5, 7, 11                                                                                   |
| §7 key list, default-model picker, agent picker, 0 round-trips                                       | 9, 10, 11                                                                                     |
| Error handling table                                                                                 | 5 (missing key), 7 (retired → substitute), 2 (needs_pricing), 4 (fetch fails), 7 (no default) |
| Testing: resolveModel matrix, retire guard, credential isolation, adapter model, regression, fixture | 7, 4, 5, 3, 3, 2                                                                              |
