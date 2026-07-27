---
type: decision
date: 2026-07-05
status: accepted
tags: [decision, roadmap, phase-10, ai, agents, billing, architecture]
related:
  [
    "[[2026-06-24-0912-ai-dashboard-generation]]",
    "[[2026-06-24-gotcha-45-structured-output-permissive-config-empties]]",
    "[[2026-06-21-decision-24-defer-phase-6e-docs]]",
    "[[2026-06-19-decision-21-plans-must-state-execution-dag]]",
  ]
---

# decision-26: AI platform (Phase 10) — one gateway, two billing paths

## Context

Monolith ships phases 0–9 with exactly **one** AI feature (dashboard generation, `src/lib/ai/`) and no
agentic behaviour. A codebase audit (2026-07-05, three research agents) confirmed: no tool-calling, no
NL surface, no AI in automations; billing is fully greenfield (no Stripe, no plan column, no quota,
no secrets-at-rest). The product owner asked for an agentic AI roadmap delivered **two ways** —
included-in-plan (managed) or bring-your-own-API-key (BYO) — presented as a visual roadmap, then
scoped into specs/plans wired to `/whats-next`.

Scope doc: `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`.
Epic-1 spec: `docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md`.

## Decision

Adopt **Phase 10 — AI & Agents**: a reusable AI platform layer + a feature wave, with the following
locked architectural commitments.

1. **Two billing paths, one gateway.** Managed (we supply the key, meter usage) and BYO (customer's
   own key) are two inputs to a single `resolveAiClient(orgId)` chokepoint that also meters every
   call. Generalizes the existing single `getAnthropicClient()` call site; dashboard-gen migrates onto
   it. Adding a provider or a plan happens in one place.
2. **BYO keys live in Supabase Vault**, not app-layer encryption. Service-role-only decrypt via a
   `SECURITY DEFINER` function revoked from `authenticated`/`anon`; plaintext never crosses RLS or
   reaches the browser; Settings shows only `last4`. Chosen because it adds the least new infra and
   keeps "Supabase is the platform / RLS never exposes secrets" intact — we hold no master key.
3. **Metering: tokens logged, credits shown.** The `ai_usage` ledger stores precise input/output
   tokens + computed `cost_usd` (source of truth from `message.usage`). Users see a friendly monthly
   **AI-credit** allowance; managed enforcement is a **monthly cost ceiling per tier**. BYO usage is
   logged for the org's own visibility but not capped by us.
4. **Admin-set entitlements before Stripe.** Early customers get a plan set from the existing
   `src/app/admin/` console (`setOrgAiPlan`). Self-serve Stripe checkout (Epic 6) is a fast-follow, so
   AI value ships in ~2 weeks without waiting on billing integration.
5. **Ask Monolith is workspace-wide and read-only.** NL Q&A across all boards the asking user can see,
   via **RLS-scoped read tools** in a tool-use loop (RLS is the boundary by construction). Natural-
   language _writes_ are a separate, later epic (F6) behind a confirm UX.

## Why this doesn't break the "no standing non-Supabase infra" invariant

[[2026-06-21-decision-24-defer-phase-6e-docs]] reaffirmed: Postgres + RLS + Server Actions/Storage,
no standing non-Supabase services. Phase 10 stays inside that:

- All AI calls are **Server Actions** on the Anthropic SDK — no new standing service.
- The one async piece (Epic 5 / F13: an AI step inside the Postgres automations engine) reuses the
  **existing `pg_net` → app-route** pattern already shipped for webhook actions
  (`20260619130000_automations_5c2_webhook_schema.sql`) — it calls **our own Next.js route handler on
  Vercel**, not a new Edge Function or third-party service. Semantic search (F15) uses **pgvector**, a
  Postgres extension, consistent with `pg_cron`/`pg_net`/`pg_trgm` already in use.

## Consequences / scope

- New phase row in [[platform-roadmap]] and a bullet in [[00-north-star]] §2; §3 "Next" points at
  Epic 1.
- **Migration is user-applied** (per [[migration-apply-blocked-by-classifier]]): agent writes the SQL
  (`org_ai_settings`, `ai_usage`, `ai_mode` enum, Vault definer functions), user applies, agent
  regenerates types + runs advisors.
- Epic 1 (foundation + Ask Monolith) is the critical path and the ~2-week ship-in-2 slice; Epics 2/3/4/6
  parallelize after it; Epic 5 (agentic) is the long pole. Full plans are written **just-in-time** per
  epic, not speculatively.
- **Not locked forever:** provider is Anthropic-only in v1 (gateway is provider-shaped for an
  OpenAI-compatible BYO option later); streaming, per-user keys, conversation memory, and RAG over
  attachments are explicitly deferred.
