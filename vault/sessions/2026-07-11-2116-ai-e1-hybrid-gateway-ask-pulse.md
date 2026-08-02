---
type: session
date: 2026-07-11-2116
branch: develop
trigger: wrapup
status: complete
tags: [session, phase-10, ai]
related:
  - "[[2026-07-05-decision-26-ai-platform-dual-billing]]"
  - "[[2026-07-07-1345-vault-reconcile-byo-settings-unlogged]]"
---

# Phase 10 E1 — hybrid gateway, metering, entitlements, Ask Monolith

## What changed

- **Scope reconciliation** shipped as spec `docs/superpowers/specs/2026-07-11-ai-e1-scope-reconciliation-design.md` + plan `docs/superpowers/plans/2026-07-11-ai-e1-foundation-continuation.md`: hybrid key model (`ai_mode = off | managed | org_byo | per_user`, default `per_user` — missing row ≡ per_user), Anthropic-only agentic v1 (`supportsTools` flag), full-E1 slice.
- **Merged `task/ai-e1-foundation` → develop (`dc3d403`)**, 24 commits, subagent-driven (16 tasks, each two-stage reviewed + final integration review). Two DEV migrations: `20260711163714_ai_platform_foundation` (enum, `org_ai_settings`, `ai_usage` ledger, org Vault secret fns) and `20260711165508_org_ai_settings_write_confinement` (client write path removed after review found org admins could self-grant tier/credits).
- **Gateway + metering:** `src/lib/ai/gateway.ts` (`resolveAiAdapter`, `runAi` — every AI call metered into `ai_usage`), `entitlement.ts` (managed credit ceiling), `pricing.ts` (1 credit = $0.01). Dashboard-gen migrated onto the gateway; the env `ANTHROPIC_API_KEY` is the managed key again (verified present in Vercel Prod+Preview).
- **Ask Monolith shipped:** RLS-scoped read tools (`ask/tools.ts`), 6-round Anthropic tool-use loop (`ask/ask.ts`), entitlement-gated action, ⌘K entry + header trigger + lazy panel. Anthropic-gated; OpenAI/Google keys keep dashboard-gen only.
- **UI:** Settings "AI — Organization" card (mode selector, credit meter, org key panel; personal card gated by mode); `/admin/organizations/[id]` "AI plan" card (`setOrgAiPlan`, pre-Stripe lever).
- **Tests:** ~50 new unit/component tests + `org-ai-settings.rls.integration.test.ts` (skips without `PULSE_TEST_DB`; boundary substantively verified against DEV via rolled-back txn). All four gates green at merge.

## Why

Continuing Phase 10 required reconciling the shipped per-user BYO foundation (PR#53) with the org-scoped managed+metering plan before building further. The hybrid model preserves prod behavior (per_user default) while adding the monetizable managed tier and the flagship NL surface.

## How to test (for the user)

1. Pull `develop`, run the app, sign in as an org owner/admin.
2. **Settings → AI — Organization**: mode selector shows "Members' own keys" selected; your personal AI key card still renders below. Dashboard AI generation works as before (regression check).
3. Switch mode to **Off** → on a board, Generate dashboard with AI → clean "AI is turned off for your organization." error. Switch back.
4. **Org key:** paste an Anthropic key in the org panel → Validate & save (last4 shows) → mode "Organization key" → generation + Ask Monolith work for a member with no personal key.
5. **Ask Monolith:** ⌘K → "Ask Monolith…" (or the header Ask button) → ask "what's overdue and unassigned across my boards?" → thinking state, then an answer naming boards consulted. Unanswerable question → honest "don't know", no fabrication.
6. **Metering:** in `/admin/organizations/<id>` set tier + credit limit 1 → switch org mode to **Managed** → one generation works, the next says "You've used this month's AI allowance." Settings meter shows spend.
7. **Provider gate:** store an OpenAI/Google key → dashboards work; Ask Monolith says it needs an Anthropic key.

## Open threads

- `getAnthropicClient()` in `src/lib/ai/anthropic.ts` is now dead code (flag-only; `MODEL`/`AiNotConfiguredError` still live).
- Vault secret orphan on org delete (cascade drops the row, not the `vault.secrets` entry) — same latent issue as the per-user sibling; cleanup hook someday.
- Optional hardening from review: empty-tool_use-block bail in the ask loop; `requireUser()` inside try/catch (repo-wide pattern, latent-only).
- E1 remainder per scope doc: streaming answers, NL writes (F6), Stripe (E6), semantic search (F15) — all later epics. Off-mode personal-card copy nit ("managed by your organization" when off).
- New gotcha ADR recorded: MCP `apply_migration` stamps its own version — always reconcile the local filename to the DEV ledger (bit us twice this session).

## Next session entry point

Phase 10 E1 is done and in develop; promotion to `main` is due. Next: promote, then pick Batch 2 (E2 item assist / E3 ⌘K actions / E4 generation / E6 billing — parallel worktrees per the scope doc's DAG) or the PF perf plan.
