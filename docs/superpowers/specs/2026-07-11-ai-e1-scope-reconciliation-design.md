# AI E1 Scope Reconciliation — Design Spec

**Date:** 2026-07-11
**Slug:** `ai-e1-scope-reconciliation`
**Phase:** 10 — AI & Agents · **Epic 1** (F1–F5), continuation
**Status:** Approved (design direction + key decisions locked); pending plan
**Amends:** `docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md` (the E1 spec)
**Parent scope:** `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`

## Why this spec exists

The E1 spec designed an **org-scoped** AI foundation (`org_ai_settings`, managed-vs-BYO gateway,
metering, entitlements, Ask Monolith). What actually shipped to prod (PR#53, `task/byo-ai-keys`) is a
**per-user, un-metered** BYO key store (`user_ai_credentials` + Vault definer functions) with
**three provider adapters** (Anthropic/OpenAI/Google) — and dashboard-gen was rewired to resolve
_only_ the user's personal key: `resolveUserAdapter()` throws `AiNotConfiguredError` when no key is
stored, and the server `ANTHROPIC_API_KEY` is currently dead code outside a startup warning
(`src/instrumentation.ts`). There is **no managed path at all** today.

This spec reconciles the two so the rest of E1 (and every later epic) builds on one coherent model.
It is a **delta**: anything the E1 spec defines and this document does not mention **stands as
specced** (Ask Monolith tool design, error handling, security notes, perf budget, test strategy).

## Reconciliation decisions (locked 2026-07-11)

| Decision                                       | Choice                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Key/entitlement scoping**                    | **Hybrid.** `ai_mode` becomes a four-value enum: `off \| managed \| org_byo \| per_user`. The shipped per-user store is kept and promoted to an explicit, admin-sanctioned mode; org-scoped managed + org-BYO land as planned. One gateway resolves all four.                                                                                                                   |
| **Default mode**                               | **`per_user`** — for existing _and_ new orgs (a missing `org_ai_settings` row is treated as `per_user`). Preserves current prod behavior exactly: members with a stored key keep working the moment the migration lands. `off` was considered (more conservative sell-to-orgs posture) and rejected because it would break live users. Admins can lock down or upgrade at will. |
| **Multi-provider stance for agentic features** | **Anthropic-only agentic (v1).** Adapters gain a `supportsTools` capability flag — `true` only for Anthropic. Ask Monolith (and later tool-use features) require a tools-capable resolved adapter; OpenAI/Google keys keep working for dashboard-gen. The Vercel AI SDK abstraction re-opens only if multi-provider agentic becomes a product promise.                          |
| **Slice scope**                                | **Full E1 in one epic/worktree:** org settings + gateway + `ai_usage` metering + entitlements + Settings/admin UI + Ask Monolith, with dashboard-gen migrated onto the gateway. Matches the original ship-in-2 slice; internally parallelizable.                                                                                                                                |
| **Existing per-user keys**                     | **Untouched.** `user_ai_credentials` and its Vault functions are unchanged; no data migration.                                                                                                                                                                                                                                                                                  |

## 1. Data model (migration — applied to DEV via `supabase-dev` MCP)

One migration `supabase/migrations/<ts>_ai_platform_foundation.sql`, then `pnpm db:types` committed
in the same task, then `get_advisors` (expect zero new warnings).

- **`ai_mode` enum:** `('off','managed','org_byo','per_user')`.
- **`org_ai_settings`** — one row per org, exactly as the E1 spec defines it
  (`org_id` pk, `tier`, `monthly_credit_limit`, `byo_provider`, `byo_secret_id`, `byo_key_last4`,
  `updated_at`, `updated_by`) with two changes:
  - `ai_mode ai_mode not null default 'per_user'`;
  - **absence of a row ≡ `per_user`** — the gateway and entitlement reads treat "no row" as the
    default mode with `tier='none'`, `monthly_credit_limit=0`. No backfill insert is required.
  - RLS as specced: members read (no secret material — only the Vault id + last4 live here);
    only org admins (`has_org_role(org_id,{owner,admin})`) write.
- **`ai_usage`** — append-only ledger exactly as the E1 spec defines it
  (`org_id`, `user_id`, `feature`, `provider`, `model`, `input_tokens`, `output_tokens`,
  `cost_usd`, `credits`, `created_at`; index `(org_id, created_at desc)`; admins read their org's
  rows; **no client insert path** — only the definer `record_ai_usage` writes).
- **Functions (SECURITY DEFINER, service-role-only, mirroring the shipped, RLS-tested
  `ai_credential_*` pattern from `20260706164829_user_ai_credentials.sql`):**
  - `org_ai_secret_set(p_org uuid, p_provider text, p_secret text, p_hint text)` — replaces any
    existing org secret (delete Vault secret + re-create), stores `byo_secret_id`, `byo_provider`,
    and `byo_key_last4` on `org_ai_settings` (upserting the row).
  - `org_ai_secret_get(p_org uuid) returns table (provider text, secret text)` — the only decrypt
    path; `revoke` from `public, anon, authenticated`, `grant execute` to `service_role`.
  - `org_ai_secret_clear(p_org uuid)` — deletes the Vault secret and nulls the org-BYO columns.
  - `record_ai_usage(...)` and `ai_credits_used_this_month(p_org uuid)` as specced in E1.
  - All definer functions pin `search_path` (the shipped pattern uses `public, vault`; keep it
    consistent with what already passed review and advisors).

## 2. Gateway — `src/lib/ai/gateway.ts` (F1)

The single chokepoint. Adapter-shaped (not client-shaped) because the shipped provider registry is
the right unit of currency:

- `resolveAiAdapter(orgId): Promise<{ adapter: ProviderAdapter; apiKey: string; mode: AiMode; provider: AiProvider }>`
  - reads `org_ai_settings.ai_mode` (missing row → `per_user`);
  - `off` → throws `AiDisabledError`;
  - `managed` → Anthropic adapter + server `ANTHROPIC_API_KEY` (via the existing
    `getServerEnv()` path; absent → `AiNotConfiguredError`). This makes the env key the managed
    key again instead of dead code;
  - `org_byo` → `rpc('org_ai_secret_get')` (service client) → that provider's adapter; no secret →
    typed `ByoKeyMissingError`;
  - `per_user` → the existing `resolveUserAdapter()` (unchanged; throws `AiNotConfiguredError`
    when the user has no key).
- `runAi<T>(args: { orgId; userId; feature }, fn: (resolved) => Promise<{ result: T; usage: AiUsage }>): Promise<T>`
  — resolves the adapter, invokes `fn`, computes `cost_usd` + `credits` from a per-model price-table
  constant, calls `record_ai_usage`, returns the result. **All spend flows through here** in every
  mode; only `managed` is _enforced_ (below). BYO/per-user rows are logged for the org's own
  visibility.

### Adapter interface changes (`src/lib/ai/providers/types.ts`)

- `generateProposal` returns `{ proposal: DashboardProposal; usage: { inputTokens; outputTokens } }`
  — today the adapters discard `message.usage`; metering needs it. All three adapters updated.
- New field `supportsTools: boolean` — `true` for `anthropicAdapter`, `false` for
  `openaiAdapter`/`googleAdapter` in v1.
- The Anthropic adapter gains the tool-use loop entry point Ask Monolith consumes (E1 spec §4's
  `ask.ts` loop lives in `src/lib/ai/ask/`; the adapter exposes the raw tool-round primitive).
  **Before coding the loop, read the `claude-api` skill's TypeScript tool-use docs** (knowledge
  cutoff — do not guess the SDK surface).

### Dashboard-gen migration

`generateProposal` in `src/lib/ai/generate.ts` stops calling `resolveUserAdapter()` directly and
goes through `resolveAiAdapter(orgId)` + `runAi(…, 'dashboard_gen', …)`. Feature behavior is
unchanged for `per_user` orgs (the default); it additionally now works in `managed`/`org_byo` orgs
and is metered everywhere. This removes the last feature-level call site that bypasses the gateway.

## 3. Entitlements — `src/lib/ai/entitlement.ts` (F3/F4)

As specced in E1, adapted to four modes:

- `getAiEntitlement(orgId)` → `{ mode, tier, creditsLimit, creditsUsed, creditsRemaining }`
  (missing row → `per_user`/`none`/0).
- `requireAiEntitlement(orgId, feature)` throws typed errors:
  - `AiDisabledError` when `mode = off`;
  - `AiQuotaExceededError` when `mode = managed` and `creditsRemaining ≤ 0`;
  - `org_byo`/`per_user` pass (no cap from us) — key-missing errors surface at resolve time.
- Feature-level capability gate: Ask Monolith's action additionally requires
  `resolved.adapter.supportsTools`, else a typed `ProviderNotCapableError`.

## 4. Ask Monolith (F5)

Exactly as the E1 spec defines it — workspace-wide, **read-only**, RLS-scoped tools
(`list_boards` / `get_board_overview` / `query_items` with `limit ≤ 50`), capped tool-use loop
(~6 rounds), no streaming, stateless per question, `question` Zod-bounded to 1000 chars — with one
addition: the **Anthropic gate**. Managed mode always qualifies; `org_byo`/`per_user` qualify when
the stored key's provider is `anthropic`. Otherwise the UI shows a friendly, non-error state:
_"Ask Monolith needs an Anthropic key — dashboards work with any provider."_

## 5. Server Actions — `src/lib/ai/settings-actions.ts` (F2/F4)

As specced in E1 (`ActionResult<T>`, Zod at the boundary, admin-guarded), renamed/extended for the
four-mode model:

- `getOrgAiSettings()` → `{ mode, tier, creditsLimit, creditsUsed, byoProvider?, byoKeyLast4? }`.
- `setAiMode({ mode })` — org-admin only; switching to `org_byo` requires a stored org key.
- `setOrgByoKey({ provider, key })` — org-admin only; validates with the adapter's existing
  `validateKey` live ping before `org_ai_secret_set` (reuses the shipped validation UX).
- `removeOrgByoKey()` — org-admin only; clears secret + fields; if mode was `org_byo`, falls back
  to `per_user`.
- `setOrgAiPlan({ orgId, tier, monthlyCreditLimit })` — **platform-admin only**; the pre-Stripe
  entitlement lever, surfaced in `/admin/organizations/[id]`.
- The shipped per-user key actions (`credentials-actions.ts`) are unchanged.

## 6. UI

`pulse-ui` + `frontend-design` skills loaded before building. Client state + History API; 0 RSC
navigations for in-panel steps; all panels lazy.

- **Settings → AI** (extends the existing AI card area in `src/app/(app)/settings/`):
  - **Org admins** see the mode selector (Off / Managed / Organization key / Members' own keys),
    the monthly credit meter when managed, and the org-key panel (masked input, "Validate & save",
    last4, "Remove") — same interaction pattern as the shipped `AiProviderForm`.
  - **Everyone** keeps the personal `AiProviderForm` card, shown when the org mode is `per_user`
    (hidden otherwise, with a one-line note of what the org mode is).
- **Admin plan control** (`src/app/admin/organizations/[id]/`): tier + monthly credit limit.
- **Ask Monolith** (`src/components/ai/ask/AskPulse.tsx`): lazy panel from ⌘K ("Ask Monolith…") + a
  header entry; thinking / answer / boards-consulted / empty / disabled / quota / not-capable
  states are all first-class.

## 7. Error handling, security, performance, testing

The E1 spec's sections stand in full. Deltas:

- **Resolution matrix tests (unit):** 4 modes × configured/unconfigured — `off` throws
  `AiDisabledError`; `managed` without env key throws `AiNotConfiguredError`; `org_byo` without a
  secret throws `ByoKeyMissingError`; `per_user` without a credential throws
  `AiNotConfiguredError`; missing `org_ai_settings` row resolves as `per_user`. Plus the
  capability gate (`supportsTools=false` → `ProviderNotCapableError`) and `runAi` ledger-write
  assertions (right tokens/cost/credits per call). Anthropic client mocked — no real API calls.
- **RLS integration** (`*.rls.integration.test.ts`): members read own `org_ai_settings`, not
  another org's; non-admin writes rejected; `ai_usage` org-scoped, no client insert;
  `org_ai_secret_get` **not** callable as `authenticated` (mirror the shipped
  `user-ai-credentials.rls.integration.test.ts`).
- **Component:** Settings AI form (mode switch, org-key validate/remove, meter, per-user card
  visibility per mode); Ask Monolith panel states.
- **Perf budget:** unchanged from E1 — first paint untouched, AI only on explicit actions,
  `query_items` bounded ≤ 50 over indexed columns, `ai_usage` rollup indexed `(org_id, created_at)`.

## Out of scope (unchanged YAGNI, restated)

Streaming answers; NL writes (F6); multi-provider tool loops / Vercel AI SDK adoption;
self-serve Stripe (E6); semantic retrieval (F15); conversation memory; per-user managed quotas
(credits are org-level only).

## Env / ops

- `ANTHROPIC_API_KEY` (server-only) becomes the **managed** key — ensure it is set in Vercel
  Production + Preview before any org is switched to `managed`.
- Supabase Vault already enabled and in use (shipped per-user store).
- Migration → DEV via `supabase-dev` MCP → `pnpm db:types` → `get_advisors`, all in the same task.
