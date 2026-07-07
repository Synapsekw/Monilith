# Per-user BYO AI provider keys — design

**Date:** 2026-07-06
**Status:** Approved (brainstorming) → plan next
**Author:** Danijel Jovanovic (with Claude)

## Problem

AI dashboard generation is gated on a single server-wide `ANTHROPIC_API_KEY`
env var. When it is absent, the wizard shows **"AI generation isn't
configured."** (`src/lib/ai/actions.ts:129`, thrown as `AiNotConfiguredError`
in `src/lib/ai/anthropic.ts`). There is no in-app way for a user to enable AI
with their own key, and the feature is hard-locked to Anthropic.

We want users to enable AI themselves by pasting their **own** provider API key
in-app, choosing among **Anthropic, OpenAI, or Google Gemini**.

## Locked decisions

Confirmed during brainstorming (2026-07-06):

1. **Per-user** keys — each user brings their own; not org/workspace-scoped.
2. **Supabase Vault** for storage — raw key encrypted at rest, service-role-only
   decrypt, never in an RLS-readable column.
3. **No env fallback** — resolution is strictly per-user. When a user has no key,
   AI is off for them. (Behavior change: AI is off for everyone, including local
   dev, until a key is added in-app.)
4. **Validate on save** — a live provider ping verifies the key before storing;
   an invalid key is rejected inline.
5. **Multi-provider** — Anthropic, OpenAI, Google Gemini.
6. **One active provider at a time** — a user configures exactly one provider;
   saving a different provider replaces the previous credential.

### Relationship to the Phase 10 roadmap

This **deliberately diverges** from the roadmap's locked org-scoped BYO decision
(`vault/decisions/2026-07-05-decision-26-ai-platform-dual-billing.md`, which
scoped `resolveAiClient(orgId)` + org-level Vault keys + metering). This slice is
**per-user and un-metered** by explicit choice, to ship a small, useful feature
now. The future `resolveAiClient` gateway can layer a managed/org tier on top of
(or beside) this per-user path without reworking it. This spec is the source of
truth for the per-user path; the roadmap ADR remains the source of truth for the
managed platform.

## Non-goals (YAGNI)

- No org/workspace-shared keys, no managed (included-in-plan) tier.
- No usage metering, credits, or cost ledger.
- No multiple simultaneous keys per user (schema allows it; app enforces one).
- No change to the dashboard-gen **product** behavior, prompts, board snapshot,
  or `validateProposal` logic — only _which client_ runs the call.
- No new AI features (Ask Pulse, item assist, etc.) — those stay in Phase 10.

## Architecture

Four units, each independently testable:

1. **Storage** — `user_ai_credentials` table + Vault + `SECURITY DEFINER`
   functions (the security boundary).
2. **Provider abstraction** — `src/lib/ai/providers/` — one `ProviderAdapter`
   interface, three implementations, a registry.
3. **Resolution + mutations** — server-only resolve + Server Actions to
   save/remove a key.
4. **UI** — an "AI" card in personal Settings with a client form.

### 1. Storage & data model

New migration `supabase/migrations/<ts>_user_ai_credentials.sql`.

Table `public.user_ai_credentials`:

| column       | type          | notes                                                           |
| ------------ | ------------- | --------------------------------------------------------------- |
| `user_id`    | `uuid`        | `references auth.users(id) on delete cascade`; PK part          |
| `provider`   | `text`        | `check (provider in ('anthropic','openai','google'))`; PK part  |
| `secret_id`  | `uuid`        | `not null` — the `vault.secrets` id holding the raw key         |
| `key_hint`   | `text`        | `not null` — masked preview (e.g. `sk-ant-…AB12`); safe to show |
| `created_at` | `timestamptz` | `not null default now()`                                        |
| `updated_at` | `timestamptz` | `not null default now()` (maintained by `moddatetime` trigger)  |

- **Primary key** `(user_id, provider)`. The compound PK keeps the schema
  forward-compatible with real multi-provider keys, but the **app enforces a
  single row per user** (decision 6): a save clears any existing row(s) for the
  user first.
- The table **never** holds the raw key — only the Vault `secret_id` (a useless
  UUID without service-role Vault access) plus a masked hint.

**RLS:** `alter table ... enable row level security;`

- One policy: `select` where `user_id = auth.uid()`. This lets the settings page
  (RLS client) read its own row to render provider + hint + updated date.
- **No** insert/update/delete policies → direct writes from the authenticated
  role are default-denied. All writes flow through the service-role functions
  below.

**Vault access — three `SECURITY DEFINER` functions** (owned by the migration
role, i.e. postgres; `revoke execute on ... from public, authenticated;`
`grant execute on ... to service_role;`). This keeps decrypt **service-role-only
and never RLS-exposed**, honoring decision 2:

- `ai_credential_set(p_user uuid, p_provider text, p_secret text, p_hint text)
returns void`
  - Deletes any existing rows for `p_user` **and** their `vault.secrets`
    (`delete from vault.secrets where id = <old secret_id>`) so nothing orphans.
  - `select vault.create_secret(p_secret, 'ai_key:'||p_user||':'||p_provider,
'BYO AI key')` → new `secret_id`.
  - `insert into user_ai_credentials(user_id, provider, secret_id, key_hint)`.
- `ai_credential_clear(p_user uuid) returns void` — delete the user's
  `vault.secrets` row(s) + the table row(s).
- `ai_credential_get(p_user uuid) returns table(provider text, secret text)` —
  join the row to `vault.decrypted_secrets` and return `(provider,
decrypted_secret)`. The **only** decrypt path; called with the service client.

> **Application constraint (repo memory):** the agent may be blocked from applying
> migrations/DDL by the classifier. Plan: attempt `apply_migration` via the
> `supabase-dev` MCP against **dev**; if denied, hand the SQL to the user to apply,
> then regenerate types. **Type regen caveat:** `pnpm db:types` in an unlinked
> worktree wipes `database.types.ts` — use the MCP `generate_typescript_types` or
> run from the linked main checkout. Commit regenerated types in the same PR.

### 2. Provider abstraction (`src/lib/ai/providers/`)

The existing generator (`src/lib/ai/generate.ts`) is Anthropic-specific
(`client.messages.parse` + `MODEL = "claude-opus-4-8"`). It already builds a
provider-neutral **`PROPOSAL_JSON_SCHEMA`** (a hand-written JSON Schema `as
const` in `proposal-schema.ts`) and provider-neutral system/user prompts
(`buildSystemPrompt`, `buildUserPrompt`). We factor the provider-specific call
behind one interface.

```ts
// src/lib/ai/providers/types.ts
export type AiProvider = "anthropic" | "openai" | "google";

export interface ProviderAdapter {
  id: AiProvider;
  label: string; // "Anthropic (Claude)", "OpenAI", "Google Gemini"
  keyPrefixHint: string; // "sk-ant-…", "sk-…", "AIza…" (placeholder only)
  keyFormat: ZodString; // cheap shape check before the live ping
  defaultModel: string;
  validateKey(rawKey: string): Promise<void>; // throws on invalid
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
  }): Promise<DashboardProposal>; // → raw proposal
}
```

- `registry.ts`: `getAdapter(provider): ProviderAdapter` + `ALL_PROVIDERS` for
  the UI selector.
- **anthropic.ts** — moves today's `messages.parse` +
  `jsonSchemaOutputFormat(PROPOSAL_JSON_SCHEMA)` logic here; `defaultModel =
"claude-opus-4-8"`; `validateKey` = `client.models.list({ limit: 1 })`
  (no-token GET; 401 → throw).
- **openai.ts** — `openai` SDK; `chat.completions.parse` with a
  `response_format` JSON-schema (the same `PROPOSAL_JSON_SCHEMA`); `defaultModel
= "gpt-4o"`; `validateKey` = `client.models.list()`.
- **google.ts** — `@google/genai`; `generateContent` with `config:
{ responseMimeType: "application/json", responseSchema: PROPOSAL_JSON_SCHEMA }`;
  `defaultModel = "gemini-2.0-flash"`; `validateKey` = a minimal
  `models.list`/lightweight call; parse `response.text` as JSON.

All three return a raw `DashboardProposal`, which flows into the **unchanged**
`validateProposal(proposal, snapshot)`. Default models are single-source-of-truth
constants, trivially bumped.

**New dependencies:** `openai`, `@google/genai` (add with `pnpm add` in the
worktree).

**Errors:** each adapter maps auth failures (401/403) to a typed
`ProviderAuthError` (surfaced by `saveAiKey` as "That key was rejected by
<provider>."); other failures bubble as generic generation errors (already
mapped to "AI generation failed. Please try again." in `actions.ts`).

### 3. Resolution + mutations (`src/lib/ai/`)

- **`credentials.ts`** (`import "server-only"`):
  - `resolveUserAdapter(): Promise<{ adapter: ProviderAdapter; apiKey: string }>`
    — `requireUser()` → `createServiceClient()` → `rpc('ai_credential_get',
{ p_user: user.id })`. Empty → `throw new AiNotConfiguredError()` (unchanged
    message, so `actions.ts` maps it to the same user-facing string and existing
    tests still pass). Row → `{ getAdapter(provider), secret }`.
  - `maskKey(rawKey): string` — helper producing `key_hint`.
- **`credentials-actions.ts`** (`"use server"`):
  - `saveAiKey(input: { provider: AiProvider; key: string }):
Promise<ActionResult<{ provider; hint }>>` — Zod-validate provider + key
    format → `adapter.validateKey(key)` (live ping; typed error → `fail(...)`) →
    `createServiceClient().rpc('ai_credential_set', {...})` →
    `revalidatePath('/settings')`. Returns `{ provider, hint }`, **never the key**.
  - `removeAiKey(): Promise<ActionResult<Record<never, never>>>` — `requireUser`
    → `rpc('ai_credential_clear')` → `revalidatePath('/settings')`.
- **`generate.ts`** — replace `opts.client ?? getAnthropicClient()` +
  `messages.parse` with: resolve the adapter (or accept an injected adapter for
  tests) and call `adapter.generateProposal({ apiKey, system, user })`. The
  prompt builders stay in `generate.ts` and are passed in.

`getAnthropicClient()` and the `ANTHROPIC_API_KEY` env var are **retained**
(still unit-tested in `anthropic.test.ts`) but become unused by generation.
Flagged for later cleanup; not removed now to keep blast radius small.

### 4. UI — "AI" card in personal Settings

- **`src/app/(app)/settings/page.tsx`** — add a personal "AI" `Card` (near
  Preferences). RSC reads the single row via the RLS client:
  `supabase.from('user_ai_credentials').select('provider, key_hint,
updated_at').eq('user_id', user.id).maybeSingle()` and passes it to the form.
- **`src/components/settings/AiProviderForm.tsx`** (client, pulse-ui + shadcn,
  mirrors `ProfileForm`):
  - **Unset:** provider `Select` (three options) + password key `Input`
    (per-provider placeholder) + Save. Save shows **"Verifying…"** during the
    live ping; a rejected key renders an inline error; success shows the
    configured state.
  - **Set:** active provider label + masked hint (`sk-ant-…AB12`) + "Updated
    {date}", with **Replace** (reveals the form) and **Remove** (confirm →
    `removeAiKey`).
  - Dates use the pinned-locale rule (`toLocaleDateString("en-US", …)`) to avoid
    the SSR hydration mismatch gotcha.

## Data flow

**Save:** form → `saveAiKey({provider, key})` → format check → `adapter.validateKey`
(live ping to provider) → `ai_credential_set` (Vault create + row upsert, via
service role) → `revalidatePath('/settings')` → card re-renders "configured".

**Generate:** wizard → `generateDashboardProposal` → `generateProposal(snap)` →
`resolveUserAdapter()` (service-role `ai_credential_get` → decrypt) →
`adapter.generateProposal(...)` → `validateProposal` → widgets. No key → resolve
throws `AiNotConfiguredError` → "AI generation isn't configured."

## Error handling

| Situation                    | Behavior                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| No key configured            | `AiNotConfiguredError` → "AI generation isn't configured."         |
| Bad key format               | `saveAiKey` fails Zod → "That doesn't look like a <provider> key." |
| Key rejected by provider     | `ProviderAuthError` → "That key was rejected by <provider>."       |
| Provider/network error (gen) | existing "AI generation failed. Please try again."                 |
| Vault/DB error               | generic failure; nothing sensitive surfaced to the client          |

## Security

- Raw key **only** in Vault; table holds `secret_id` + masked hint. Key **never**
  returned to the client (save returns hint only).
- Decrypt is **service-role-only** via `SECURITY DEFINER` `ai_credential_get`;
  `vault.decrypted_secrets` is never granted to `authenticated`.
- RLS default-deny; only self-`select` on the metadata row.
- All key handling is `server-only`; live-ping + generation never run client-side.

## Performance & data-fetching budget (repo rule 5)

- **First paint:** +1 read on the settings page — a single-row PK lookup
  (`user_ai_credentials` by `user_id`). Bounded and indexed by definition.
- **Interactions:** the form is **client state**; provider switch / typing = 0
  server round-trips. Save/Remove change **server data** → Server Actions with
  scoped `revalidatePath('/settings')`. No in-page RSC refetch.

## Execution DAG (repo rule 6)

- **T1 Migration** — table + RLS + Vault functions. Deps: none.
- **T2 Provider abstraction** — types, registry, 3 adapters, deps added. Deps: none.
- **T3 Resolve + actions** — `credentials.ts`, `credentials-actions.ts`.
  Deps: T1 (functions), T2 (adapters for validate).
- **T4 Generator refactor** — `generate.ts` dispatches via adapter. Deps: T2.
- **T5 Settings UI** — page card + `AiProviderForm`. Deps: T3, T1 (status read).

**Batches:** B1 `{T1, T2}` ∥ → B2 `{T3, T4}` → B3 `{T5}`. **Critical path:**
T1 → T3 → T5. Small enough for one worktree; tests authored alongside each task.

## Testing (mandatory)

- **Unit** (Vitest, mocked SDKs — no network):
  - each adapter `validateKey`: 200 → resolves, 401 → throws `ProviderAuthError`;
    `keyFormat` rejects wrong prefixes.
  - `resolveUserAdapter`: no row → `AiNotConfiguredError`; row → correct adapter +
    key (mock service client + `ai_credential_get`).
  - `saveAiKey`: bad format → fail; `validateKey` throws → fail; happy → calls
    `ai_credential_set` with the right hint, returns hint (asserts key **not**
    returned). `removeAiKey`: calls `ai_credential_clear`.
  - `maskKey` masking.
- **Component:** `AiProviderForm` — unset vs configured render; submit calls
  `saveAiKey`; verifying + error states; provider switch updates placeholder.
- **Regression (must still pass):** `anthropic.test.ts` (`getAnthropicClient`
  retained), `actions.test.ts` + `AiDashboardWizard.test.tsx` (message unchanged).
- **DB:** RLS/functions verified with a post-apply SQL check (self-select
  allowed, cross-user denied, decrypt only via service role).

## Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before merge.

## How to test (manual, post-merge)

1. Pull `develop`, `pnpm install` (new deps), `pnpm dev`.
2. Go to **Settings** → new **AI** card. Confirm it reads "not configured".
3. Pick **Anthropic**, paste an invalid key (e.g. `sk-ant-bad`) → Save →
   expect an inline "rejected" error, nothing stored.
4. Paste a **valid** key → Save → card shows active provider + `…last4` hint +
   "Updated today".
5. Open a board with data → **Generate dashboard** → expect a real proposal
   (previously "AI generation isn't configured.").
6. Repeat step 4 with an **OpenAI** then a **Gemini** key → confirm generation
   works on each; confirm switching provider replaces the previous credential.
7. **Remove** the key → confirm AI returns to "not configured".
