# Per-user BYO AI Provider Keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user enable AI features by pasting their own Anthropic, OpenAI, or Google Gemini API key in Settings, stored encrypted in Supabase Vault, used to run dashboard generation.

**Architecture:** A client-safe provider **catalog** + a server-only **adapter** per provider (validate + generate) behind a registry. Keys are written/read only through service-role `SECURITY DEFINER` SQL functions over Supabase Vault; a per-user metadata row (RLS self-select) holds the vault id + masked hint. The existing generator resolves the current user's adapter+key instead of a hardcoded Anthropic client.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres + Vault + RLS), TypeScript strict, Zod v4, Vitest, `@anthropic-ai/sdk` (installed), `openai` + `@google/genai` (added here).

**Spec:** `docs/superpowers/specs/2026-07-06-byo-ai-provider-keys-design.md`

## Global Constraints

Every task implicitly includes these (verbatim from the spec + repo invariants):

- **Server Components by default; Server Actions for all mutations.** Next.js 16 — confirm APIs against `node_modules/next/dist/docs/` when unsure.
- **Validate at boundaries with Zod. TypeScript strict; no `any`** unless justified.
- **RLS is the security boundary** — default-deny, self-scoped. `SUPABASE_SERVICE_ROLE_KEY` and all key handling are **server-only**; never reach the browser (mark modules `import "server-only"`).
- **Client components must never import a `server-only` module** (build error). Provider display metadata lives in a client-safe `catalog.ts`.
- **Schema changes are versioned migrations** in `supabase/migrations/`; after applying, regenerate `src/types/database.types.ts` and commit it in the same branch.
- **Raw key never returned to the client** — actions return only a masked hint.
- **No env fallback** — resolution is strictly per-user; a missing key throws `AiNotConfiguredError` with the **exact existing message** `"AI generation isn't configured."` (do not change it — three tests + the wizard assert it).
- **Default models (single source of truth constants):** Anthropic `claude-opus-4-8`, OpenAI `gpt-4o`, Google `gemini-2.0-flash`.
- **Commit identity:** author every commit as `Danijel Jovanovic <info@synapse-solutions.ai>` (pinned by `start-task.sh`). **Stage explicitly by path** (never `git add -A`).
- **Commit messages:** lowercase subject after `type(scope):`; a descriptive body; end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Gates before done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## File Structure

| File                                               | Responsibility                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/providers/catalog.ts`                  | **Client-safe.** `AiProvider` type + `PROVIDER_CATALOG` + `ALL_PROVIDERS` (id/label/placeholder). No server-only, no SDKs. |
| `src/lib/ai/providers/types.ts`                    | `ProviderAdapter` interface + `ProviderAuthError`.                                                                         |
| `src/lib/ai/providers/anthropic.ts`                | Anthropic adapter (native structured output).                                                                              |
| `src/lib/ai/providers/openai.ts`                   | OpenAI adapter (JSON mode + schema-in-prompt).                                                                             |
| `src/lib/ai/providers/google.ts`                   | Gemini adapter (JSON mime + schema-in-prompt).                                                                             |
| `src/lib/ai/providers/registry.ts`                 | `getAdapter(provider)` map. Server-only.                                                                                   |
| `supabase/migrations/<ts>_user_ai_credentials.sql` | Table + RLS + 3 `SECURITY DEFINER` vault functions.                                                                        |
| `src/lib/ai/credentials.ts`                        | `resolveUserAdapter()` + `maskKey()`. Server-only.                                                                         |
| `src/lib/ai/credentials-actions.ts`                | `saveAiKey()` / `removeAiKey()` Server Actions.                                                                            |
| `src/lib/ai/generate.ts`                           | **Modify** — dispatch via resolved adapter.                                                                                |
| `src/components/settings/AiProviderForm.tsx`       | Client form (select provider, save/replace/remove).                                                                        |
| `src/app/(app)/settings/page.tsx`                  | **Modify** — read status, render "AI" card.                                                                                |

---

## Task 1: Provider catalog + adapter contract + dependencies

**Files:**

- Create: `src/lib/ai/providers/catalog.ts`
- Create: `src/lib/ai/providers/types.ts`
- Test: `src/lib/ai/providers/catalog.test.ts`
- Modify: `package.json` (add `openai`, `@google/genai`)

**Interfaces:**

- Produces:
  - `type AiProvider = "anthropic" | "openai" | "google"` (from `catalog.ts`)
  - `PROVIDER_CATALOG: Record<AiProvider, { label: string; placeholder: string }>`
  - `ALL_PROVIDERS: { id: AiProvider; label: string; placeholder: string }[]`
  - `interface ProviderAdapter { id; label; placeholder; keyFormat: z.ZodType<string>; defaultModel: string; validateKey(rawKey): Promise<void>; generateProposal(args:{apiKey;system;user}): Promise<DashboardProposal> }` (from `types.ts`)
  - `class ProviderAuthError extends Error { provider: AiProvider }`

- [ ] **Step 1: Add dependencies**

Run (in the worktree):

```bash
pnpm add openai @google/genai
```

Expected: both resolve and install; `package.json` + `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing test**

`src/lib/ai/providers/catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_PROVIDERS, PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";

describe("provider catalog", () => {
  it("lists exactly the three supported providers", () => {
    expect(ALL_PROVIDERS.map((p) => p.id)).toEqual([
      "anthropic",
      "openai",
      "google",
    ]);
  });

  it("has a human label and placeholder for each provider", () => {
    for (const p of ALL_PROVIDERS) {
      expect(PROVIDER_CATALOG[p.id].label.length).toBeGreaterThan(0);
      expect(PROVIDER_CATALOG[p.id].placeholder.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/providers/catalog.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/providers/catalog`.

- [ ] **Step 4: Implement the catalog (client-safe — NO `server-only`, NO SDK imports)**

`src/lib/ai/providers/catalog.ts`:

```ts
// Client-safe provider display metadata. Imported by both the server-only
// adapters and the client settings form, so it MUST NOT import "server-only"
// or any provider SDK.
export type AiProvider = "anthropic" | "openai" | "google";

export const PROVIDER_CATALOG: Record<
  AiProvider,
  { label: string; placeholder: string }
> = {
  anthropic: { label: "Anthropic (Claude)", placeholder: "sk-ant-…" },
  openai: { label: "OpenAI", placeholder: "sk-…" },
  google: { label: "Google Gemini", placeholder: "AIza…" },
};

export const ALL_PROVIDERS: {
  id: AiProvider;
  label: string;
  placeholder: string;
}[] = (["anthropic", "openai", "google"] as const).map((id) => ({
  id,
  ...PROVIDER_CATALOG[id],
}));
```

- [ ] **Step 5: Implement the adapter contract**

`src/lib/ai/providers/types.ts`:

```ts
import type { z } from "zod";
import type { DashboardProposal } from "@/lib/ai/proposal-schema";
import type { AiProvider } from "@/lib/ai/providers/catalog";

/** Thrown by an adapter's validateKey when the provider rejects the key. */
export class ProviderAuthError extends Error {
  constructor(public readonly provider: AiProvider) {
    super(`Key rejected by ${provider}`);
    this.name = "ProviderAuthError";
  }
}

export interface ProviderAdapter {
  id: AiProvider;
  label: string;
  placeholder: string;
  /** Cheap shape check before the live ping. */
  keyFormat: z.ZodType<string>;
  defaultModel: string;
  /** Resolves if the key is accepted; throws ProviderAuthError if rejected. */
  validateKey(rawKey: string): Promise<void>;
  /** Runs the provider to produce a raw (unvalidated) proposal. */
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
  }): Promise<DashboardProposal>;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/lib/ai/providers/catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/providers/catalog.ts src/lib/ai/providers/types.ts src/lib/ai/providers/catalog.test.ts package.json pnpm-lock.yaml
git commit -m "feat(ai): add provider catalog and adapter contract" -m "Client-safe catalog (AiProvider, PROVIDER_CATALOG, ALL_PROVIDERS) plus the server-side ProviderAdapter interface and ProviderAuthError. Adds the openai and @google/genai SDK deps for the upcoming adapters." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Provider adapters + registry

**Files:**

- Create: `src/lib/ai/providers/anthropic.ts`, `src/lib/ai/providers/openai.ts`, `src/lib/ai/providers/google.ts`, `src/lib/ai/providers/registry.ts`
- Test: `src/lib/ai/providers/adapters.test.ts`

**Interfaces:**

- Consumes: `ProviderAdapter`, `ProviderAuthError` (Task 1); `PROPOSAL_JSON_SCHEMA`, `DashboardProposal` (`@/lib/ai/proposal-schema`).
- Produces:
  - `anthropicAdapter`, `openaiAdapter`, `googleAdapter: ProviderAdapter`
  - `getAdapter(provider: AiProvider): ProviderAdapter` (`registry.ts`)

> **API note:** confirm method names against the installed SDK versions before finalizing (`@anthropic-ai/sdk@^0.105.0` uses `messages.parse` + `output_config.format`; `openai` uses `chat.completions.create` + `models.list`; `@google/genai` uses `models.generateContent` + `models.list`). Only Anthropic uses native schema enforcement; OpenAI/Gemini use JSON mode + the schema embedded in the prompt (the model output is repaired by `validateProposal` downstream, so schema drift is tolerated).

- [ ] **Step 1: Write the failing test** (mock all three SDKs — no network)

`src/lib/ai/providers/adapters.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderAuthError } from "@/lib/ai/providers/types";

// --- Anthropic SDK stub ---
const anthropicList = vi.fn();
const anthropicParse = vi.fn();
class AnthropicAuthError extends Error {}
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static AuthenticationError = AnthropicAuthError;
    models = { list: (...a: unknown[]) => anthropicList(...a) };
    messages = { parse: (...a: unknown[]) => anthropicParse(...a) };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: Anthropic };
});
vi.mock("@anthropic-ai/sdk/helpers/json-schema", () => ({
  jsonSchemaOutputFormat: () => ({}),
}));

// --- OpenAI SDK stub ---
const openaiList = vi.fn();
const openaiCreate = vi.fn();
class OpenAIAuthError extends Error {}
vi.mock("openai", () => {
  class OpenAI {
    static AuthenticationError = OpenAIAuthError;
    models = { list: (...a: unknown[]) => openaiList(...a) };
    chat = { completions: { create: (...a: unknown[]) => openaiCreate(...a) } };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { default: OpenAI };
});

// --- Google GenAI stub ---
const googleList = vi.fn();
const googleGenerate = vi.fn();
vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = {
      list: (...a: unknown[]) => googleList(...a),
      generateContent: (...a: unknown[]) => googleGenerate(...a),
    };
    constructor(readonly opts: { apiKey: string }) {}
  }
  return { GoogleGenAI };
});

import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { googleAdapter } from "@/lib/ai/providers/google";
import { getAdapter } from "@/lib/ai/providers/registry";

const PROPOSAL = { name: "X", widgets: [] };

beforeEach(() => {
  [
    anthropicList,
    anthropicParse,
    openaiList,
    openaiCreate,
    googleList,
    googleGenerate,
  ].forEach((m) => m.mockReset());
});

describe("registry", () => {
  it("maps each provider id to its adapter", () => {
    expect(getAdapter("anthropic").id).toBe("anthropic");
    expect(getAdapter("openai").id).toBe("openai");
    expect(getAdapter("google").id).toBe("google");
  });
});

describe("keyFormat", () => {
  it("rejects wrong prefixes and accepts right ones", () => {
    expect(anthropicAdapter.keyFormat.safeParse("sk-oops").success).toBe(false);
    expect(anthropicAdapter.keyFormat.safeParse("sk-ant-123").success).toBe(
      true,
    );
    expect(openaiAdapter.keyFormat.safeParse("nope").success).toBe(false);
    expect(openaiAdapter.keyFormat.safeParse("sk-123").success).toBe(true);
  });
});

describe("validateKey", () => {
  it("anthropic: resolves on success, throws ProviderAuthError on 401", async () => {
    anthropicList.mockResolvedValueOnce({});
    await expect(
      anthropicAdapter.validateKey("sk-ant-ok"),
    ).resolves.toBeUndefined();
    anthropicList.mockRejectedValueOnce(new AnthropicAuthError("bad"));
    await expect(
      anthropicAdapter.validateKey("sk-ant-bad"),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it("openai: throws ProviderAuthError on 401", async () => {
    openaiList.mockRejectedValueOnce(new OpenAIAuthError("bad"));
    await expect(openaiAdapter.validateKey("sk-bad")).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it("google: throws ProviderAuthError when the list call fails", async () => {
    googleList.mockImplementationOnce(() => {
      throw new Error("API key not valid");
    });
    await expect(googleAdapter.validateKey("AIza-bad")).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });
});

describe("generateProposal", () => {
  it("anthropic reads parsed_output", async () => {
    anthropicParse.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(PROPOSAL) }],
      parsed_output: PROPOSAL,
    });
    const res = await anthropicAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.name).toBe("X");
  });

  it("openai parses the JSON message content", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(PROPOSAL) } }],
    });
    const res = await openaiAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.name).toBe("X");
  });

  it("google parses response.text", async () => {
    googleGenerate.mockResolvedValueOnce({ text: JSON.stringify(PROPOSAL) });
    const res = await googleAdapter.generateProposal({
      apiKey: "k",
      system: "s",
      user: "u",
    });
    expect(res.name).toBe("X");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/ai/providers/adapters.test.ts`
Expected: FAIL — cannot resolve the adapter modules.

- [ ] **Step 3: Implement the Anthropic adapter**

`src/lib/ai/providers/anthropic.ts`:

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { z } from "zod";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

const MODEL = "claude-opus-4-8";

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: PROVIDER_CATALOG.anthropic.label,
  placeholder: PROVIDER_CATALOG.anthropic.placeholder,
  keyFormat: z
    .string()
    .trim()
    .startsWith("sk-ant-", "Anthropic keys start with sk-ant-")
    .max(300),
  defaultModel: MODEL,
  async validateKey(rawKey) {
    const client = new Anthropic({ apiKey: rawKey });
    try {
      await client.models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError)
        throw new ProviderAuthError("anthropic");
      throw e;
    }
  },
  async generateProposal({ apiKey, system, user }) {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: jsonSchemaOutputFormat(PROPOSAL_JSON_SCHEMA as never),
      },
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: user }],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    const parsed =
      (message as { parsed_output?: unknown }).parsed_output ??
      JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");
    return parsed as DashboardProposal;
  },
};
```

- [ ] **Step 4: Implement the OpenAI adapter**

`src/lib/ai/providers/openai.ts`:

```ts
import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

const MODEL = "gpt-4o";

// OpenAI structured outputs reject `oneOf` (used in PROPOSAL_JSON_SCHEMA), so we
// use plain JSON mode and embed the schema in the prompt. validateProposal()
// downstream repairs/drops any widget that drifts.
function withSchema(user: string): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    PROPOSAL_JSON_SCHEMA,
  )}`;
}

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: PROVIDER_CATALOG.openai.label,
  placeholder: PROVIDER_CATALOG.openai.placeholder,
  keyFormat: z
    .string()
    .trim()
    .startsWith("sk-", "OpenAI keys start with sk-")
    .max(300),
  defaultModel: MODEL,
  async validateKey(rawKey) {
    const client = new OpenAI({ apiKey: rawKey });
    try {
      await client.models.list();
    } catch (e) {
      if (e instanceof OpenAI.AuthenticationError)
        throw new ProviderAuthError("openai");
      throw e;
    }
  },
  async generateProposal({ apiKey, system, user }) {
    const client = new OpenAI({ apiKey });
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: withSchema(user) },
      ],
      response_format: { type: "json_object" },
    });
    return JSON.parse(
      res.choices[0]?.message.content ?? "{}",
    ) as DashboardProposal;
  },
};
```

- [ ] **Step 5: Implement the Google Gemini adapter**

`src/lib/ai/providers/google.ts`:

```ts
import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

const MODEL = "gemini-2.0-flash";

function withSchema(user: string): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    PROPOSAL_JSON_SCHEMA,
  )}`;
}

export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: PROVIDER_CATALOG.google.label,
  placeholder: PROVIDER_CATALOG.google.placeholder,
  keyFormat: z.string().trim().min(20).max(300),
  defaultModel: MODEL,
  async validateKey(rawKey) {
    const ai = new GoogleGenAI({ apiKey: rawKey });
    try {
      // Cheapest authenticated call — a bad key throws (400/403 "API key not valid").
      await ai.models.list({ config: { pageSize: 1 } });
    } catch {
      throw new ProviderAuthError("google");
    }
  },
  async generateProposal({ apiKey, system, user }) {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: withSchema(user) }] }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
      },
    });
    return JSON.parse(res.text ?? "{}") as DashboardProposal;
  },
};
```

- [ ] **Step 6: Implement the registry**

`src/lib/ai/providers/registry.ts`:

```ts
import "server-only";
import type { AiProvider } from "@/lib/ai/providers/catalog";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { openaiAdapter } from "@/lib/ai/providers/openai";
import { googleAdapter } from "@/lib/ai/providers/google";

const ADAPTERS: Record<AiProvider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
};

export function getAdapter(provider: AiProvider): ProviderAdapter {
  return ADAPTERS[provider];
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/ai/providers/adapters.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/providers/anthropic.ts src/lib/ai/providers/openai.ts src/lib/ai/providers/google.ts src/lib/ai/providers/registry.ts src/lib/ai/providers/adapters.test.ts
git commit -m "feat(ai): add anthropic, openai, and gemini provider adapters" -m "Each adapter validates a key with a live provider ping (mapping auth failures to ProviderAuthError) and generates a raw dashboard proposal. Anthropic uses native structured output; OpenAI and Gemini use JSON mode with the schema embedded in the prompt. A registry maps provider id to adapter." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Database migration — table, RLS, Vault functions

**Files:**

- Create: `supabase/migrations/20260706120000_user_ai_credentials.sql` (use a real timestamp `date +%Y%m%d%H%M%S`)
- Modify: `src/types/database.types.ts` (regenerated)

**Interfaces:**

- Produces (Postgres RPCs, consumed by Task 4):
  - `ai_credential_set(p_user uuid, p_provider text, p_secret text, p_hint text) returns void`
  - `ai_credential_clear(p_user uuid) returns void`
  - `ai_credential_get(p_user uuid) returns table(provider text, secret text)`
  - table `public.user_ai_credentials(user_id, provider, secret_id, key_hint, created_at, updated_at)` with self-select RLS.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260706120000_user_ai_credentials.sql`:

```sql
-- Per-user BYO AI provider key metadata.
-- The raw key lives ONLY in Supabase Vault; this table holds the vault secret id
-- plus a masked hint. All writes/decrypt go through the SECURITY DEFINER functions
-- below (service-role only). The authenticated role may only SELECT its own row.

create table public.user_ai_credentials (
  user_id    uuid not null references auth.users (id) on delete cascade,
  provider   text not null check (provider in ('anthropic', 'openai', 'google')),
  secret_id  uuid not null,
  key_hint   text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.user_ai_credentials enable row level security;

-- Read-only self access so the settings page can show provider + hint.
create policy "user_ai_credentials_select_own"
  on public.user_ai_credentials
  for select
  using (user_id = auth.uid());
-- No insert/update/delete policies: direct writes are default-denied.

-- Store a key: clear any existing credential for the user (one active provider),
-- create a Vault secret, and record its id + hint.
create or replace function public.ai_credential_set(
  p_user uuid, p_provider text, p_secret text, p_hint text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_old record;
  v_secret_id uuid;
begin
  for v_old in
    select secret_id from public.user_ai_credentials where user_id = p_user
  loop
    delete from vault.secrets where id = v_old.secret_id;
  end loop;
  delete from public.user_ai_credentials where user_id = p_user;

  v_secret_id := vault.create_secret(
    p_secret,
    'ai_key:' || p_user::text || ':' || p_provider,
    'BYO AI provider key'
  );

  insert into public.user_ai_credentials (user_id, provider, secret_id, key_hint)
  values (p_user, p_provider, v_secret_id, p_hint);
end;
$$;

-- Remove a user's key (Vault secret + row).
create or replace function public.ai_credential_clear(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_old record;
begin
  for v_old in
    select secret_id from public.user_ai_credentials where user_id = p_user
  loop
    delete from vault.secrets where id = v_old.secret_id;
  end loop;
  delete from public.user_ai_credentials where user_id = p_user;
end;
$$;

-- Decrypt a user's key. The ONLY decrypt path; service-role only.
create or replace function public.ai_credential_get(p_user uuid)
returns table (provider text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select c.provider, s.decrypted_secret
  from public.user_ai_credentials c
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.user_id = p_user;
$$;

revoke all on function public.ai_credential_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_credential_clear(uuid) from public, anon, authenticated;
revoke all on function public.ai_credential_get(uuid) from public, anon, authenticated;
grant execute on function public.ai_credential_set(uuid, text, text, text) to service_role;
grant execute on function public.ai_credential_clear(uuid) to service_role;
grant execute on function public.ai_credential_get(uuid) to service_role;
```

- [ ] **Step 2: Apply the migration to DEV**

Attempt via the `supabase-dev` MCP: `mcp__supabase-dev__apply_migration` with `name: "user_ai_credentials"` and the SQL above.

- **If the classifier denies it** (known repo constraint), STOP and ask the user to apply the SQL to the dev project themselves, then continue at Step 3. Do not fabricate success.

Verify the objects exist (works for either path):

```
mcp__supabase-dev__execute_sql:
  select to_regclass('public.user_ai_credentials') is not null as has_table,
         proname
  from pg_proc
  where proname in ('ai_credential_set','ai_credential_clear','ai_credential_get');
```

Expected: table present + three functions listed.

- [ ] **Step 3: Smoke-test the round trip (dev)**

```
mcp__supabase-dev__execute_sql:
  select public.ai_credential_set(
    '00000000-0000-0000-0000-000000000001', 'anthropic', 'sk-ant-smoke', 'sk-ant-…moke');
  select provider, secret from public.ai_credential_get(
    '00000000-0000-0000-0000-000000000001');
  select public.ai_credential_clear('00000000-0000-0000-0000-000000000001');
```

Expected: the `get` returns `('anthropic','sk-ant-smoke')`; `clear` leaves no row (`select count(*) from public.user_ai_credentials` → 0). If the first call errors on the FK to `auth.users`, use a real dev user id instead of the zero-uuid.

- [ ] **Step 4: Regenerate types (avoid the worktree-wipe gotcha)**

Do NOT run `pnpm db:types` inside the worktree (it isn't Supabase-linked and pipes its error INTO the types file). Instead:

```
mcp__supabase-dev__generate_typescript_types
```

Write the returned TypeScript to `src/types/database.types.ts` (overwrite), then format:

```bash
pnpm exec prettier --write src/types/database.types.ts
```

Confirm the file still contains the existing tables (e.g. `organizations`) plus the new `user_ai_credentials` and the three functions — i.e. it grew, not shrank.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no references to the new RPCs yet, but the regenerated file must compile).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260706120000_user_ai_credentials.sql src/types/database.types.ts
git commit -m "feat(db): add user_ai_credentials table and vault key functions" -m "Per-user BYO AI key metadata table with self-select RLS, plus three SECURITY DEFINER functions (set/clear/get) that store, remove, and decrypt the raw key in Supabase Vault. Decrypt is service-role only and never RLS-exposed. Regenerates database types." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Resolution + Server Actions

**Files:**

- Create: `src/lib/ai/credentials.ts`, `src/lib/ai/credentials-actions.ts`
- Test: `src/lib/ai/credentials.test.ts`, `src/lib/ai/credentials-actions.test.ts`

**Interfaces:**

- Consumes: `getAdapter` (Task 2), `ProviderAuthError` (Task 1), `AiNotConfiguredError` (`@/lib/ai/anthropic`), `createServiceClient` (`@/lib/supabase/service`), `requireUser` (`@/lib/auth/session`), the three RPCs (Task 3), `PROVIDER_CATALOG`/`AiProvider` (Task 1).
- Produces:
  - `resolveUserAdapter(): Promise<{ adapter: ProviderAdapter; apiKey: string }>` (throws `AiNotConfiguredError`)
  - `maskKey(rawKey: string): string`
  - `saveAiKey(input: { provider: AiProvider; key: string }): Promise<ActionResult<{ provider: AiProvider; hint: string }>>`
  - `removeAiKey(): Promise<ActionResult<Record<never, never>>>`
  - `getMyAiCredential(): Promise<{ provider: AiProvider; hint: string; updatedAt: string } | null>` (RLS self-read for the settings page)

- [ ] **Step 1: Write the failing test for `credentials.ts`**

`src/lib/ai/credentials.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AiNotConfiguredError } from "@/lib/ai/anthropic";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));

import { resolveUserAdapter, maskKey } from "@/lib/ai/credentials";

beforeEach(() => rpc.mockReset());

describe("maskKey", () => {
  it("shows a head and the last 4 chars", () => {
    expect(maskKey("sk-ant-abcdefAB12")).toBe("sk-ant-…AB12");
  });
});

describe("resolveUserAdapter", () => {
  it("throws AiNotConfiguredError when the user has no key", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveUserAdapter()).rejects.toBeInstanceOf(
      AiNotConfiguredError,
    );
  });

  it("returns the adapter + key for the stored provider", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ provider: "openai", secret: "sk-live" }],
      error: null,
    });
    const { adapter, apiKey } = await resolveUserAdapter();
    expect(adapter.id).toBe("openai");
    expect(apiKey).toBe("sk-live");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/ai/credentials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `credentials.ts`**

`src/lib/ai/credentials.ts`:

```ts
import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { AiNotConfiguredError } from "@/lib/ai/anthropic";
import { getAdapter } from "@/lib/ai/providers/registry";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AiProvider } from "@/lib/ai/providers/catalog";

/** The current user's provider adapter + decrypted key, or throws when unset. */
export async function resolveUserAdapter(): Promise<{
  adapter: ProviderAdapter;
  apiKey: string;
}> {
  const user = await requireUser();
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("ai_credential_get", {
    p_user: user.id,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new AiNotConfiguredError();
  return {
    adapter: getAdapter(row.provider as AiProvider),
    apiKey: row.secret,
  };
}

/** Masked preview safe to persist/show, e.g. "sk-ant-…AB12". */
export function maskKey(rawKey: string): string {
  const k = rawKey.trim();
  const last4 = k.slice(-4);
  const head = k.slice(0, Math.max(0, k.length - 4)).slice(0, 7);
  return `${head}…${last4}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/ai/credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the actions**

`src/lib/ai/credentials-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const validateKey = vi.fn();
vi.mock("@/lib/ai/providers/registry", () => ({
  getAdapter: () => ({
    id: "anthropic",
    keyFormat: {
      safeParse: (v: string) => ({ success: v.startsWith("sk-ant-") }),
    },
    validateKey: (...a: unknown[]) => validateKey(...a),
  }),
}));

import { ProviderAuthError } from "@/lib/ai/providers/types";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";

beforeEach(() => {
  rpc.mockReset();
  validateKey.mockReset();
});

describe("saveAiKey", () => {
  it("rejects a badly-formatted key without calling the provider or DB", async () => {
    const res = await saveAiKey({
      provider: "anthropic",
      key: "wrong-prefix-key",
    });
    expect(res.ok).toBe(false);
    expect(validateKey).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails cleanly when the provider rejects the key", async () => {
    validateKey.mockRejectedValueOnce(new ProviderAuthError("anthropic"));
    const res = await saveAiKey({ provider: "anthropic", key: "sk-ant-bad" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/rejected/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores a valid key and returns the hint, never the key", async () => {
    validateKey.mockResolvedValueOnce(undefined);
    rpc.mockResolvedValueOnce({ error: null });
    const res = await saveAiKey({
      provider: "anthropic",
      key: "sk-ant-abcdefAB12",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.hint).toBe("sk-ant-…AB12");
      expect(JSON.stringify(res.data)).not.toContain("abcdefAB12");
    }
    expect(rpc).toHaveBeenCalledWith(
      "ai_credential_set",
      expect.objectContaining({ p_user: "user-1", p_provider: "anthropic" }),
    );
  });
});

describe("removeAiKey", () => {
  it("clears the credential", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    const res = await removeAiKey();
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("ai_credential_clear", {
      p_user: "user-1",
    });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run src/lib/ai/credentials-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `credentials-actions.ts`**

`src/lib/ai/credentials-actions.ts`:

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getAdapter } from "@/lib/ai/providers/registry";
import { ProviderAuthError } from "@/lib/ai/providers/types";
import { maskKey } from "@/lib/ai/credentials";
import { PROVIDER_CATALOG, type AiProvider } from "@/lib/ai/providers/catalog";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

const saveSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  key: z.string().trim().min(10).max(300),
});

export async function saveAiKey(input: {
  provider: AiProvider;
  key: string;
}): Promise<ActionResult<{ provider: AiProvider; hint: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a valid API key.");
  const { provider, key } = parsed.data;

  const user = await requireUser();
  const adapter = getAdapter(provider);

  if (!adapter.keyFormat.safeParse(key).success)
    return fail(
      `That doesn't look like a ${PROVIDER_CATALOG[provider].label} key.`,
    );

  try {
    await adapter.validateKey(key);
  } catch (e) {
    if (e instanceof ProviderAuthError)
      return fail(
        `That key was rejected by ${PROVIDER_CATALOG[provider].label}.`,
      );
    return fail("Couldn't verify the key. Please try again.");
  }

  const hint = maskKey(key);
  const svc = createServiceClient();
  const { error } = await svc.rpc("ai_credential_set", {
    p_user: user.id,
    p_provider: provider,
    p_secret: key,
    p_hint: hint,
  });
  if (error) return fail("Couldn't save the key. Please try again.");

  revalidatePath("/settings");
  return { ok: true, data: { provider, hint } };
}

export async function removeAiKey(): Promise<
  ActionResult<Record<never, never>>
> {
  const user = await requireUser();
  const svc = createServiceClient();
  const { error } = await svc.rpc("ai_credential_clear", { p_user: user.id });
  if (error) return fail("Couldn't remove the key. Please try again.");
  revalidatePath("/settings");
  return { ok: true, data: {} };
}
```

- [ ] **Step 8: Add the settings self-read helper to `credentials.ts`**

Append to `src/lib/ai/credentials.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { AiProvider as AiProviderId } from "@/lib/ai/providers/catalog";

/** RLS self-read for the settings page: the user's single credential, or null. */
export async function getMyAiCredential(): Promise<{
  provider: AiProviderId;
  hint: string;
  updatedAt: string;
} | null> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_ai_credentials")
    .select("provider, key_hint, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    provider: data.provider as AiProviderId,
    hint: data.key_hint,
    updatedAt: data.updated_at,
  };
}
```

(Consolidate the `requireUser` import — it is already imported at the top; only add the `createClient` and type imports.)

- [ ] **Step 9: Run the action + credentials tests**

Run: `pnpm vitest run src/lib/ai/credentials.test.ts src/lib/ai/credentials-actions.test.ts`
Expected: PASS (all).

- [ ] **Step 10: Commit**

```bash
git add src/lib/ai/credentials.ts src/lib/ai/credentials-actions.ts src/lib/ai/credentials.test.ts src/lib/ai/credentials-actions.test.ts
git commit -m "feat(ai): resolve per-user provider client and add key server actions" -m "resolveUserAdapter() decrypts the current user's key via the service-role vault function and returns the matching adapter, throwing AiNotConfiguredError when unset. saveAiKey validates format, live-pings the provider, and stores via ai_credential_set (returning only a masked hint); removeAiKey clears it. getMyAiCredential is the RLS self-read for the settings page." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire the generator to the resolved adapter

**Files:**

- Modify: `src/lib/ai/generate.ts:49-85`
- Modify: `src/lib/ai/generate.test.ts`

**Interfaces:**

- Consumes: `resolveUserAdapter` (Task 4); `ProviderAdapter` (Task 1).
- Produces: `generateProposal(snap, opts?: { adapter?; apiKey?; feedback? })` — same return type `Promise<DashboardProposal>`; the client-injection seam changes from `{ client }` to `{ adapter, apiKey }`.

- [ ] **Step 1: Rewrite the generate test to inject an adapter stub**

Replace `src/lib/ai/generate.test.ts` body's `fakeClient` + the two `generateProposal` tests with an adapter stub:

```ts
import { describe, expect, it, vi } from "vitest";
import { generateProposal, buildSystemPrompt } from "@/lib/ai/generate";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 5,
  columns: [{ id: "c-status", name: "Status", kind: "status", options: [] }],
  columnStats: { "c-status": { fillRate: 1, distinctCount: 2 } },
  meta: { rowCount: 5, columnCount: 1, estimatedTokens: 50 },
};

function fakeAdapter(proposalJson: unknown) {
  const generate = vi.fn().mockResolvedValue(proposalJson);
  const adapter = { generateProposal: generate } as unknown as ProviderAdapter;
  return { adapter, generate };
}

describe("buildSystemPrompt", () => {
  it("teaches the widget vocabulary", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/number/);
    expect(p).toMatch(/chart/);
    expect(p).toMatch(/battery/);
    expect(p).toMatch(/list/);
    expect(p).toMatch(/config/i);
  });
});

describe("generateProposal", () => {
  it("returns the adapter's proposal object", async () => {
    const proposal = {
      name: "Sprint overview",
      widgets: [{ kind: "number", title: "Total", config: { agg: "count" } }],
    };
    const { adapter } = fakeAdapter(proposal);
    const res = await generateProposal(snap, { adapter, apiKey: "k" });
    expect(res.name).toBe("Sprint overview");
    expect(res.widgets).toHaveLength(1);
  });

  it("passes feedback into the user message when provided", async () => {
    const { adapter, generate } = fakeAdapter({ name: "x", widgets: [] });
    await generateProposal(snap, {
      adapter,
      apiKey: "k",
      feedback: "more charts please",
    });
    const call = generate.mock.calls[0][0];
    expect(call.user).toContain("more charts please");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/ai/generate.test.ts`
Expected: FAIL — `generateProposal` still expects `{ client }`; `call.user` undefined.

- [ ] **Step 3: Rewrite `generateProposal` in `generate.ts`**

Replace the imports at the top of `src/lib/ai/generate.ts` (drop the Anthropic + `getAnthropicClient` imports; keep `PROPOSAL_JSON_SCHEMA`/types only if still referenced — they are not after this change, so remove unused ones) and the function body:

```ts
import "server-only";
import type { DashboardProposal } from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import { resolveUserAdapter } from "@/lib/ai/credentials";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

// buildSystemPrompt() and buildUserPrompt() are unchanged (keep them as-is).

/**
 * Propose a dashboard for the given board snapshot using the current user's
 * configured AI provider. The adapter + key are dependency-injected in tests
 * (opts.adapter/opts.apiKey); production resolves them from the user's stored
 * credential via resolveUserAdapter().
 */
export async function generateProposal(
  snap: BoardSnapshot,
  opts: {
    adapter?: ProviderAdapter;
    apiKey?: string;
    feedback?: string;
  } = {},
): Promise<DashboardProposal> {
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

Keep `buildSystemPrompt` and `buildUserPrompt` exactly as they are. Remove now-unused imports (`Anthropic`, `jsonSchemaOutputFormat`, `getAnthropicClient`, `MODEL`, `PROPOSAL_JSON_SCHEMA`) to satisfy lint.

- [ ] **Step 4: Run the generate + actions tests**

Run: `pnpm vitest run src/lib/ai/generate.test.ts src/lib/ai/actions.test.ts`
Expected: PASS. `actions.test.ts` mocks `@/lib/ai/generate` wholesale, so it is unaffected; the "AI generation isn't configured." assertion still holds because `resolveUserAdapter` throws `AiNotConfiguredError` (mapped in `actions.ts:128`).

- [ ] **Step 5: Full unit run + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green (including `anthropic.test.ts`, which is untouched — `getAnthropicClient` remains).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/generate.ts src/lib/ai/generate.test.ts
git commit -m "refactor(ai): run dashboard generation through the resolved provider adapter" -m "generateProposal now resolves the current user's provider adapter + key (or takes an injected adapter in tests) instead of a hardcoded Anthropic client. The prompt builders and downstream validateProposal are unchanged; AiNotConfiguredError still surfaces the same user-facing message." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Settings "AI" card + provider form

**Files:**

- Create: `src/components/settings/AiProviderForm.tsx`
- Test: `src/components/settings/AiProviderForm.test.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

**Interfaces:**

- Consumes: `saveAiKey`, `removeAiKey` (Task 4); `ALL_PROVIDERS`, `PROVIDER_CATALOG`, `AiProvider` (Task 1); `getMyAiCredential` (Task 4); UI primitives `Button`, `Input`, `Label`, `Card*`.
- Produces: `<AiProviderForm initial={...} />`.

Follow the **pulse-ui** and **frontend-design** skills for styling (load them before writing the component). The form mirrors `ProfileForm`'s inline-message pattern (no toast primitive). Provider selection uses a small button-group toggle (no `select`/`radio-group` primitive exists). Dates use `toLocaleDateString("en-US", …)` (pinned locale — avoids the SSR hydration-mismatch gotcha).

- [ ] **Step 1: Write the failing component test**

`src/components/settings/AiProviderForm.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const saveAiKey = vi.fn();
const removeAiKey = vi.fn();
vi.mock("@/lib/ai/credentials-actions", () => ({
  saveAiKey: (...a: unknown[]) => saveAiKey(...a),
  removeAiKey: (...a: unknown[]) => removeAiKey(...a),
}));

import { AiProviderForm } from "@/components/settings/AiProviderForm";

beforeEach(() => {
  saveAiKey.mockReset();
  removeAiKey.mockReset();
});

describe("AiProviderForm", () => {
  it("shows a 'not configured' state and can save a key", async () => {
    saveAiKey.mockResolvedValueOnce({
      ok: true,
      data: { provider: "anthropic", hint: "sk-ant-…AB12" },
    });
    render(<AiProviderForm initial={null} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-ant-abcdefAB12" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(saveAiKey).toHaveBeenCalledWith({
        provider: "anthropic",
        key: "sk-ant-abcdefAB12",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/sk-ant-…AB12/)).toBeInTheDocument(),
    );
  });

  it("surfaces a rejected-key error inline", async () => {
    saveAiKey.mockResolvedValueOnce({
      ok: false,
      error: "That key was rejected by Anthropic (Claude).",
    });
    render(<AiProviderForm initial={null} />);
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-ant-bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(screen.getByText(/rejected by anthropic/i)).toBeInTheDocument(),
    );
  });

  it("renders the configured state from initial props", () => {
    render(
      <AiProviderForm
        initial={{
          provider: "openai",
          hint: "sk-…WXYZ",
          updatedAt: "2026-07-06T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/sk-…WXYZ/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/settings/AiProviderForm.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `AiProviderForm.tsx`**

`src/components/settings/AiProviderForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";
import {
  ALL_PROVIDERS,
  PROVIDER_CATALOG,
  type AiProvider,
} from "@/lib/ai/providers/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Configured = { provider: AiProvider; hint: string; updatedAt: string };

export function AiProviderForm({ initial }: { initial: Configured | null }) {
  const [configured, setConfigured] = useState<Configured | null>(initial);
  const [editing, setEditing] = useState(initial === null);
  const [provider, setProvider] = useState<AiProvider>(
    initial?.provider ?? "anthropic",
  );
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const res = await saveAiKey({ provider, key: key.trim() });
      if (res.ok) {
        setConfigured({
          provider: res.data.provider,
          hint: res.data.hint,
          updatedAt: new Date().toISOString(),
        });
        setKey("");
        setEditing(false);
      } else {
        setError(res.error);
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await removeAiKey();
      if (res.ok) {
        setConfigured(null);
        setEditing(true);
      } else {
        setError(res.error);
      }
    });
  }

  if (configured && !editing) {
    const updated = new Date(configured.updatedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    return (
      <div className="space-y-3">
        <div className="bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {PROVIDER_CATALOG[configured.provider].label}
            </p>
            <p className="text-muted-foreground text-xs">
              {configured.hint} · Updated {updated}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={remove}
              disabled={pending}
            >
              Remove
            </Button>
          </div>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Provider</Label>
        <div className="flex flex-wrap gap-2">
          {ALL_PROVIDERS.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={p.id === provider ? "default" : "outline"}
              onClick={() => {
                setProvider(p.id);
                setError(null);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ai-key">API key</Label>
        <Input
          id="ai-key"
          type="password"
          value={key}
          autoComplete="off"
          placeholder={PROVIDER_CATALOG[provider].placeholder}
          disabled={pending}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          Stored encrypted. Used only to run AI features for your account.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={pending || key.trim().length < 10}
          size="sm"
        >
          {pending ? "Verifying…" : "Save"}
        </Button>
        {configured && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setKey("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        )}
        {error && <span className="text-destructive text-xs">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/components/settings/AiProviderForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the "AI" card to the settings page**

In `src/app/(app)/settings/page.tsx`:

1. Add imports near the other settings imports:

```ts
import { AiProviderForm } from "@/components/settings/AiProviderForm";
import { getMyAiCredential } from "@/lib/ai/credentials";
```

2. Add the read to the first-paint block (alongside `myTimeZone`/`orgs` or the `members`/`myProfile` Promise.all — a single-row PK read):

```ts
const aiCredential = await getMyAiCredential();
```

3. Insert a new `Card` in the JSX right after the **Notifications** card (personal section):

```tsx
<Card>
  <CardHeader>
    <CardTitle>AI</CardTitle>
    <CardDescription>
      {aiCredential
        ? "Your AI provider key powers dashboard generation."
        : "Not configured — add a provider key to enable AI features."}
    </CardDescription>
  </CardHeader>
  <CardContent>
    <AiProviderForm initial={aiCredential} />
  </CardContent>
</Card>
```

The `"Not configured"` text in the description is what the component test's sibling copy relies on for discoverability; the form itself also renders its own states.

- [ ] **Step 6: Full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. (Watch the Next 16 build-only traps: no `searchParams` added here; the settings page is already dynamic.)

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/AiProviderForm.tsx src/components/settings/AiProviderForm.test.tsx "src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): add AI provider key card" -m "A personal Settings card lets a user pick Anthropic, OpenAI, or Google Gemini, paste their API key, and save it (verified live before storing). Configured state shows the active provider, a masked hint, and the updated date, with Replace and Remove. The key is never rendered back; the page reads status via the RLS self-select." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Execution DAG

- **T1** Catalog + contract + deps — deps: none.
- **T2** Adapters + registry — deps: T1.
- **T3** Migration + types — deps: none (independent).
- **T4** Resolve + actions — deps: T2, T3.
- **T5** Generator refactor — deps: T2, T4.
- **T6** Settings UI — deps: T4 (actions + status read).

**Parallel batches:**

- **Batch 1:** T1 ∥ T3 (no shared files — one in `src/lib/ai/providers/` + `package.json`, one in `supabase/` + `database.types.ts`).
- **Batch 2:** T2 (needs T1).
- **Batch 3:** T4 (needs T2, T3).
- **Batch 4:** T5 ∥ T6 (both need T4; they touch disjoint files — `generate.ts`/`generate.test.ts` vs `AiProviderForm.*`/`settings/page.tsx`).

**Critical path:** T1 → T2 → T4 → (T5 | T6). Small enough to build in one worktree sequentially; the parallelism is opportunistic.

## Final Integration Gate (before `finish-task.sh`)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green from the worktree.
- [ ] Manual smoke per the spec's "How to test": add an invalid then valid Anthropic key in Settings → AI, generate a dashboard, then repeat with OpenAI + Gemini, confirm switching replaces, and Remove returns to "not configured".
- [ ] `finish-task.sh` (rebases onto `develop`, re-gates, merges, cleans up). If it fails on the worktree-stale-deps gotcha after rebase (`openai`/`@google/genai` not in another session's tree — not applicable here since we added them, but if a build module-not-found appears, `pnpm install` then re-run).

## Self-Review

- **Spec coverage:** storage/data-model (T3) ✓; Vault + SECURITY DEFINER service-role-only decrypt (T3) ✓; RLS self-select (T3) ✓; provider abstraction + 3 adapters + registry (T1/T2) ✓; validate-on-save live ping (T2 adapters + T4 action) ✓; no env fallback / `AiNotConfiguredError` message preserved (T5, and `anthropic.test.ts` untouched) ✓; save/remove actions returning hint only (T4) ✓; settings UI card, one-active-provider, replace/remove (T6) ✓; perf budget = single PK read + client-state form (T6) ✓; testing matrix (every task) ✓; default models constants (T2) ✓; type regen caveat (T3 step 4) ✓; migration-apply classifier fallback (T3 step 2) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `ProviderAdapter`/`AiProvider`/`ProviderAuthError`/`PROVIDER_CATALOG`/`ALL_PROVIDERS`/`getAdapter`/`resolveUserAdapter`/`maskKey`/`saveAiKey`/`removeAiKey`/`getMyAiCredential` used with identical signatures across tasks; RPC names (`ai_credential_set`/`clear`/`get`) match between T3 SQL and T4 calls; generator seam `{ adapter, apiKey }` consistent between T5 impl and test.
