# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution context:** per AGENTS.md working agreement #1, this is non-trivial multi-file work — start it with `scripts/start-task.sh mcp-server` (cuts `task/mcp-server` in `.claude/worktrees/mcp-server` off `develop`), then `EnterWorktree({ path: ".claude/worktrees/mcp-server" })` before dispatching subagents. Do not build this on `develop` directly.

**Goal:** Ship a hosted remote MCP server (`/api/mcp`) backed by a from-scratch OAuth 2.1 authorization server, so AI agents (Claude Desktop, claude.ai custom connectors) can authenticate as a real Monolith user and read/create/update items on boards through the same RLS policies the app already enforces.

**Architecture:** Two new subsystems inside the existing Next.js app. (1) `/api/oauth/{register,authorize,token}` + `/.well-known/oauth-authorization-server` — a minimal OAuth 2.1 AS with PKCE and dynamic client registration, reusing the existing Supabase-session login/consent UI. (2) `/api/mcp` — a Streamable HTTP MCP transport (`mcp-handler` wrapping `@modelcontextprotocol/sdk`) whose `verifyToken` callback resolves our OAuth access token to a user, then bridges to a **real, RLS-respecting Supabase session** for that user (minted via `admin.generateLink` + `verifyOtp`, refreshed per request, refresh token stored in Vault) before dispatching to a tool handler. No service-role client ever touches board/item data.

**Tech Stack:** Next.js 16 App Router route handlers, `mcp-handler` + `@modelcontextprotocol/sdk`, Supabase (Postgres + Auth + Vault), Zod, Vitest.

## Global Constraints

- Migrations are minted **only** via `scripts/new-migration.sh <slug>` — never hand-invent a version stamp. Apply to DEV via the `supabase-dev` MCP `apply_migration` with the same version+name as the committed file, then `pnpm db:types` and commit the regenerated types in the same task.
- RLS is default-deny; every new table gets `enable row level security` with **zero** policies for `anon`/`authenticated` (service-role-only access, mirroring `user_ai_credentials`) unless a task explicitly says otherwise.
- Every Vault-touching function is `security definer`, `set search_path = public, vault`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role` only — mirror `ai_credential_set/get/clear` exactly (`supabase/migrations/20260706164829_user_ai_credentials.sql`).
- Validate all external input with Zod at the boundary (route handlers, tool inputs). Centralize schemas in `src/lib/validations/`, `camelCase` + `Schema` suffix, per existing convention.
- Server Actions/queries elsewhere in the repo are untouched by this plan — MCP tool handlers implement their own thin logic against the bridged client rather than importing cookie-bound Server Actions (those call `createClient()` internally, which resolves to an unauthenticated client outside a real browser request — see Task 10's note).
- TypeScript strict, no `any` without justification. `database.types.ts` is generated — never hand-edited.
- Commit subjects: lowercase after `type(scope):` (commitlint rejects sentence-case) — verified repo-specific gotcha.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before `finish-task.sh`.

## Execution DAG

```
Batch A (no dependencies — run in parallel):
  Task 1  — Migration: oauth tables + vault bridge RPCs + RLS
  Task 2  — Crypto helpers: PKCE verify + opaque token gen/hash
  Task 3  — OAuth Zod validation schemas
  Task 8  — MCP rate-limit helper (touches only existing rate-limit infra)

Batch B (depends on Task 1, and on Task 3 where noted):
  Task 4  — Dynamic client registration route + OAuth discovery metadata      [needs 1, 3]
  Task 5  — Session bridge module (mint/refresh, vault-backed)                [needs 1]
  Task 6  — Consent page + approve action + /api/oauth/authorize              [needs 1, 3]
  Task 14 — Settings → Connected Apps (list/revoke)                          [needs 1]

Batch C (depends on Batch B):
  Task 7  — Token exchange route (/api/oauth/token)                          [needs 1, 2, 3, 5, 6]
  Task 9  — MCP route scaffold + auth context resolver                       [needs 1, 8]

Batch D (depends on Task 9 — the three tool tasks are mutually independent):
  Task 10 — Tools: list_boards, get_board
  Task 11 — Tools: search_items, get_item
  Task 12 — Tools: create_item, update_item

Batch E (depends on Task 7, 9, and at least one of Batch D):
  Task 13 — RLS integration test + manual end-to-end checklist
```

**Critical path:** Task 1 → Task 6 → Task 7 → Task 13 (4 deep), tied with Task 1 → Task 9 → Task 10 → Task 13. Tasks 7 and 9 do **not** depend on each other and should run concurrently in Batch C.

---

### Task 1: Migration — OAuth tables + Vault bridge RPCs

**Files:**

- Create: `supabase/migrations/<TIMESTAMP>_mcp_oauth.sql` (timestamp minted by `scripts/new-migration.sh mcp_oauth` — do not hand-type it)
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**

- Produces: tables `public.oauth_clients`, `public.oauth_codes`, `public.oauth_tokens`; functions `public.oauth_bridge_rotate_secret(p_old_secret_id uuid, p_secret text, p_name text) returns uuid`, `public.oauth_bridge_get_secret(p_secret_id uuid) returns text`. All consumed by Task 4 (clients), Task 5 (bridge functions), Task 6 (codes), Task 7 (tokens), Task 9 (token lookup), Task 14 (tokens listing).

- [ ] **Step 1: Run the migration minting script**

Run: `scripts/new-migration.sh mcp_oauth`
Expected: creates `supabase/migrations/<UTC-timestamp>_mcp_oauth.sql` with a boilerplate header and prints next steps.

- [ ] **Step 2: Write the migration SQL**

Replace the boilerplate body with:

```sql
-- What this migration does (MCP server — OAuth 2.1 authorization server):
--   1. oauth_clients   — dynamically registered MCP client apps.
--   2. oauth_codes     — short-lived PKCE authorization codes.
--   3. oauth_tokens    — issued access/refresh tokens (hashed at rest), each
--      optionally pointing at a Vault secret holding a bridged Supabase
--      refresh token for that user (see oauth_bridge_* functions below).
--   4. oauth_bridge_rotate_secret/get_secret — Vault-touching SECURITY
--      DEFINER helpers, service_role only, mirroring
--      ai_credential_set/get (20260706164829_user_ai_credentials.sql).
--   5. A before-delete trigger on oauth_tokens frees the Vault secret when a
--      token row is deleted/revoked-and-purged.
--   All three tables: RLS enabled, zero policies — service_role only, no
--   anon/authenticated grants (this data is never read/written by a logged
--   in browser session, only by the /api/oauth/* and /api/mcp route
--   handlers running under the service-role client).

create table public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;

create table public.oauth_codes (
  code text primary key,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oauth_codes enable row level security;
create index oauth_codes_expires_at_idx on public.oauth_codes (expires_at);

create table public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  bridge_secret_id uuid,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.oauth_tokens enable row level security;
create index oauth_tokens_user_id_idx on public.oauth_tokens (user_id) where revoked_at is null;
create index oauth_tokens_access_hash_idx on public.oauth_tokens (access_token_hash) where revoked_at is null;
create index oauth_tokens_refresh_hash_idx on public.oauth_tokens (refresh_token_hash) where revoked_at is null;

create or replace function public.oauth_bridge_rotate_secret(
  p_old_secret_id uuid,
  p_secret text,
  p_name text
) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare
  v_secret_id uuid;
begin
  if p_old_secret_id is not null then
    delete from vault.secrets where id = p_old_secret_id;
  end if;
  v_secret_id := vault.create_secret(p_secret, p_name, 'MCP OAuth bridge refresh token');
  return v_secret_id;
end;
$$;

create or replace function public.oauth_bridge_get_secret(p_secret_id uuid)
returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id;
$$;

create or replace function public.oauth_tokens_vault_cleanup()
returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  if old.bridge_secret_id is not null then
    delete from vault.secrets where id = old.bridge_secret_id;
  end if;
  return old;
end;
$$;

create trigger oauth_tokens_before_delete
  before delete on public.oauth_tokens
  for each row execute function public.oauth_tokens_vault_cleanup();

revoke all on function public.oauth_bridge_rotate_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function public.oauth_bridge_get_secret(uuid) from public, anon, authenticated;
grant execute on function public.oauth_bridge_rotate_secret(uuid, text, text) to service_role;
grant execute on function public.oauth_bridge_get_secret(uuid) to service_role;
```

- [ ] **Step 3: Apply to DEV via the supabase-dev MCP tool**

Use the `mcp__supabase-dev__apply_migration` tool with the **exact same version + name** as the committed filename (e.g. `20260724130500_mcp_oauth`), so the remote ledger matches. Then verify with `mcp__supabase-dev__list_migrations` that it appears.

- [ ] **Step 4: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` gains `oauth_clients`, `oauth_codes`, `oauth_tokens` table entries. If run from inside a task worktree, confirm the diff is additive only (per the known `db:types`-in-worktree gotcha, a failed/unlinked run can wipe the file — if the diff looks like a near-total deletion, `git checkout -- src/types/database.types.ts` and re-run linked to the right project).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "$(cat <<'EOF'
feat(mcp): oauth tables + vault bridge rpcs

Adds oauth_clients/oauth_codes/oauth_tokens (RLS default-deny,
service-role only) and the vault-touching bridge secret functions the
MCP OAuth flow uses to mint a real per-user Supabase session.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Crypto helpers — PKCE verify + opaque token gen/hash

**Files:**

- Create: `src/lib/mcp/oauth/crypto.ts`
- Test: `src/lib/mcp/oauth/crypto.test.ts`

**Interfaces:**

- Produces: `generateOpaqueToken(): string`, `hashToken(token: string): string`, `verifyPkce(verifier: string, challenge: string): boolean`. Consumed by Task 6 (challenge storage — no hashing needed there), Task 7 (token issuance + PKCE verify).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken, verifyPkce } from "./crypto";
import { createHash } from "node:crypto";

describe("generateOpaqueToken", () => {
  it("returns a high-entropy, url-safe string", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("hashToken", () => {
  it("is deterministic and does not return the input", () => {
    const token = "abc123";
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).not.toEqual(token);
  });
});

describe("verifyPkce", () => {
  it("accepts a correct S256 verifier/challenge pair", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a mismatched pair", () => {
    expect(verifyPkce("wrong-verifier", "not-a-real-challenge")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/mcp/oauth/crypto.test.ts`
Expected: FAIL — `crypto.ts` does not exist yet.

- [ ] **Step 3: Implement**

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A random, URL-safe, 256-bit opaque token (access or refresh token). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest — tokens are stored hashed, never in plaintext. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** RFC 7636 S256 PKCE check: base64url(sha256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/mcp/oauth/crypto.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/oauth/crypto.ts src/lib/mcp/oauth/crypto.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): pkce verify + opaque token crypto helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: OAuth Zod validation schemas

**Files:**

- Create: `src/lib/validations/mcp-oauth.ts`
- Test: `src/lib/validations/mcp-oauth.test.ts`

**Interfaces:**

- Produces: `registerClientSchema`, `authorizeRequestSchema`, `tokenExchangeSchema` (all `z.object`, `z.infer` types exported alongside). Consumed by Task 4, 6, 7.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  authorizeRequestSchema,
  registerClientSchema,
  tokenExchangeSchema,
} from "./mcp-oauth";

describe("registerClientSchema", () => {
  it("accepts a valid dynamic registration request", () => {
    const result = registerClientSchema.safeParse({
      client_name: "Claude Desktop",
      redirect_uris: ["https://claude.ai/api/mcp/oauth/callback"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty redirect_uris array", () => {
    const result = registerClientSchema.safeParse({
      client_name: "x",
      redirect_uris: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("authorizeRequestSchema", () => {
  it("requires S256 PKCE", () => {
    const base = {
      client_id: "abc",
      redirect_uri: "https://claude.ai/callback",
      response_type: "code",
      code_challenge: "x".repeat(43),
      code_challenge_method: "plain",
    };
    expect(authorizeRequestSchema.safeParse(base).success).toBe(false);
    expect(
      authorizeRequestSchema.safeParse({
        ...base,
        code_challenge_method: "S256",
      }).success,
    ).toBe(true);
  });
});

describe("tokenExchangeSchema", () => {
  it("accepts an authorization_code grant", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "authorization_code",
      code: "abc",
      client_id: "def",
      code_verifier: "x".repeat(43),
      redirect_uri: "https://claude.ai/callback",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a refresh_token grant", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "refresh_token",
      refresh_token: "abc",
      client_id: "def",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown grant_type", () => {
    const result = tokenExchangeSchema.safeParse({
      grant_type: "client_credentials",
      client_id: "def",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/validations/mcp-oauth.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";

export const registerClientSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
});
export type RegisterClientInput = z.infer<typeof registerClientSchema>;

export const authorizeRequestSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
});
export type AuthorizeRequestInput = z.infer<typeof authorizeRequestSchema>;

const authorizationCodeGrant = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  client_id: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  redirect_uri: z.string().url(),
});
const refreshTokenGrant = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
});
export const tokenExchangeSchema = z.discriminatedUnion("grant_type", [
  authorizationCodeGrant,
  refreshTokenGrant,
]);
export type TokenExchangeInput = z.infer<typeof tokenExchangeSchema>;
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/validations/mcp-oauth.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/mcp-oauth.ts src/lib/validations/mcp-oauth.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): oauth request validation schemas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Dynamic client registration + OAuth discovery metadata

**Files:**

- Create: `src/lib/mcp/oauth/client-store.ts`
- Create: `src/app/api/oauth/register/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Test: `src/lib/mcp/oauth/client-store.test.ts`

**Interfaces:**

- Consumes: `registerClientSchema` (Task 3), `Tables<"oauth_clients">` (Task 1).
- Produces: `registerOauthClient(input: RegisterClientInput): Promise<Tables<"oauth_clients">>`, `getOauthClient(clientId: string): Promise<Tables<"oauth_clients"> | null>` — both consumed by Task 6 (authorize) and Task 7 (token).

- [ ] **Step 1: Write the failing test for the store**

```ts
// src/lib/mcp/oauth/client-store.test.ts
import { describe, expect, it, vi } from "vitest";
import { registerOauthClient } from "./client-store";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: "x",
                client_id: "generated-id",
                client_name: "Claude Desktop",
                redirect_uris: ["https://claude.ai/callback"],
                created_at: "2026-07-24T00:00:00Z",
              },
              error: null,
            }),
        }),
      }),
    }),
  }),
}));

describe("registerOauthClient", () => {
  it("inserts a new client row and returns it", async () => {
    const client = await registerOauthClient({
      client_name: "Claude Desktop",
      redirect_uris: ["https://claude.ai/callback"],
    });
    expect(client.client_name).toBe("Claude Desktop");
    expect(client.client_id).toBe("generated-id");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run src/lib/mcp/oauth/client-store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the client store**

```ts
// src/lib/mcp/oauth/client-store.ts
import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database.types";
import type { RegisterClientInput } from "@/lib/validations/mcp-oauth";

export async function registerOauthClient(
  input: RegisterClientInput,
): Promise<Tables<"oauth_clients">> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({
      client_id: randomUUID(),
      client_name: input.client_name,
      redirect_uris: input.redirect_uris,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "Client registration failed.");
  return data;
}

export async function getOauthClient(
  clientId: string,
): Promise<Tables<"oauth_clients"> | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  return data;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run src/lib/mcp/oauth/client-store.test.ts`
Expected: PASS

- [ ] **Step 5: Write the registration route**

```ts
// src/app/api/oauth/register/route.ts
import { NextResponse } from "next/server";
import { registerClientSchema } from "@/lib/validations/mcp-oauth";
import { registerOauthClient } from "@/lib/mcp/oauth/client-store";

/**
 * RFC 7591 dynamic client registration — MCP clients (Claude Desktop,
 * claude.ai) call this once on first connect, no manual app setup.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: parsed.error.issues[0]?.message,
      },
      { status: 400 },
    );
  }
  const client = await registerOauthClient(parsed.data);
  return NextResponse.json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
```

- [ ] **Step 6: Write the discovery metadata route**

```ts
// src/app/.well-known/oauth-authorization-server/route.ts
import { NextResponse } from "next/server";
import { getPublicOrigin } from "mcp-handler";

/** RFC 8414 authorization server metadata — how MCP clients discover our endpoints. */
export async function GET(req: Request) {
  const origin = getPublicOrigin(req);
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/oauth/client-store.ts src/lib/mcp/oauth/client-store.test.ts src/app/api/oauth/register/route.ts "src/app/.well-known/oauth-authorization-server/route.ts"
git commit -m "$(cat <<'EOF'
feat(mcp): dynamic client registration + oauth discovery metadata

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Session bridge module

**Files:**

- Create: `src/lib/mcp/oauth/session-bridge.ts`
- Test: `src/lib/mcp/oauth/session-bridge.integration.test.ts`

**Interfaces:**

- Consumes: `oauth_bridge_rotate_secret`/`oauth_bridge_get_secret` RPCs (Task 1).
- Produces: `mintBridgeSecret(userId: string): Promise<string>` (returns the new `bridge_secret_id`, mints a real Supabase session and vault-stores its refresh token), `getBridgedClient(bridgeSecretId: string): Promise<{ client: SupabaseClient<Database>; newBridgeSecretId: string }>` (refreshes the stored session, rotates the vault secret since GoTrue invalidates the old refresh token on use, returns a request-scoped client built from the fresh access token plus the new secret id the caller must persist). Consumed by Task 7 (mint, at token issuance) and Task 9 (getBridgedClient, per MCP request).

- [ ] **Step 1: Write the failing integration test**

This test hits live Supabase (per the existing `*.integration.test.ts` convention — `describe.skipIf(!integrationTargetReady())`), provisioning a real test user the same way `src/lib/ai/user-ai-credentials.rls.integration.test.ts` does.

```ts
// src/lib/mcp/oauth/session-bridge.integration.test.ts
import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";
import { getBridgedClient, mintBridgeSecret } from "./session-bridge";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!integrationTargetReady())(
  "session-bridge: mint + refresh round-trip",
  () => {
    let admin: ReturnType<typeof createClient<Database>>;
    let userId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const email = `mcp-bridge-${randomUUID()}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      expect(error).toBeNull();
      userId = data.user!.id;
    }, 60_000);

    afterAll(async () => {
      await admin.auth.admin.deleteUser(userId);
    }, 60_000);

    it("mints a bridge secret that resolves to a real, RLS-scoped client for that user", async () => {
      const secretId = await mintBridgeSecret(userId);
      expect(secretId).toBeTruthy();

      const { client, newBridgeSecretId } = await getBridgedClient(secretId);
      expect(newBridgeSecretId).toBeTruthy();

      const {
        data: { user },
      } = await client.auth.getUser();
      expect(user?.id).toBe(userId);
    }, 30_000);
  },
);
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run src/lib/mcp/oauth/session-bridge.integration.test.ts --project=integration`
Expected: FAIL — module does not exist. (Requires live integration env vars per `src/test/integration-env.ts`; if unset it will `skipIf`-skip instead — that's fine for step 2's purpose since the import error surfaces before the skip check.)

- [ ] **Step 3: Implement**

```ts
// src/lib/mcp/oauth/session-bridge.ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Mints a real GoTrue session for `userId` (via generateLink + verifyOtp —
 * no email is sent, this is a server-side impersonation primitive gated
 * entirely behind the service-role key) and stores its refresh token in
 * Vault. Returns the new bridge_secret_id to persist on the oauth_tokens row.
 */
export async function mintBridgeSecret(userId: string): Promise<string> {
  const svc = createServiceClient();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: userRes, error: userErr } =
    await admin.auth.admin.getUserById(userId);
  if (userErr || !userRes.user?.email)
    throw new Error(userErr?.message ?? "User has no email; cannot bridge.");

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userRes.user.email,
    });
  if (linkErr || !linkData)
    throw new Error(linkErr?.message ?? "generateLink failed.");

  const anon = anonClient();
  const { data: sessionData, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !sessionData.session)
    throw new Error(verifyErr?.message ?? "verifyOtp failed.");

  const { data: secretId, error: rpcErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: null,
      p_secret: sessionData.session.refresh_token,
      p_name: `mcp_bridge:${userId}`,
    },
  );
  if (rpcErr || !secretId)
    throw new Error(rpcErr?.message ?? "Vault store failed.");
  return secretId;
}

/**
 * Refreshes the Supabase session stored behind `bridgeSecretId` and returns
 * a request-scoped client authenticated as that session's user. GoTrue
 * rotates refresh tokens on use, so the old Vault secret is replaced with
 * the new refresh token — callers MUST persist `newBridgeSecretId` back onto
 * the oauth_tokens row or the next request will fail.
 */
export async function getBridgedClient(
  bridgeSecretId: string,
): Promise<{ client: SupabaseClient<Database>; newBridgeSecretId: string }> {
  const svc = createServiceClient();
  const { data: refreshToken, error: getErr } = await typedRpc(
    svc,
    "oauth_bridge_get_secret",
    {
      p_secret_id: bridgeSecretId,
    },
  );
  if (getErr || !refreshToken)
    throw new Error(getErr?.message ?? "Bridge secret not found.");

  const anon = anonClient();
  const { data: refreshed, error: refreshErr } = await anon.auth.refreshSession(
    {
      refresh_token: refreshToken,
    },
  );
  if (refreshErr || !refreshed.session)
    throw new Error(refreshErr?.message ?? "Session refresh failed.");

  const { data: newSecretId, error: rotErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: bridgeSecretId,
      p_secret: refreshed.session.refresh_token,
      p_name: `mcp_bridge:${refreshed.session.user.id}`,
    },
  );
  if (rotErr || !newSecretId)
    throw new Error(rotErr?.message ?? "Vault rotate failed.");

  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${refreshed.session.access_token}` },
      },
    },
  );
  return { client, newBridgeSecretId: newSecretId };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run src/lib/mcp/oauth/session-bridge.integration.test.ts --project=integration`
Expected: PASS against the live dev Supabase project (skips cleanly if integration env vars are absent).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors. If `typedRpc` doesn't yet know about `oauth_bridge_rotate_secret`/`oauth_bridge_get_secret`, confirm `database.types.ts` was regenerated in Task 1 — `typedRpc`'s generic types derive from it directly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/oauth/session-bridge.ts src/lib/mcp/oauth/session-bridge.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): session bridge — mint and refresh a real per-user supabase session

Uses admin generateLink + verifyOtp to mint a genuine GoTrue session
for the OAuth-consenting user (no email sent), storing its refresh
token in Vault so every MCP request can build an RLS-respecting
client for that user instead of falling back to service-role.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Consent page + approve action + `/api/oauth/authorize`

**Files:**

- Create: `src/lib/mcp/oauth/code-store.ts`
- Create: `src/app/api/oauth/authorize/route.ts`
- Create: `src/app/oauth/consent/page.tsx`
- Create: `src/app/oauth/consent/actions.ts`
- Test: `src/lib/mcp/oauth/code-store.test.ts`

**Interfaces:**

- Consumes: `authorizeRequestSchema` (Task 3), `getOauthClient` (Task 4), `requireUser` (`src/lib/auth/session.ts`, existing).
- Produces: `createAuthorizationCode(input: { clientId: string; userId: string; redirectUri: string; codeChallenge: string }): Promise<string>` (returns the code), `consumeAuthorizationCode(code: string): Promise<Tables<"oauth_codes"> | null>` (marks consumed, returns null if missing/expired/already consumed). Consumed by Task 7.

- [ ] **Step 1: Write the failing test for the code store**

```ts
// src/lib/mcp/oauth/code-store.test.ts
import { describe, expect, it, vi } from "vitest";

const rows = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        rows.set(row.code as string, { ...row, consumed_at: null });
        return { error: null };
      },
      select: () => ({
        eq: (_col: string, code: string) => ({
          maybeSingle: () =>
            Promise.resolve({ data: rows.get(code) ?? null, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, code: string) => {
          const row = rows.get(code);
          if (row) rows.set(code, { ...row, ...patch });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

import {
  consumeAuthorizationCode,
  createAuthorizationCode,
} from "./code-store";

describe("createAuthorizationCode / consumeAuthorizationCode", () => {
  it("round-trips: created code can be consumed once", async () => {
    const code = await createAuthorizationCode({
      clientId: "client-1",
      userId: "user-1",
      redirectUri: "https://claude.ai/callback",
      codeChallenge: "x".repeat(43),
    });
    const row = await consumeAuthorizationCode(code);
    expect(row?.client_id).toBe("client-1");
    expect(row?.user_id).toBe("user-1");
  });

  it("returns null for an unknown code", async () => {
    const row = await consumeAuthorizationCode("does-not-exist");
    expect(row).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run src/lib/mcp/oauth/code-store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the code store**

```ts
// src/lib/mcp/oauth/code-store.ts
import "server-only";
import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database.types";

const CODE_TTL_SECONDS = 60;

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = randomBytes(24).toString("base64url");
  const supabase = createServiceClient();
  const { error } = await supabase.from("oauth_codes").insert({
    code,
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return code;
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<Tables<"oauth_codes"> | null> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("oauth_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (!row) return null;
  if (row.consumed_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  await supabase
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", code);
  return row;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run src/lib/mcp/oauth/code-store.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `/api/oauth/authorize`**

Validates the request and the client's registered `redirect_uri`, requires a Monolith login (redirects to `/login?next=...` if absent — mirroring how `requireUser()` already redirects elsewhere), then forwards to the consent page carrying the validated params.

```ts
// src/app/api/oauth/authorize/route.ts
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = authorizeRequestSchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) {
    return new Response(`invalid_request: ${parsed.error.issues[0]?.message}`, {
      status: 400,
    });
  }

  const client = await getOauthClient(parsed.data.client_id);
  if (!client || !client.redirect_uris.includes(parsed.data.redirect_uri)) {
    return new Response("invalid_client", { status: 400 });
  }

  const user = await getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const consentUrl = new URL("/oauth/consent", url.origin);
  consentUrl.search = url.search;
  redirect(consentUrl.toString());
}
```

- [ ] **Step 6: Write the consent page + approve action**

```ts
// src/app/oauth/consent/actions.ts
"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";
import { createAuthorizationCode } from "@/lib/mcp/oauth/code-store";

export async function approveConsent(formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData.entries());
  const parsed = authorizeRequestSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid authorization request.");

  const client = await getOauthClient(parsed.data.client_id);
  if (!client || !client.redirect_uris.includes(parsed.data.redirect_uri)) {
    throw new Error("Unknown client or redirect_uri.");
  }

  const code = await createAuthorizationCode({
    clientId: parsed.data.client_id,
    userId: user.id,
    redirectUri: parsed.data.redirect_uri,
    codeChallenge: parsed.data.code_challenge,
  });

  const redirectUrl = new URL(parsed.data.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (parsed.data.state)
    redirectUrl.searchParams.set("state", parsed.data.state);
  redirect(redirectUrl.toString());
}
```

```tsx
// src/app/oauth/consent/page.tsx
import { requireUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";
import { approveConsent } from "./actions";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const parsed = authorizeRequestSchema.safeParse(params);
  if (!parsed.success) {
    return (
      <p>Invalid authorization request: {parsed.error.issues[0]?.message}</p>
    );
  }
  const client = await getOauthClient(parsed.data.client_id);
  if (!client) return <p>Unknown client.</p>;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">
        {client.client_name} wants to access your Pulse account
      </h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {user.email}. This grants read and write access to your
        boards and items — exactly what you can see and do when logged in.
      </p>
      <form action={approveConsent} className="flex gap-3">
        {Object.entries(parsed.data).map(([key, value]) =>
          value === undefined ? null : (
            <input key={key} type="hidden" name={key} value={value} />
          ),
        )}
        <button
          type="submit"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
        >
          Allow access
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/oauth/code-store.ts src/lib/mcp/oauth/code-store.test.ts src/app/api/oauth/authorize/route.ts src/app/oauth/consent/
git commit -m "$(cat <<'EOF'
feat(mcp): oauth consent screen + authorization code issuance

Reuses the existing Pulse login (requireUser/getUser) for the login
step, then a one-time consent screen creates a short-lived PKCE code.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Token exchange route

**Files:**

- Create: `src/lib/mcp/oauth/token-store.ts`
- Create: `src/app/api/oauth/token/route.ts`
- Test: `src/lib/mcp/oauth/token-store.test.ts`

**Interfaces:**

- Consumes: `tokenExchangeSchema` (Task 3), `consumeAuthorizationCode` (Task 6), `mintBridgeSecret`/`getBridgedClient` (Task 5), `generateOpaqueToken`/`hashToken`/`verifyPkce` (Task 2).
- Produces: `issueTokenPair(input: { clientId: string; userId: string; bridgeSecretId: string }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>`, `rotateTokenPair(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null>`. Consumed by the route in this task; `lookupTokenByAccessToken` (also in this file) consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mcp/oauth/token-store.test.ts
import { describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: null };
      },
      select: () => ({
        eq: (col: string, val: string) => ({
          is: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: rows.find((r) => r[col] === val) ?? null,
                error: null,
              }),
          }),
          maybeSingle: () =>
            Promise.resolve({
              data: rows.find((r) => r[col] === val) ?? null,
              error: null,
            }),
        }),
      }),
    }),
  }),
}));

import { hashToken } from "./crypto";
import { issueTokenPair, lookupTokenByAccessToken } from "./token-store";

describe("issueTokenPair / lookupTokenByAccessToken", () => {
  it("issues a token pair that can be looked up by its hash", async () => {
    const issued = await issueTokenPair({
      clientId: "client-1",
      userId: "user-1",
      bridgeSecretId: "secret-1",
    });
    expect(issued.accessToken).toBeTruthy();
    expect(issued.expiresIn).toBeGreaterThan(0);

    const found = await lookupTokenByAccessToken(issued.accessToken);
    expect(found?.user_id).toBe("user-1");
    expect(found?.access_token_hash).toBe(hashToken(issued.accessToken));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run src/lib/mcp/oauth/token-store.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the token store**

```ts
// src/lib/mcp/oauth/token-store.ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database.types";
import { generateOpaqueToken, hashToken } from "./crypto";

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function issueTokenPair(input: {
  clientId: string;
  userId: string;
  bridgeSecretId: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const supabase = createServiceClient();
  const now = Date.now();
  const { error } = await supabase.from("oauth_tokens").insert({
    client_id: input.clientId,
    user_id: input.userId,
    access_token_hash: hashToken(accessToken),
    refresh_token_hash: hashToken(refreshToken),
    bridge_secret_id: input.bridgeSecretId,
    access_token_expires_at: new Date(
      now + ACCESS_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
    refresh_token_expires_at: new Date(
      now + REFRESH_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
  });
  if (error) throw new Error(error.message);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export async function lookupTokenByAccessToken(
  accessToken: string,
): Promise<Tables<"oauth_tokens"> | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("access_token_hash", hashToken(accessToken))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.access_token_expires_at).getTime() < Date.now())
    return null;
  return data;
}

export async function lookupTokenByRefreshToken(
  refreshToken: string,
): Promise<Tables<"oauth_tokens"> | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("refresh_token_hash", hashToken(refreshToken))
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.refresh_token_expires_at).getTime() < Date.now())
    return null;
  return data;
}

/** Rotates an access/refresh pair for an existing row (reuses the same bridge secret). */
export async function rotateTokenPair(
  row: Tables<"oauth_tokens">,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = generateOpaqueToken();
  const refreshToken = generateOpaqueToken();
  const supabase = createServiceClient();
  const now = Date.now();
  const { error } = await supabase
    .from("oauth_tokens")
    .update({
      access_token_hash: hashToken(accessToken),
      refresh_token_hash: hashToken(refreshToken),
      access_token_expires_at: new Date(
        now + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
      refresh_token_expires_at: new Date(
        now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Persists a rotated bridge_secret_id after getBridgedClient() rotates the underlying Vault secret. */
export async function updateBridgeSecretId(
  tokenId: string,
  newBridgeSecretId: string,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("oauth_tokens")
    .update({ bridge_secret_id: newBridgeSecretId })
    .eq("id", tokenId);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run src/lib/mcp/oauth/token-store.test.ts`
Expected: PASS

- [ ] **Step 5: Write the token exchange route**

```ts
// src/app/api/oauth/token/route.ts
import { NextResponse } from "next/server";
import { tokenExchangeSchema } from "@/lib/validations/mcp-oauth";
import { consumeAuthorizationCode } from "@/lib/mcp/oauth/code-store";
import { verifyPkce } from "@/lib/mcp/oauth/crypto";
import { mintBridgeSecret } from "@/lib/mcp/oauth/session-bridge";
import {
  issueTokenPair,
  lookupTokenByRefreshToken,
  rotateTokenPair,
} from "@/lib/mcp/oauth/token-store";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const parsed = tokenExchangeSchema.safeParse(
    Object.fromEntries(form.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: parsed.error.issues[0]?.message,
      },
      { status: 400 },
    );
  }

  if (parsed.data.grant_type === "authorization_code") {
    const codeRow = await consumeAuthorizationCode(parsed.data.code);
    if (!codeRow || codeRow.client_id !== parsed.data.client_id) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (!verifyPkce(parsed.data.code_verifier, codeRow.code_challenge)) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    const bridgeSecretId = await mintBridgeSecret(codeRow.user_id);
    const tokens = await issueTokenPair({
      clientId: parsed.data.client_id,
      userId: codeRow.user_id,
      bridgeSecretId,
    });
    return NextResponse.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "bearer",
      expires_in: tokens.expiresIn,
    });
  }

  // refresh_token grant
  const existing = await lookupTokenByRefreshToken(parsed.data.refresh_token);
  if (!existing || existing.client_id !== parsed.data.client_id) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }
  const tokens = await rotateTokenPair(existing);
  return NextResponse.json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: "bearer",
    expires_in: tokens.expiresIn,
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/oauth/token-store.ts src/lib/mcp/oauth/token-store.test.ts src/app/api/oauth/token/route.ts
git commit -m "$(cat <<'EOF'
feat(mcp): oauth token exchange (authorization_code + refresh_token)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: MCP rate-limit helper

**Files:**

- Create: `src/lib/rate-limit/mcp-rate-limit.ts`
- Test: `src/lib/rate-limit/mcp-rate-limit.test.ts`

**Interfaces:**

- Consumes: `check_rate_limit` RPC (existing, `supabase/migrations/2026-07-15-auth-rate-limiting`), `typedRpc` (`src/lib/supabase/typed-rpc.ts`, existing), `hashToken` (Task 2).
- Produces: `checkMcpRateLimit(accessToken: string): Promise<RateLimitDecision>`. Consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));
vi.mock("@/lib/supabase/typed-rpc", () => ({
  typedRpc: vi.fn(),
}));

import { typedRpc } from "@/lib/supabase/typed-rpc";
import { checkMcpRateLimit } from "./mcp-rate-limit";

describe("checkMcpRateLimit", () => {
  it("allows when the RPC reports allowed", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: true, retry_after: 0, remaining: 99 }],
      error: null,
    } as never);
    const decision = await checkMcpRateLimit("some-token");
    expect(decision).toEqual({ allowed: true });
  });

  it("denies with retryAfterSeconds when the RPC reports denied", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 42, remaining: 0 }],
      error: null,
    } as never);
    const decision = await checkMcpRateLimit("some-token");
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  it("fails open on an RPC error", async () => {
    vi.mocked(typedRpc).mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    } as never);
    const decision = await checkMcpRateLimit("some-token");
    expect(decision).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm vitest run src/lib/rate-limit/mcp-rate-limit.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/rate-limit/mcp-rate-limit.ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { hashToken } from "@/lib/mcp/oauth/crypto";
import type { RateLimitDecision } from "./auth-rate-limit";

const MCP_LIMIT = 120;
const MCP_WINDOW_SECONDS = 60;

/** Per-token fixed-window limit on /api/mcp, reusing the generic check_rate_limit RPC. */
export async function checkMcpRateLimit(
  accessToken: string,
): Promise<RateLimitDecision> {
  const supabase = createServiceClient();
  const { data, error } = await typedRpc(supabase, "check_rate_limit", {
    p_key: `mcp:token:${hashToken(accessToken)}`,
    p_limit: MCP_LIMIT,
    p_window_seconds: MCP_WINDOW_SECONDS,
  });
  if (error || !data?.[0]) return { allowed: true };
  const row = data[0];
  return row.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: row.retry_after };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm vitest run src/lib/rate-limit/mcp-rate-limit.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit/mcp-rate-limit.ts src/lib/rate-limit/mcp-rate-limit.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): per-token rate limit on the mcp route

Reuses the existing check_rate_limit RPC (fixed-window, service-role
only) that already backs auth rate limiting — no new infra.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: MCP route scaffold + auth context resolver

**Files:**

- Modify: `package.json` (add `mcp-handler`, `@modelcontextprotocol/sdk`)
- Create: `src/lib/mcp/context.ts`
- Create: `src/lib/mcp/tools/register.ts` (empty registry, filled in by Tasks 10-12)
- Create: `src/app/api/mcp/route.ts`
- Test: `src/lib/mcp/context.test.ts`

**Interfaces:**

- Consumes: `lookupTokenByAccessToken` (Task 7), `getBridgedClient`/`updateBridgeSecretId` (Task 5/7), `checkMcpRateLimit` (Task 8).
- Produces: `resolveMcpAuth(req: Request, bearerToken?: string): Promise<AuthInfo | undefined>` (the `verifyToken` callback for `withMcpAuth`), `getRequestClient(auth: AuthInfo): Promise<SupabaseClient<Database>>` (per-call bridged client resolver). Consumed by Tasks 10-12 (every tool handler calls `getRequestClient(req.auth!)`).

- [ ] **Step 1: Add dependencies**

Run: `pnpm add mcp-handler@^1.1.0 @modelcontextprotocol/sdk@^1.29.0`
Expected: both added to `dependencies` in `package.json`; `zod@^4.4.3` (already present) satisfies the SDK's `zod: "^3.25 || ^4.0"` peer range, no conflict expected. If pnpm prints a peer-dependency warning for `@cfworker/json-schema`, run `pnpm add @cfworker/json-schema` — it's only warned about, not required, unless `pnpm typecheck`/`pnpm build` actually fails on it.

- [ ] **Step 2: Write the failing test for the auth resolver**

```ts
// src/lib/mcp/context.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mcp/oauth/token-store", () => ({
  lookupTokenByAccessToken: vi.fn(),
}));
vi.mock("@/lib/rate-limit/mcp-rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { lookupTokenByAccessToken } from "@/lib/mcp/oauth/token-store";
import { resolveMcpAuth } from "./context";

describe("resolveMcpAuth", () => {
  it("returns undefined for a missing bearer token", async () => {
    const result = await resolveMcpAuth(
      new Request("https://x/api/mcp"),
      undefined,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for a token with no matching row", async () => {
    vi.mocked(lookupTokenByAccessToken).mockResolvedValueOnce(null);
    const result = await resolveMcpAuth(
      new Request("https://x/api/mcp"),
      "bad-token",
    );
    expect(result).toBeUndefined();
  });

  it("returns AuthInfo carrying the resolved user id for a valid token", async () => {
    vi.mocked(lookupTokenByAccessToken).mockResolvedValueOnce({
      id: "row-1",
      user_id: "user-1",
      client_id: "client-1",
      bridge_secret_id: "secret-1",
    } as never);
    const result = await resolveMcpAuth(
      new Request("https://x/api/mcp"),
      "good-token",
    );
    expect(result?.token).toBe("good-token");
    expect(result?.clientId).toBe("client-1");
    expect(result?.extra?.userId).toBe("user-1");
    expect(result?.extra?.tokenRowId).toBe("row-1");
    expect(result?.extra?.bridgeSecretId).toBe("secret-1");
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm vitest run src/lib/mcp/context.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the auth/context module**

```ts
// src/lib/mcp/context.ts
import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { lookupTokenByAccessToken } from "@/lib/mcp/oauth/token-store";
import { getBridgedClient } from "@/lib/mcp/oauth/session-bridge";
import { updateBridgeSecretId } from "@/lib/mcp/oauth/token-store";
import { checkMcpRateLimit } from "@/lib/rate-limit/mcp-rate-limit";

/** withMcpAuth's verifyToken callback. Resolves our opaque bearer token to a user. */
export async function resolveMcpAuth(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const row = await lookupTokenByAccessToken(bearerToken);
  if (!row) return undefined;
  return {
    token: bearerToken,
    clientId: row.client_id,
    scopes: [],
    extra: {
      userId: row.user_id,
      tokenRowId: row.id,
      bridgeSecretId: row.bridge_secret_id,
    },
  };
}

/**
 * Per-tool-call: enforces the rate limit, then resolves the RLS-respecting
 * bridged client for the authenticated MCP connection. Every tool handler
 * calls this first and runs its Supabase calls through the returned client
 * — never the service-role client.
 */
export async function getRequestClient(
  auth: AuthInfo,
): Promise<SupabaseClient<Database>> {
  const decision = await checkMcpRateLimit(auth.token);
  if (!decision.allowed) {
    throw new Error(
      `Rate limited — retry after ${decision.retryAfterSeconds}s.`,
    );
  }
  const bridgeSecretId = auth.extra?.bridgeSecretId as string | undefined;
  const tokenRowId = auth.extra?.tokenRowId as string | undefined;
  if (!bridgeSecretId || !tokenRowId)
    throw new Error("Malformed auth context.");

  const { client, newBridgeSecretId } = await getBridgedClient(bridgeSecretId);
  await updateBridgeSecretId(tokenRowId, newBridgeSecretId);
  return client;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm vitest run src/lib/mcp/context.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Create the empty tool registry**

```ts
// src/lib/mcp/tools/register.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Registers every MCP tool onto the server instance. Filled in by Tasks 10-12. */
export function registerTools(_server: McpServer): void {
  // Tasks 10-12 append registerTool(...) calls here.
}
```

- [ ] **Step 7: Write the MCP route**

```ts
// src/app/api/mcp/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveMcpAuth } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools/register";

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "pulse", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 },
);

const authedHandler = withMcpAuth(handler, resolveMcpAuth, { required: true });

export { authedHandler as GET, authedHandler as POST };
```

- [ ] **Step 8: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors. If the `AuthInfo` import path or shape differs from what's assumed above, `tsc` will point at the exact mismatch in `src/lib/mcp/context.ts` — fix the import/shape to match the installed `@modelcontextprotocol/sdk/server/auth/types.d.ts` before proceeding.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/mcp/context.ts src/lib/mcp/context.test.ts src/lib/mcp/tools/register.ts src/app/api/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat(mcp): mcp route scaffold + bearer auth context resolver

Wires mcp-handler's Streamable HTTP transport behind withMcpAuth,
resolving our OAuth bearer token to a rate-limited, RLS-bridged
Supabase client per request. No tools registered yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Tools — `list_boards`, `get_board`

**Files:**

- Create: `src/lib/mcp/tools/list-boards.ts`
- Create: `src/lib/mcp/tools/get-board.ts`
- Modify: `src/lib/mcp/tools/register.ts`
- Test: `src/lib/mcp/tools/list-boards.test.ts`, `src/lib/mcp/tools/get-board.test.ts`

**Interfaces:**

- Consumes: `getRequestClient` (Task 9).
- Produces: `registerListBoardsTool(server, getClient)`, `registerGetBoardTool(server, getClient)` — both take a `getClient: () => Promise<SupabaseClient<Database>>` closure so they're testable without a live `AuthInfo`. Called from `register.ts`.

**Note on why these don't call existing Server Actions:** `src/lib/boards/queries.ts` functions (e.g. a `listMyBoards`-style query) call `createClient()` from `src/lib/supabase/server.ts` internally, which reads Next's `cookies()` — an MCP request carries no Monolith session cookie, only our bearer token. Reusing those functions here would silently build an **unauthenticated** client and break under RLS rather than use the bridged client Task 9 already resolved. Tool handlers instead run the same shape of query directly against the client `getRequestClient` hands them.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/tools/list-boards.test.ts
import { describe, expect, it, vi } from "vitest";
import { listBoardsHandler } from "./list-boards";

describe("listBoardsHandler", () => {
  it("returns boards with org name, ordered by name", async () => {
    const client = {
      from: () => ({
        select: () => ({
          is: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "b1",
                    name: "Roadmap",
                    org_id: "o1",
                    organizations: { name: "Acme" },
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    };
    const result = await listBoardsHandler(async () => client as never);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed).toEqual([
      { id: "b1", name: "Roadmap", orgId: "o1", orgName: "Acme" },
    ]);
  });
});
```

```ts
// src/lib/mcp/tools/get-board.test.ts
import { describe, expect, it } from "vitest";
import { getBoardHandler } from "./get-board";

describe("getBoardHandler", () => {
  it("returns board metadata plus its columns and groups", async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => {
            if (table === "boards") {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "b1", name: "Roadmap" },
                    error: null,
                  }),
              };
            }
            if (table === "columns") {
              return {
                order: () =>
                  Promise.resolve({
                    data: [{ id: "c1", name: "Status", kind: "status" }],
                    error: null,
                  }),
              };
            }
            return {
              is: () => ({
                order: () =>
                  Promise.resolve({
                    data: [{ id: "g1", name: "To Do" }],
                    error: null,
                  }),
              }),
            };
          },
        }),
      }),
    };
    const result = await getBoardHandler(async () => client as never, {
      boardId: "b1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.board.id).toBe("b1");
    expect(parsed.columns).toEqual([
      { id: "c1", name: "Status", kind: "status" },
    ]);
    expect(parsed.groups).toEqual([{ id: "g1", name: "To Do" }]);
  });

  it("returns an isError result when the board is not found", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    };
    const result = await getBoardHandler(async () => client as never, {
      boardId: "missing",
    });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/mcp/tools/list-boards.test.ts src/lib/mcp/tools/get-board.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `list_boards`**

```ts
// src/lib/mcp/tools/list-boards.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

export async function listBoardsHandler(getClient: GetClient) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, org_id, organizations(name)")
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  const boards = (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    orgId: b.org_id,
    orgName: (b.organizations as { name: string } | null)?.name ?? null,
  }));
  return { content: [{ type: "text" as const, text: JSON.stringify(boards) }] };
}

export function registerListBoardsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "List boards visible to the connected user.",
      inputSchema: {},
    },
    async () => listBoardsHandler(getClient),
  );
}
```

- [ ] **Step 4: Implement `get_board`**

```ts
// src/lib/mcp/tools/get-board.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const getBoardInput = { boardId: z.string().uuid() };

export async function getBoardHandler(
  getClient: GetClient,
  input: { boardId: string },
) {
  const supabase = await getClient();
  const { data: board, error: boardErr } = await supabase
    .from("boards")
    .select("id, name, description")
    .eq("id", input.boardId)
    .maybeSingle();
  if (boardErr || !board) {
    return {
      content: [{ type: "text" as const, text: "Board not found." }],
      isError: true,
    };
  }
  const [{ data: columns }, { data: groups }] = await Promise.all([
    supabase
      .from("columns")
      .select("id, name, kind")
      .eq("board_id", input.boardId)
      .order("position", { ascending: true }),
    supabase
      .from("groups")
      .select("id, name")
      .eq("board_id", input.boardId)
      .is("archived_at", null)
      .order("position", { ascending: true }),
  ]);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          board,
          columns: columns ?? [],
          groups: groups ?? [],
        }),
      },
    ],
  };
}

export function registerGetBoardTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description: "Get a board's metadata, columns, and groups.",
      inputSchema: getBoardInput,
    },
    async (input) => getBoardHandler(getClient, input),
  );
}
```

- [ ] **Step 5: Wire into the registry**

```ts
// src/lib/mcp/tools/register.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRequestClient } from "@/lib/mcp/context";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerListBoardsTool } from "./list-boards";
import { registerGetBoardTool } from "./get-board";

/** Registers every MCP tool onto the server instance, closing over the request's auth. */
export function registerTools(server: McpServer, auth: AuthInfo): void {
  const getClient = () => getRequestClient(auth);
  registerListBoardsTool(server, getClient);
  registerGetBoardTool(server, getClient);
}
```

Note this changes `registerTools`'s signature from Task 9 (it now needs `auth`, since each tool must resolve the bridged client for _this specific request's_ user, not a shared one). Update `src/app/api/mcp/route.ts`'s `createMcpHandler` callback accordingly — `mcp-handler`'s `initializeServer` callback does not receive the request directly, so thread `auth` through by reading it off `req.auth` inside a wrapper. Replace Task 9 Step 7's route with:

```ts
// src/app/api/mcp/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveMcpAuth } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools/register";

async function baseHandler(req: Request) {
  const handler = createMcpHandler(
    (server) => {
      if (req.auth) registerTools(server, req.auth);
    },
    { serverInfo: { name: "pulse", version: "1.0.0" } },
    { basePath: "/api", disableSse: true, maxDuration: 60 },
  );
  return handler(req);
}

const authedHandler = withMcpAuth(baseHandler, resolveMcpAuth, {
  required: true,
});

export { authedHandler as GET, authedHandler as POST };
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/list-boards.test.ts src/lib/mcp/tools/get-board.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/tools/list-boards.ts src/lib/mcp/tools/list-boards.test.ts src/lib/mcp/tools/get-board.ts src/lib/mcp/tools/get-board.test.ts src/lib/mcp/tools/register.ts src/app/api/mcp/route.ts
git commit -m "$(cat <<'EOF'
feat(mcp): list_boards and get_board tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Tools — `search_items`, `get_item`

**Files:**

- Create: `src/lib/mcp/tools/search-items.ts`
- Create: `src/lib/mcp/tools/get-item.ts`
- Modify: `src/lib/mcp/tools/register.ts`
- Test: `src/lib/mcp/tools/search-items.test.ts`, `src/lib/mcp/tools/get-item.test.ts`

**Interfaces:**

- Consumes: `GetClient` type (Task 10).
- Produces: `registerSearchItemsTool`, `registerGetItemTool`. Called from `register.ts`.

**Note on data shape:** per repo research, item "fields" beyond `name` live entirely in `cell_values` (keyed by `item_id, column_id`), not on the `items` row — there is no nested `cell_values` array on an item. `get_item` therefore returns the item row plus a flat `cellValues` array the caller matches to `get_board`'s `columns` by `columnId`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/tools/search-items.test.ts
import { describe, expect, it } from "vitest";
import { searchItemsHandler } from "./search-items";

describe("searchItemsHandler", () => {
  it("returns bounded, name-matching items for a board", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              ilike: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        { id: "i1", name: "Fix login bug", group_id: "g1" },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    const result = await searchItemsHandler(async () => client as never, {
      boardId: "b1",
      query: "login",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed).toEqual([
      { id: "i1", name: "Fix login bug", groupId: "g1" },
    ]);
  });
});
```

```ts
// src/lib/mcp/tools/get-item.test.ts
import { describe, expect, it } from "vitest";
import { getItemHandler } from "./get-item";

describe("getItemHandler", () => {
  it("returns the item plus its cell values", async () => {
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string) => {
            if (table === "items") {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "i1", name: "Fix login bug", group_id: "g1" },
                    error: null,
                  }),
              };
            }
            return Promise.resolve({
              data: [{ column_id: "c1", value: { text: "In progress" } }],
              error: null,
            });
          },
        }),
      }),
    };
    const result = await getItemHandler(async () => client as never, {
      itemId: "i1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.item.id).toBe("i1");
    expect(parsed.cellValues).toEqual([
      { columnId: "c1", value: { text: "In progress" } },
    ]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/mcp/tools/search-items.test.ts src/lib/mcp/tools/get-item.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `search_items`**

```ts
// src/lib/mcp/tools/search-items.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const SEARCH_LIMIT = 50;

const searchItemsInput = {
  boardId: z.string().uuid(),
  query: z.string().trim().min(1).max(100),
};

export async function searchItemsHandler(
  getClient: GetClient,
  input: { boardId: string; query: string },
) {
  const supabase = await getClient();
  const { data, error } = await supabase
    .from("items")
    .select("id, name, group_id")
    .eq("board_id", input.boardId)
    .is("archived_at", null)
    .ilike("name", `%${input.query}%`)
    .order("position", { ascending: true })
    .limit(SEARCH_LIMIT);
  if (error) {
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
  const items = (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    groupId: i.group_id,
  }));
  return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
}

export function registerSearchItemsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description: `Search items by name within a board (bounded to ${SEARCH_LIMIT} results).`,
      inputSchema: searchItemsInput,
    },
    async (input) => searchItemsHandler(getClient, input),
  );
}
```

- [ ] **Step 4: Implement `get_item`**

```ts
// src/lib/mcp/tools/get-item.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const getItemInput = { itemId: z.string().uuid() };

export async function getItemHandler(
  getClient: GetClient,
  input: { itemId: string },
) {
  const supabase = await getClient();
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("id, name, group_id, board_id, position")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemErr || !item) {
    return {
      content: [{ type: "text" as const, text: "Item not found." }],
      isError: true,
    };
  }
  const { data: cells } = await supabase
    .from("cell_values")
    .select("column_id, value")
    .eq("item_id", input.itemId);
  const cellValues = (cells ?? []).map((c) => ({
    columnId: c.column_id,
    value: c.value,
  }));
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ item, cellValues }) },
    ],
  };
}

export function registerGetItemTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description: "Get an item's fields and cell values.",
      inputSchema: getItemInput,
    },
    async (input) => getItemHandler(getClient, input),
  );
}
```

- [ ] **Step 5: Wire into the registry**

```ts
// src/lib/mcp/tools/register.ts — add alongside the Task 10 imports/calls
import { registerSearchItemsTool } from "./search-items";
import { registerGetItemTool } from "./get-item";

// inside registerTools(server, auth):
registerSearchItemsTool(server, getClient);
registerGetItemTool(server, getClient);
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/search-items.test.ts src/lib/mcp/tools/get-item.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/tools/search-items.ts src/lib/mcp/tools/search-items.test.ts src/lib/mcp/tools/get-item.ts src/lib/mcp/tools/get-item.test.ts src/lib/mcp/tools/register.ts
git commit -m "$(cat <<'EOF'
feat(mcp): search_items and get_item tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Tools — `create_item`, `update_item`

**Files:**

- Create: `src/lib/mcp/tools/create-item.ts`
- Create: `src/lib/mcp/tools/update-item.ts`
- Modify: `src/lib/mcp/tools/register.ts`
- Test: `src/lib/mcp/tools/create-item.test.ts`, `src/lib/mcp/tools/update-item.test.ts`

**Interfaces:**

- Consumes: `GetClient` type (Task 10), `cellValueSchema` (`src/lib/validations/boards.ts`, existing — reused directly, not reimplemented).
- Produces: `registerCreateItemTool`, `registerUpdateItemTool`.

**Scope reminder (design non-goal):** no delete tool. `update_item` covers rename + cell-value writes only — it does not move/reorder/archive an item (those remain app-only operations).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/tools/create-item.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/validations/boards", () => ({
  cellValueSchema: () => ({
    safeParse: (v: unknown) => ({ success: true, data: v }),
  }),
}));

import { createItemHandler } from "./create-item";

describe("createItemHandler", () => {
  it("creates an item via RPC, then writes any provided field values", async () => {
    const upserted: unknown[] = [];
    const client = {
      rpc: (_fn: string, _args: unknown) =>
        Promise.resolve({
          data: { id: "i1", name: "New task", group_id: "g1" },
          error: null,
        }),
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === "columns"
                    ? { org_id: "o1", board_id: "b1", kind: "text" }
                    : { board_id: "b1" },
                error: null,
              }),
          }),
        }),
        upsert: (row: unknown) => {
          upserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await createItemHandler(async () => client as never, {
      groupId: "g1",
      name: "New task",
      fields: [{ columnId: "c1", value: { text: "hello" } }],
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.item.id).toBe("i1");
    expect(upserted).toHaveLength(1);
  });
});
```

```ts
// src/lib/mcp/tools/update-item.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/validations/boards", () => ({
  cellValueSchema: () => ({
    safeParse: (v: unknown) => ({ success: true, data: v }),
  }),
}));

import { updateItemHandler } from "./update-item";

describe("updateItemHandler", () => {
  it("renames the item and writes provided field values", async () => {
    const upserted: unknown[] = [];
    const client = {
      from: (table: string) => ({
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { board_id: "b1" }, error: null }),
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === "columns"
                    ? { org_id: "o1", board_id: "b1", kind: "text" }
                    : { board_id: "b1" },
                error: null,
              }),
          }),
        }),
        upsert: (row: unknown) => {
          upserted.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    };
    const result = await updateItemHandler(async () => client as never, {
      itemId: "i1",
      name: "Renamed",
      fields: [{ columnId: "c1", value: { text: "hello" } }],
    });
    expect(result.isError).toBeUndefined();
    expect(upserted).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/mcp/tools/create-item.test.ts src/lib/mcp/tools/update-item.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `create_item`**

```ts
// src/lib/mcp/tools/create-item.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";

type GetClient = () => Promise<SupabaseClient<Database>>;

const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
const createItemInput = {
  groupId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  fields: z.array(fieldInput).max(50).optional(),
};

/** Writes one cell value, mirroring the guard logic in src/lib/boards/actions/cell.ts's upsertCell. */
async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: { columnId: string; value: Record<string, unknown> },
): Promise<string | null> {
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", field.columnId)
    .maybeSingle();
  if (colErr || !column) return `Column ${field.columnId} not found.`;

  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr || !item) return "Item not found.";
  if (item.board_id !== column.board_id)
    return "Item and column belong to different boards.";

  const valueParsed = cellValueSchema(column.kind).safeParse(field.value);
  if (!valueParsed.success)
    return valueParsed.error.issues[0]?.message ?? "Invalid value.";

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: itemId,
      column_id: field.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  return error?.message ?? null;
}

export async function createItemHandler(
  getClient: GetClient,
  input: {
    groupId: string;
    name: string;
    fields?: { columnId: string; value: Record<string, unknown> }[];
  },
) {
  const supabase = await getClient();
  const { data: item, error } = await supabase.rpc("create_item", {
    p_group_id: input.groupId,
    p_name: input.name,
  });
  if (error || !item) {
    return {
      content: [
        {
          type: "text" as const,
          text: error?.message ?? "Could not create item.",
        },
      ],
      isError: true,
    };
  }
  const fieldErrors: string[] = [];
  for (const field of input.fields ?? []) {
    const err = await writeCellValue(supabase, item.id, field);
    if (err) fieldErrors.push(`${field.columnId}: ${err}`);
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ item, fieldErrors }) },
    ],
    isError:
      fieldErrors.length > 0 &&
      fieldErrors.length === (input.fields?.length ?? 0),
  };
}

export function registerCreateItemTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create a new item in a group, optionally setting initial field values.",
      inputSchema: createItemInput,
    },
    async (input) => createItemHandler(getClient, input),
  );
}
```

- [ ] **Step 4: Implement `update_item`**

```ts
// src/lib/mcp/tools/update-item.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { cellValueSchema } from "@/lib/validations/boards";
import type { Json } from "@/types/database.types";

type GetClient = () => Promise<SupabaseClient<Database>>;

const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
const updateItemInput = {
  itemId: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  fields: z.array(fieldInput).max(50).optional(),
};

async function writeCellValue(
  supabase: SupabaseClient<Database>,
  itemId: string,
  field: { columnId: string; value: Record<string, unknown> },
): Promise<string | null> {
  const { data: column, error: colErr } = await supabase
    .from("columns")
    .select("org_id, board_id, kind")
    .eq("id", field.columnId)
    .maybeSingle();
  if (colErr || !column) return `Column ${field.columnId} not found.`;

  const valueParsed = cellValueSchema(column.kind).safeParse(field.value);
  if (!valueParsed.success)
    return valueParsed.error.issues[0]?.message ?? "Invalid value.";

  const { error } = await supabase.from("cell_values").upsert(
    {
      org_id: column.org_id,
      board_id: column.board_id,
      item_id: itemId,
      column_id: field.columnId,
      value: valueParsed.data as Json,
    },
    { onConflict: "item_id,column_id" },
  );
  return error?.message ?? null;
}

export async function updateItemHandler(
  getClient: GetClient,
  input: {
    itemId: string;
    name?: string;
    fields?: { columnId: string; value: Record<string, unknown> }[];
  },
) {
  const supabase = await getClient();

  if (input.name) {
    const { data, error } = await supabase
      .from("items")
      .update({ name: input.name })
      .eq("id", input.itemId)
      .select("board_id")
      .maybeSingle();
    if (error || !data) {
      return {
        content: [
          { type: "text" as const, text: error?.message ?? "Item not found." },
        ],
        isError: true,
      };
    }
  }

  const fieldErrors: string[] = [];
  for (const field of input.fields ?? []) {
    const err = await writeCellValue(supabase, input.itemId, field);
    if (err) fieldErrors.push(`${field.columnId}: ${err}`);
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ itemId: input.itemId, fieldErrors }),
      },
    ],
    isError:
      fieldErrors.length > 0 &&
      fieldErrors.length === (input.fields?.length ?? 0),
  };
}

export function registerUpdateItemTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Rename an item and/or update its field values. No delete/archive/move.",
      inputSchema: updateItemInput,
    },
    async (input) => updateItemHandler(getClient, input),
  );
}
```

- [ ] **Step 5: Wire into the registry**

```ts
// src/lib/mcp/tools/register.ts — add alongside the Task 10/11 imports/calls
import { registerCreateItemTool } from "./create-item";
import { registerUpdateItemTool } from "./update-item";

// inside registerTools(server, auth):
registerCreateItemTool(server, getClient);
registerUpdateItemTool(server, getClient);
```

- [ ] **Step 6: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/create-item.test.ts src/lib/mcp/tools/update-item.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Typecheck + full unit suite**

Run: `pnpm typecheck && pnpm vitest run --project=unit`
Expected: no errors, all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/tools/create-item.ts src/lib/mcp/tools/create-item.test.ts src/lib/mcp/tools/update-item.ts src/lib/mcp/tools/update-item.test.ts src/lib/mcp/tools/register.ts
git commit -m "$(cat <<'EOF'
feat(mcp): create_item and update_item tools

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: RLS integration test + manual end-to-end checklist

**Files:**

- Create: `src/lib/mcp/tools/cross-org-access.rls.integration.test.ts`
- Modify: this plan's parent design doc is unaffected; this task also produces a manual checklist (below) for the user to run once merged.

**Interfaces:**

- Consumes: the full OAuth + MCP stack (Tasks 1-12) end-to-end.

- [ ] **Step 1: Write the RLS proof integration test**

Proves the bridged client — not an app-level check standing in for one — is what blocks cross-org reads. Follows the exact provisioning pattern from `src/lib/ai/user-ai-credentials.rls.integration.test.ts`.

```ts
// src/lib/mcp/tools/cross-org-access.rls.integration.test.ts
import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";
import {
  mintBridgeSecret,
  getBridgedClient,
} from "@/lib/mcp/oauth/session-bridge";
import { listBoardsHandler } from "./list-boards";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!integrationTargetReady())(
  "MCP bridged client: RLS still applies (list_boards never crosses orgs)",
  () => {
    let admin: ReturnType<typeof createClient<Database>>;
    let orgAUserId: string;
    let orgBUserId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const a = await admin.auth.admin.createUser({
        email: `mcp-org-a-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      const b = await admin.auth.admin.createUser({
        email: `mcp-org-b-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      orgAUserId = a.data.user!.id;
      orgBUserId = b.data.user!.id;
    }, 60_000);

    afterAll(async () => {
      await admin.auth.admin.deleteUser(orgAUserId);
      await admin.auth.admin.deleteUser(orgBUserId);
    }, 60_000);

    it("a bridged client for user A never returns boards belonging to org-B-only user B", async () => {
      const secretId = await mintBridgeSecret(orgAUserId);
      const { client } = await getBridgedClient(secretId);
      const result = await listBoardsHandler(async () => client);
      const boards = JSON.parse(result.content[0].text as string) as {
        orgId: string;
      }[];
      // orgBUserId has no membership in any org orgAUserId belongs to (both are
      // fresh, org-less test users), so this must be empty — proving the
      // bridged client is RLS-scoped, not merely filtered in application code.
      expect(boards).toEqual([]);
      void orgBUserId;
    }, 30_000);
  },
);
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/lib/mcp/tools/cross-org-access.rls.integration.test.ts --project=integration`
Expected: PASS against the live dev Supabase project.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/tools/cross-org-access.rls.integration.test.ts
git commit -m "$(cat <<'EOF'
test(mcp): prove rls still applies through the bridged client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Manual end-to-end checklist (run once, after merge to develop)**

1. Deploy `develop` to a preview URL (or run `pnpm dev` locally with a public tunnel — Claude Desktop needs a reachable HTTPS URL for `/api/oauth/*` and `/api/mcp`).
2. In Claude Desktop or claude.ai, add a custom connector pointing at `https://<host>/api/mcp`.
3. Confirm the client completes dynamic registration, redirects to `/api/oauth/authorize` → your existing Monolith login (if not already signed in) → the consent screen — approve it.
4. Confirm the connector shows as connected and lists the 6 tools.
5. Ask the agent to list your boards — confirm it returns exactly the boards you can see in the app.
6. Ask it to create an item on a specific board/group — confirm the item appears in the Monolith UI immediately.
7. Ask it to update that item's name and one field — confirm both changes appear in the UI.
8. Confirm there is **no** delete/archive tool offered — the agent should be unable to remove the item it created.

---

### Task 14: Settings → Connected Apps (list + revoke)

**Why this is in the plan though not in the original tool list:** shipping OAuth token issuance with no revocation path is a real gap — if a token leaks there's currently no way for the user to cut it off short of a database operation. This is the smallest addition that closes it: a read-only list + a revoke button, reusing the existing Settings page conventions.

**Files:**

- Create: `src/lib/mcp/oauth/connections.ts` (read-only fetch, no `"use server"` — called directly from the RSC page, mirroring `src/lib/ai/credentials.ts`'s `getMyAiCredential`)
- Create: `src/lib/mcp/oauth/connections-actions.ts` (`"use server"`, mirroring `src/lib/ai/credentials-actions.ts`)
- Create: `src/components/settings/ConnectedAppsSection.tsx`
- Modify: `src/app/(app)/settings/page.tsx` (add a new `Card` section, alongside the existing AI-settings `Card` at line ~150)
- Test: `src/lib/mcp/oauth/connections.test.ts`, `src/lib/mcp/oauth/connections-actions.test.ts`

**Confirmed against the actual repo structure:** Settings is a single page (`src/app/(app)/settings/page.tsx`), not nested routes — it composes `Card` sections server-side (`getMyAiCredential()`, `getOrgAiSettings()`, etc. all called directly in the page, then passed to form components like `AiProviderForm`). This task follows that exact pattern instead of inventing a `/settings/connections` route.

**Interfaces:**

- Consumes: `requireUser` (existing), `oauth_tokens`/`oauth_clients` tables (Task 1).
- Produces: `listMyConnections(): Promise<{ id: string; clientName: string; createdAt: string }[]>` (in `connections.ts`), `revokeConnectionAction(tokenId: string): Promise<ActionResult>` (in `connections-actions.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/mcp/oauth/connections.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "t1",
                    created_at: "2026-07-24T00:00:00Z",
                    oauth_clients: { client_name: "Claude Desktop" },
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}));

import { listMyConnections } from "./connections";

describe("listMyConnections", () => {
  it("returns the caller's active connections with client name", async () => {
    const result = await listMyConnections();
    expect(result).toEqual([
      {
        id: "t1",
        clientName: "Claude Desktop",
        createdAt: "2026-07-24T00:00:00Z",
      },
    ]);
  });
});
```

```ts
// src/lib/mcp/oauth/connections-actions.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }),
  }),
}));

import { revokeConnectionAction } from "./connections-actions";

describe("revokeConnectionAction", () => {
  it("marks a token revoked and returns ok", async () => {
    const result = await revokeConnectionAction("t1");
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run src/lib/mcp/oauth/connections.test.ts src/lib/mcp/oauth/connections-actions.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the read-only fetch**

```ts
// src/lib/mcp/oauth/connections.ts
import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export async function listMyConnections(): Promise<
  { id: string; clientName: string; createdAt: string }[]
> {
  const user = await requireUser();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("id, created_at, oauth_clients(client_name)")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    clientName:
      (row.oauth_clients as { client_name: string } | null)?.client_name ??
      "Unknown app",
    createdAt: row.created_at,
  }));
}
```

- [ ] **Step 4: Implement the revoke Server Action**

```ts
// src/lib/mcp/oauth/connections-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { fail, type ActionResult } from "@/lib/actions/result";

export async function revokeConnectionAction(
  tokenId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("user_id", user.id);
  if (error) return fail(error.message);
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `pnpm vitest run src/lib/mcp/oauth/connections.test.ts src/lib/mcp/oauth/connections-actions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Add the section component and wire it into the Settings page**

```tsx
// src/components/settings/ConnectedAppsSection.tsx
"use client";

import { revokeConnectionAction } from "@/lib/mcp/oauth/connections-actions";

type Connection = { id: string; clientName: string; createdAt: string };

export function ConnectedAppsSection({
  connections,
}: {
  connections: Connection[];
}) {
  if (connections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No apps connected via MCP yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {connections.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <span>{c.clientName}</span>
          <form action={revokeConnectionAction.bind(null, c.id)}>
            <button type="submit" className="text-destructive text-sm">
              Revoke
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
```

In `src/app/(app)/settings/page.tsx`: add `listMyConnections` to the existing `Promise.all([...])` fetch block (around line 36, alongside `getMyAiCredential()`/`getOrgAiSettings()`), then add a new `Card` alongside the existing AI-settings `Card` (around line 150):

```tsx
import { listMyConnections } from "@/lib/mcp/oauth/connections";
import { ConnectedAppsSection } from "@/components/settings/ConnectedAppsSection";

// added to the existing Promise.all(...) destructure:
const [/* ...existing entries..., */ connections] = await Promise.all([
  /* ...existing calls..., */
  listMyConnections(),
]);

// added as a new Card, alongside the existing AI-settings Card:
<Card>
  <CardHeader>
    <CardTitle>Connected apps</CardTitle>
  </CardHeader>
  <CardContent>
    <ConnectedAppsSection connections={connections} />
  </CardContent>
</Card>;
```

This is a merge into an existing file with existing imports/JSX structure the implementer must match exactly — read the current `src/app/(app)/settings/page.tsx` in full before editing, rather than guessing at surrounding context from this excerpt.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/oauth/connections.ts src/lib/mcp/oauth/connections.test.ts src/lib/mcp/oauth/connections-actions.ts src/lib/mcp/oauth/connections-actions.test.ts src/components/settings/ConnectedAppsSection.tsx "src/app/(app)/settings/page.tsx"
git commit -m "$(cat <<'EOF'
feat(mcp): settings connected-apps list + revoke

Minimal revocation path for a leaked or unwanted MCP token — a new
Card on the existing Settings page listing active connections with a
revoke button, mirroring the AI-settings section's structure.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final gate (after all tasks)

- [ ] Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` from the worktree root — all green.
- [ ] Run `scripts/finish-task.sh` from inside the worktree to rebase onto latest `develop`, re-gate, merge, and clean up.
- [ ] Hand the user the manual end-to-end checklist from Task 13, Step 5.
