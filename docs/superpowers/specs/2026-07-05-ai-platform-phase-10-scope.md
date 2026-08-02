# Phase 10 — AI & Agents — Scope & Roadmap

**Date:** 2026-07-05
**Slug:** `ai-platform-phase-10`
**Status:** Scope approved (direction + key decisions locked); Epic 1 spec written, pending review
**Companion visual:** the AI roadmap artifact (Gantt + dual-billing diagram) presented 2026-07-05

## Why this phase

Monolith ships phases 0–9 and has exactly **one** AI feature today — AI dashboard generation
(`src/lib/ai/`). It has no agentic behaviour, no natural-language surface, no AI inside automations,
and a completely greenfield billing surface (no Stripe, no plan column, no quota, no secrets-at-rest).
Phase 10 adds a **reusable AI platform layer** and a wave of features on top of it, sold **two ways**:

1. **Managed** — the customer pays us; we supply the provider key and meter usage against a monthly
   allowance per plan tier.
2. **Bring-your-own-key (BYO)** — the customer stores their own provider key (encrypted at rest); no
   AI charge from us.

Both are two inputs to **one gateway**. This is an architecture decision, not a feature: every AI
call routes through a single chokepoint that resolves which key to use, enforces entitlement/quota,
and meters spend.

## Design stance (non-negotiable)

`vault/product.md` lists "Powered-by-AI badges, glow-everything" as an **anti-reference** and Monolith's
personality as **Calm · Capable · Crisp**. AI ships **at the seams**, not as chrome: no glow, no
badges, intelligence surfaced where work already happens (the item panel, ⌘K, the automations
builder). Every feature reuses the proven pattern from dashboard-gen: **privacy-safe snapshot →
structured/tool-use output → multi-layer Zod re-validation → existing RPCs**. Raw cell values leave
the workspace only when a feature genuinely needs them, and that is called out per-feature.

## Locked decisions

| Decision                    | Choice                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Billing depth (v1)**      | Admin-set entitlements first (set from the existing `src/app/admin/` console). Self-serve Stripe (E6) is a fast-follow, **not** in the first two weeks. Both managed + BYO work day one.                      |
| **Lead feature**            | **Ask Monolith** (natural-language Q&A over your work) is the flagship after the foundation.                                                                                                                  |
| **BYO key storage**         | **Supabase Vault** (`vault.secrets`, libsodium). Service-role-only access via a `SECURITY DEFINER` decrypt path; never RLS-exposed to `authenticated`. We hold no master key.                                 |
| **Ask Monolith scope (v1)** | **Workspace-wide** — question answered across all boards in a workspace via RLS-scoped read tools (not single-board).                                                                                         |
| **Metering unit**           | Ledger stores precise **input/output tokens + computed cost** per call (source of truth). Users see a friendly monthly **"AI credit"** allowance; managed enforcement is a **monthly cost ceiling per tier**. |
| **Model / provider**        | Anthropic `claude-opus-4-8` primary (reuses today's SDK path). Gateway is provider-shaped so an OpenAI-compatible provider can be added for BYO later (not in v1).                                            |

## Epic decomposition

Six epics. **E1 is the critical path — nothing is monetizable, BYO-capable, or gated without it.**
Feature IDs (F1–F17) match the roadmap artifact.

### E1 — AI Platform Foundation + Ask Monolith · P0/P1 · ~2 weeks (the ship-in-2 slice)

Foundation F1–F4 + the flagship F5. Full spec:
`docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md`.

- **F1 AI Gateway** — generalize `getAnthropicClient()` into `resolveAiClient(orgId)` (managed vs BYO) + a metering wrapper. Dashboard-gen migrates onto it.
- **F2 Encrypted BYO-key store** — Supabase Vault secret per org + Settings entry/validate/rotate flow.
- **F3 Usage ledger + credits** — `ai_usage` ledger (reads `message.usage`), monthly credit balance, pre-spend quota check for managed.
- **F4 Entitlements + controls** — `org_ai_settings` (ai_mode / tier / credit limit), Settings "AI" section for org admins, platform-admin plan control.
- **F5 Ask Monolith** — workspace-wide NL Q&A via RLS-scoped read tools (tool-use loop). Read-only, non-destructive.
- **Produces (interfaces later epics consume):** `resolveAiClient(orgId)`, `recordUsage()`, `requireAiEntitlement(orgId, feature)`, `org_ai_settings` + `ai_usage` tables, the read-tool pattern over items/cells.
- **Consumes:** existing `src/lib/ai/*`, `board-snapshot`, org/role guards (`has_org_role`, `isOrgAdmin`), `src/app/admin/`, Supabase Vault.

### E2 — Item & Content Assist · P1 · ~1 week

- **F7 AI item assist** — item-panel `fields` tab: draft/rewrite description, suggest subtasks, propose status/priority. **Consumes** E1 gateway + entitlement + `ItemPanel` tab bar + `addUpdate`.
- **F8 Thread summarization** — "catch me up" over `item_updates` + `item_activities`.
- **F9 Smart column fill** — bulk classify a text column → status/priority/category with a preview-and-apply grid (import-wizard pattern). Sends raw text of the source column (called out).

### E3 — Conversational Actions · P2 · ~4 days

- **F6 ⌘K natural-language actions** — "create task X due Friday for Dana in Backlog" → confirmed structured write. **Consumes** E1 gateway + F5's read-tool pattern + create RPCs; adds a confirm UX and write tools.

### E4 — Generation · P1/P2 · ~1 week

- **F10 AI board generation** — "build me a board for X" → schema + groups + starter items (mirrors dashboard-gen; reuses `create_board`/`create_item`).
- **F11 Automation builder from NL** — generates an automations rule config (output schema = `validations/automations.ts`), human-approved before save.
- **F12 AI import mapping** — Import Wizard Map step auto-suggests column mappings.

### E5 — Agentic Automation · P2 · ~2 weeks (the moat + long pole)

- **F13 AI action type in automations** — a new AI step in the rules engine. The engine runs in Postgres triggers, so this needs an **async edge hop** (`pg_net` → a server endpoint) — the one genuinely new architectural piece. **Consumes** E1 + the automations engine.
- **F14 Autopilot agent** — scheduled board agent (triage new items, chase overdue owners via a comment @mention, keep goal rollups current). Builds on F13 + `pg_cron`. Needs an **agent author identity** (note `item_updates` freezes author).
- **F15 Semantic search** — pgvector + embedding backfill → semantic ⌘K, "find similar", and the retrieval layer that lets Ask Monolith scale past eager snapshotting.

### E6 — Billing & Platform · P1/P2 · ~1 week

- **F16 Stripe self-serve** — subscription checkout + plan tiers + AI-credit metering wired to F3's ledger. Deferred until managed AI is proven.
- **F17 Usage dashboard + exec digest narrative** — orgs see spend/quota; AI-written narrative over the existing `digest_runs` weekly digest.

## Execution DAG (epic level)

```
E1 (root, critical path)
 ├─▶ E2  ┐
 ├─▶ E3  ├─ parallel batch (disjoint feature areas; all just consume E1's gateway + entitlement)
 ├─▶ E4  ┘
 ├─▶ E6  (needs E1 ledger; parallel to E2–E4)
 └─▶ E5  (needs E1; internal chain F13 ▶ F14; F15 independent infra)
```

- **Batch 1 (now):** E1 alone. Everything waits on the gateway/entitlement/ledger.
- **Batch 2 (after E1):** E2, E3, E4, E6 run concurrently as separate `task/*` worktrees.
- **Batch 3:** E5 — F13 → F14 is the longest single chain (the true wall-clock floor after E1); F15 runs alongside.
- **Critical path ≈ E1 (~2wk) → E5 agentic chain (~2wk) ≈ 4–6 weeks** to a fully agentic, self-serve-billed product. A **monetizable, demoable slice lands at the end of E1 (~2 weeks)**; everything after is additive.

## Performance & data-fetching budget (AGENTS.md #5)

Phase-wide invariant: **AI is always an explicit, on-demand action, never a view toggle.**

- **First paint** of any page is unchanged — AI entries are static buttons; panels/wizards are lazy (`next/dynamic`, `ssr:false`) and driven by **client state + History API (0 RSC navigations)**.
- **Server round-trips only on explicit user actions** (Ask, Generate, Assist, Fill) — each is one Server Action; none are triggered by tab/filter/sort switches.
- **Bounded/indexed reads:** snapshots aggregate server-side over `board_id`-indexed tables; Ask Monolith's read tools use bounded, paginated queries over indexed filter columns (never unbounded `select *`); the `ai_usage` ledger is indexed `(org_id, created_at)` and rolled up per-month.
- Each epic spec restates its own budget.

## Parallelization plan (AGENTS.md #6)

- **E1** is itself internally parallelizable — see its plan's DAG (schema + gateway + ledger + entitlement fan out, then Ask Monolith's tools, then UI). It is a single worktree because its pieces share the new `src/lib/ai/*` surface and the migration.
- **E2/E3/E4/E6** are independent worktrees dispatched together once E1 merges (they touch disjoint feature folders). This is the primary `superpowers:dispatching-parallel-agents` wave.
- **E5** runs after, as its own worktrees (F13→F14 sequential; F15 parallel).

## Connection to `/whats-next` and the vault

- Phase 10 is added as a row in `vault/moc/platform-roadmap.md` and a bullet in `vault/00-north-star.md` §2, with §3 "Next" pointing at E1.
- The locked decisions above are captured as an ADR: `vault/decisions/2026-07-05-decision-25-ai-platform-dual-billing.md`.
- Each epic's full design spec + implementation plan lands in `docs/superpowers/specs|plans/` as its turn comes (E1 now; E2–E6 expanded **just-in-time**, not speculatively — YAGNI, since each will shift based on what E1 teaches us). `/whats-next` reads the north-star + this scope + the ADR to recommend the next batch and dispatch worktrees.

## Out of scope for Phase 10 (YAGNI, revisit later)

- Fine-tuning / custom models; a general chat assistant untethered from a board/workspace; multi-provider routing beyond the BYO seam; per-user (vs per-org) keys; on-prem/self-hosted inference; RAG over attachments/files (F15 covers item-text retrieval only); AI-written automations that self-deploy without human approval (F11/F13 always keep a human gate in v1).
