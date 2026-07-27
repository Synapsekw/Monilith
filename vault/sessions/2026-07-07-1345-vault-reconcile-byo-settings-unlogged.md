---
type: session
date: 2026-07-07-1345
branch: develop
trigger: wrapup
status: complete
tags: [session, housekeeping, reconcile]
related:
  - "[[2026-07-05-1746-phase-10-ai-roadmap-scope]]"
  - "[[2026-07-05-decision-26-ai-platform-dual-billing]]"
  - "[[2026-07-07-1117-avatar-surfaces-header-presence-columns]]"
---

# Vault reconcile — record BYO-AI + settings sessions that shipped un-logged

## What changed

- No source changes. This was a triage/reconciliation block: diagnosed why two `/whats-next` runs diverged (stochastic synthesis over an agentic exploration — same substance, different grouping/wording), then ran `/wrapup` to correct the drift both runs flagged.
- Verified against git + disk that **three worktree sessions shipped without a session note** and are now in prod via **PR#53** (`2a7c4ac`), main healed back into develop (`e54e8ca`):
  - **`task/byo-ai-keys`** — Phase 10 **E1 foundation, partial**: `user_ai_credentials` table + Supabase-Vault key fns (`20260706164829`, `20260706165521`), provider registry (Anthropic/OpenAI/Google adapters + catalog), `resolveUserAdapter`, key server actions, dashboard-gen rewired through the resolved adapter, `AiProviderForm` Settings card, RLS integration test. Built **per-user + un-metered** — a deliberate divergence from the roadmap's **org-scoped managed+BYO** plan (`docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md`). Commits `afe128d`→`2c51880`, merge `a2a6624`.
  - **`task/settings-redesign`** (`b5353b6`/`af76fbf`) — two-column settings layout; **`task/settings-fullwidth`** (`d14e339`/`19fc481`) — responsive card masonry; plus avatar uploader in Profile card (`86e66a7`).
- Corrected **north-star §3** (was asserting "promote due" / Phase 10 "not started") and bumped **§2 Phase 10** to reflect the shipped-but-partial E1 foundation.
- Deleted two stale auto-draft stubs (`_draft-2026-07-05-1038.md`, `_draft-2026-07-05-1606.md`) — their work was already captured in real notes (import-wizard, phase-10 scope, shadcn-charts).

## Why

Three sessions were merged straight to develop and promoted to prod without a `/wrapup`, so the vault's entry point drifted out of sync with reality — which is exactly what made the two `/whats-next` runs spend effort re-reconciling the same drift. Recording it once here stops the next triage from re-improvising it.

## How to test (for the user)

1. Pull `develop` (already in prod). Go to **Settings** — confirm the redesigned two-column / full-width masonry layout and the **Profile** card avatar uploader render.
2. In Settings, find the **AI provider key** card. Enter a valid Anthropic (or OpenAI/Google) key and save — it should store without error (key held in Supabase Vault, never round-tripped to the client).
3. Open a board and run **Generate dashboard with AI** — generation should now route through your saved per-user key (the resolved provider adapter), not a shared/managed key.

## Open threads

- **Scope reconciliation owed:** shipped BYO is **per-user + un-metered**; the E1 plan assumes **org-scoped, managed-vs-BYO + `ai_usage` metering/entitlements + Ask Monolith**. Continuing Phase 10 must reconcile the two, not build the plan as-written. Metering/gateway core + all of Ask Monolith are still greenfield.
- Carried, still owed: dev migration-ledger drift (`20260705120000` missing from DEV ledger); Batch-A trash follow-ups (nav link to `/boards` Trash `#archived`; surface `archived_by`); `buildImportPayload` (unsuffixed) retire-or-confirm; perf tier-3 Task A (`unstable_instant`, needs its own arch spec — gotcha-48); landing redesign brand-lab pick (Statement/Product/Editorial/Kinetic).

## Next session entry point

Vault now matches reality. Next build block: Phase 10 E1 continuation — start with a **scoping/brainstorm pass reconciling the shipped per-user BYO foundation against the org-scoped managed+metering+Ask Monolith plan**, then `/develop` in a `task/ai-*` worktree. Trivial cleanups (ledger repair, trash follow-ups) can run as a disjoint parallel batch.
