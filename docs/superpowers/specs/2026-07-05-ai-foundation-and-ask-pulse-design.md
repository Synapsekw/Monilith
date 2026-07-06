# AI Platform Foundation + Ask Pulse — Design Spec

**Date:** 2026-07-05
**Slug:** `ai-foundation-and-ask-pulse`
**Phase:** 10 — AI & Agents · **Epic 1** (F1–F5)
**Status:** Approved (design direction + key decisions locked); pending plan
**Parent scope:** `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`

## Summary

Build the reusable **AI platform layer** every later Phase-10 feature depends on, and ship the
flagship feature on top of it in the same slice.

- **F1 AI Gateway** — one chokepoint, `resolveAiClient(orgId)`, that picks the **managed** global key
  or the org's **bring-your-own** key (decrypted from Supabase Vault) and wraps every call in metering.
- **F2 Encrypted BYO-key store** — a per-org secret in Supabase Vault, with a Settings flow to enter,
  **validate (test call)**, and remove a key. Never RLS-exposed to the browser.
- **F3 Usage ledger + credits** — an `ai_usage` ledger that reads `message.usage`, a monthly
  credit balance, and a **pre-spend** quota check for managed orgs.
- **F4 Entitlements + controls** — `org_ai_settings` (`ai_mode` off/managed/byo, `tier`, credit limit),
  a Settings "AI" section for org admins, and a platform-admin plan control.
- **F5 Ask Pulse** — a **workspace-wide**, natural-language, **read-only** Q&A surface. The model
  answers questions like "what's overdue and unassigned across my boards?" by calling **RLS-scoped
  read tools** in a tool-use loop; it never writes and never sees data the asking user can't.

The existing dashboard-gen feature **migrates onto the gateway** in this epic (proves F1 end-to-end
and removes the last direct `getAnthropicClient()` call site outside `src/lib/ai/`).

## Locked decisions

| Decision             | Choice                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **BYO key storage**  | **Supabase Vault** (`vault.create_secret` / `vault.decrypted_secrets`), libsodium-encrypted. A `SECURITY DEFINER` function returns the decrypted key **only to the service role**; the plaintext key never crosses RLS to `authenticated` and never reaches the browser. |
| **Ask Pulse scope**  | **Workspace-wide.** Tools are scoped to boards the asking user can see (RLS via the cookie-bound server client). Answers cite which boards were consulted.                                                                                                               |
| **Metering**         | Ledger stores `input_tokens`, `output_tokens`, `cost_usd` per call (source of truth). Users see a monthly **AI-credit** allowance; managed enforcement is a **cost ceiling per tier**. BYO usage is logged (for the org's own visibility) but **not** capped by us.      |
| **Entitlement gate** | Every AI Server Action calls `requireAiEntitlement(orgId, feature)` first: `ai_mode !== 'off'`, and for managed, remaining credits > 0. Fails closed with a typed, user-friendly error.                                                                                  |
| **Ask Pulse writes** | **None.** Read-only tools only. Natural-language _writes_ are F6 (Epic 3), behind a confirm UX.                                                                                                                                                                          |
| **Streaming**        | Deferred. F5 v1 returns a complete answer (with a "thinking…" state). Streaming is a later polish.                                                                                                                                                                       |

## Architecture

Extends the existing `src/lib/ai/` module. All Server Actions follow the repo convention:
`"use server"`, Zod `safeParse` at the boundary, `ActionResult<T> = {ok:true;data}|{ok:false;error}`,
RLS via the cookie-bound `createClient()`; the gateway's privileged reads use the service client.

### 1. Data model (migration — user-applied)

New migration `supabase/migrations/<ts>_ai_platform_foundation.sql`. Per the repo gotcha
(`migration-apply-blocked-by-classifier`), the agent **writes** the SQL; the **user applies** it, then
the agent regenerates types (`generate_typescript_types`) and runs `get_advisors`.

- **`ai_mode`** enum: `('off','managed','byo')`.
- **`org_ai_settings`** — one row per org:
  `org_id uuid pk references organizations`, `ai_mode ai_mode not null default 'off'`,
  `tier text not null default 'none'`, `monthly_credit_limit integer not null default 0`
  (managed allowance; 0 = none), `byo_provider text`, `byo_secret_id uuid` (Vault secret id, null
  unless BYO), `byo_key_last4 text` (display only), `updated_at timestamptz default now()`,
  `updated_by uuid`.
  **RLS:** members of the org may **read** their settings (minus any secret material — the table holds
  no plaintext key, only the Vault _id_ + last4); only **admins** (`has_org_role(org_id,{owner,admin})`)
  may write. `byo_secret_id` is an opaque handle, useless without service-role Vault access.
- **`ai_usage`** — append-only ledger:
  `id uuid pk`, `org_id uuid not null`, `user_id uuid`, `feature text not null`
  (`'dashboard_gen'|'ask_pulse'|…`), `provider text`, `model text`, `input_tokens int`,
  `output_tokens int`, `cost_usd numeric(10,6)`, `credits numeric(10,2)`, `created_at timestamptz
default now()`. Index `(org_id, created_at desc)`.
  **RLS:** admins may **read** their org's rows; **no** client insert path — rows are written by a
  `SECURITY DEFINER` function called from the gateway (service context).
- **Functions (SECURITY DEFINER, `search_path=''`):**
  - `ai_credits_used_this_month(p_org_id uuid) returns numeric` — sums `credits` since month start.
  - `record_ai_usage(...)` — inserts one ledger row (called by the gateway).
  - `get_byo_ai_secret(p_org_id uuid) returns text` — returns the decrypted Vault key for the org,
    **callable only by the service role** (revoke from `authenticated`, `anon`). Used by the gateway
    when `ai_mode='byo'`.
  - `set_byo_ai_secret(p_org_id uuid, p_provider text, p_key text) returns uuid` — creates/updates the
    Vault secret, stores `byo_secret_id`+`byo_key_last4`+`byo_provider` on `org_ai_settings`, returns
    the secret id. Admin-guarded (checks `has_org_role`). Called from the BYO Settings action.

### 2. `src/lib/ai/gateway.ts` (F1)

The single chokepoint. Replaces direct `getAnthropicClient()` use at feature call sites.

- `resolveAiClient(orgId): Promise<{ client: Anthropic; mode: 'managed'|'byo'; provider: string }>`
  - reads `org_ai_settings.ai_mode`;
  - `managed` → global `ANTHROPIC_API_KEY` (via existing `getAnthropicClient()`); throws
    `AiNotConfiguredError` if absent;
  - `byo` → `rpc('get_byo_ai_secret', {p_org_id})` (service client) → `new Anthropic({apiKey})`;
    throws a typed `ByoKeyMissingError` if none;
  - `off` → throws `AiDisabledError` (callers should have gated already).
- `runAi<T>(orgId, feature, fn): Promise<T>` — wraps a call: resolves the client, invokes `fn(client)`,
  reads `message.usage` off the result, computes cost + credits (a per-model price table constant),
  calls `record_ai_usage`, returns the result. **All spend flows through here** so nothing is
  unmetered. Managed cost is charged in credits; BYO logs `cost_usd` for the org's visibility only.

### 3. `src/lib/ai/entitlement.ts` (F3/F4)

- `getAiEntitlement(orgId): Promise<{ mode; tier; creditsLimit; creditsUsed; creditsRemaining }>`.
- `requireAiEntitlement(orgId, feature): Promise<void>` — throws typed errors:
  `AiDisabledError` (mode off), `AiQuotaExceededError` (managed & remaining ≤ 0). Every AI action
  calls this **before** doing any work. Actions translate these to clean `{ok:false,error}` messages.

### 4. Ask Pulse (F5) — `src/lib/ai/ask/`

- `tools.ts` — read-tool definitions handed to the model (Anthropic tool-use). All execute through the
  **cookie-bound** server client, so **RLS is the boundary** — the model can only ever read what the
  asking user can:
  - `list_boards()` → boards in the active workspace (`listMyBoards()` filtered to workspace).
  - `get_board_overview(board_id)` → the existing `buildBoardSnapshot` (schema + aggregate stats, no
    raw rows) — cheap, privacy-safe context.
  - `query_items({board_id, filters?, sort?, limit})` → a **bounded** (`limit ≤ 50`) RLS-scoped read
    over `items`+`cell_values` for the specific rows a question needs (e.g. overdue + unassigned).
    Returns names + the requested columns' values only. This is the one place Ask Pulse reads raw
    cells — bounded, indexed, and only for the user's own data.
- `ask.ts` — the tool-use **loop**: system prompt (teaches the tools + "answer only from tool
  results, cite boards, say when you don't know"), the user's question, iterate tool calls (cap ~6
  rounds) until the model returns a final text answer. Runs through `runAi(orgId,'ask_pulse',…)` for
  metering. **Before coding, read the `claude-api` skill's TypeScript tool-use docs** for the exact
  loop shape (knowledge cutoff — do not guess the SDK surface). Client is dependency-injected for tests.
- `actions.ts` — `askPulse({ workspaceId, question })`:
  `requireAiEntitlement(orgId,'ask_pulse')` → run loop → return `{ answer, boardsConsulted[], usage }`.
  Zod-bounds `question` (`max 1000`) as a cost guard.

### 5. Server Actions — `src/lib/ai/settings-actions.ts` (F2/F4)

All `ActionResult<T>`, admin-guarded where noted.

- `getOrgAiSettings()` → `{ mode, tier, creditsLimit, creditsUsed, byoProvider?, byoKeyLast4? }`.
- `setAiMode({ mode })` — admin only; `off|managed|byo`. Switching to `byo` requires a stored key.
- `setByoKey({ provider, key })` — admin only; **validates** the key with a cheap live test call
  (1-token ping) before storing; on success calls `set_byo_ai_secret`, saves provider + last4.
- `removeByoKey()` — admin only; clears the Vault secret + fields, flips mode off byo if needed.
- `setOrgAiPlan({ orgId, tier, monthlyCreditLimit })` — **platform-admin only** (`isPlatformAdmin`);
  the operator-set entitlement that stands in for Stripe until E6.

### 6. UI

Client surfaces, `pulse-ui` + `frontend-design` skills loaded before building. Client state + History
API; **0 RSC navigations** for in-panel steps.

- **Settings → AI** (`src/components/settings/ai/AiSettingsForm.tsx`, mounted in
  `src/app/(app)/settings/page.tsx`): mode selector (Off / Managed / BYO), a **credit usage meter**
  (used / limit this month) for managed, and the BYO key panel (masked input, "Validate & save",
  last4 display, "Remove"). Errors via `role="alert"`; the not-configured/disabled states explain,
  never crash.
- **Admin plan control** (`src/app/admin/organizations/[id]/`): set tier + monthly credit limit for an
  org (calls `setOrgAiPlan`).
- **Ask Pulse** (`src/components/ai/ask/AskPulse.tsx`): a lazy panel opened from ⌘K ("Ask Pulse…")
  and a header entry. Text input → answer, with a "thinking…" state, the list of boards consulted, and
  a subtle credit note when managed. Empty/disabled/quota states are first-class.

## Data flow (Ask Pulse)

1. User opens Ask Pulse (lazy) → types a workspace-scoped question.
2. `askPulse` → `requireAiEntitlement` (fail-fast on off/quota) → tool-use loop.
3. Model calls `list_boards` / `get_board_overview` / `query_items` (RLS-scoped) as needed.
4. Loop ends → final answer + `boardsConsulted`. `runAi` has logged tokens/cost/credits.
5. UI renders answer + sources; credit meter reflects the spend.

## Error handling

- **AI off / not configured** → clean message + disabled entry, never a 500.
- **Quota exceeded (managed)** → "You've used this month's AI allowance" + link to Settings.
- **BYO key missing/invalid** → validation fails at save-time with a specific reason; runtime falls
  back to a clear error, never leaks the key.
- **Tool/loop errors, rate limits** (typed SDK exceptions) → friendly retry message; partial tool
  failures degrade ("couldn't read board X").
- The BYO plaintext key is **server-only**: Vault decrypt is service-role, never returned to a client
  action; Settings only ever shows `last4`.

## Security notes

- `get_byo_ai_secret` is `SECURITY DEFINER`, `search_path=''`, and **revoked** from `anon`/`authenticated`.
- `ai_usage` has no client insert path; only the definer `record_ai_usage` writes.
- `org_ai_settings` write is admin-gated at both RLS and action layers; reads never include plaintext.
- Ask Pulse tools use the **cookie-bound** client so cross-org/cross-board reads are impossible by
  construction (RLS), even if the model "asks" for a board id it shouldn't see.
- Run `get_advisors` after the migration; expect zero new warnings.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** unchanged — Ask Pulse + Settings AI form are lazy; no new work on page load.
- **In-panel interactions** — client state + History API, **0 RSC navigations**.
- **Server round-trips only on explicit actions** — `askPulse` (one action, internal tool loop),
  `setByoKey` (one validate call), settings reads. None are view toggles.
- **Bounded/indexed** — `query_items` caps at 50 rows over `board_id`/filter-indexed columns; overview
  uses aggregate snapshots; `ai_usage` rollup is indexed `(org_id, created_at)`.

## Testing (TDD — written and executed)

- **Pure units:** cost/credit computation (price table), `getAiEntitlement` math (limit/used/remaining),
  tool argument validation, answer assembly. Anthropic client injected/mocked — **no real API calls**.
- **Gateway:** `resolveAiClient` picks managed vs byo per `ai_mode`; `runAi` records usage with the
  right tokens; BYO path calls `get_byo_ai_secret` (mocked).
- **Entitlement:** `requireAiEntitlement` throws the right typed error for off / quota-exceeded;
  passes when in-budget.
- **RLS integration** (`*.rls.integration.test.ts`, `describe.skipIf(!SERVICE_ROLE_KEY)`): a member
  can read own `org_ai_settings` and **not** another org's; `ai_usage` is org-scoped; `get_byo_ai_secret`
  is **not** callable as `authenticated`; Ask Pulse `query_items` returns only the user's boards.
- **Component:** Settings AI form (mode switch, BYO validate/remove, quota meter); Ask Pulse panel
  (thinking/answer/empty/disabled/quota states, sources list).

## Out of scope for this epic (YAGNI)

- Streaming answers; natural-language **writes** (F6); per-user keys; multi-provider beyond the seam;
  self-serve Stripe (E6); semantic retrieval (F15 — v1 Ask Pulse reads live via bounded tools);
  conversation history/memory across questions (each ask is stateless in v1).

## Env / ops

- `ANTHROPIC_API_KEY` (server-only) already exists — it is now the **managed** key. Ensure it's set in
  Vercel Production + Preview.
- Supabase Vault must be enabled on the project (it is available by default on Supabase Postgres).
- After the migration: `generate_typescript_types` → `src/types/database.types.ts`, then `get_advisors`.
