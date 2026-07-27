---
type: session
date: 2026-07-21-1123
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, phase-10, e5, agentic, semantic-search]
related:
  [
    "[[2026-07-20-decision-29-agentic-automation-guardrails]]",
    "[[2026-07-17-2044-timeline-upgrades-hook-test-fix]]",
  ]
---

# E5 Agentic Automations + Semantic Search — full build (F13+F14+F15)

## What changed

- **`/whats-next` triage found the headline drift:** the `develop → main` promotion the north-star listed as pending "Next" had **already shipped** (PR #69, `origin/main` @ `8b4d648`). That retired the top ops item and left the E5 spec (awaiting review) as the real front.
- **Owner reviewed E5 and greenlit the FULL build** (F13 + F14 + F15; embeddings on OpenAI `text-embedding-3-small`). Resolutions recorded in spec §11; spec + plan landed on `develop` (`e157ea5`), stale `task/e5-agentic-semantic` scoping worktree retired.
- **Built all of E5 in 3 parallel worktree waves** (A1‖B1 → A2‖B2 → A3‖B3 → Z), orchestrated from the main thread: subagents built each task + stopped at the DB boundary; main thread applied all **5 migrations** to DEV via the `supabase-dev` MCP, reconciled each ledger version (gotcha-55), and serialized the merges. 21 commits, `41a1dd5..1dfe16f`.
- **Migrations:** `automation_ai_jobs`, `pgvector_item_embeddings` (+ `match_items`), `item_embed_queue`, `automation_ai_step_apply` (+ confined `automation_ai_apply`), `board_agents` (+ platform-bot `auth.users` seed).
- **Security verified directly on DEV** (advisor sweep, no MCP advisor tool): all 6 tables RLS-enabled; both confined appliers DEFINER + `search_path=''` + service_role-only (no `authenticated` path); `match_items` INVOKER; all definers `search_path=''`.
- Wrote **decision-29** (agentic-automation guardrail box). Saved the worktree `db:types` trap to auto-memory.
- **Recovery:** A2's build agent crashed at its commit (commitlint rejects capitalized subjects) — finished on the main thread after verifying its `_automation_run` CREATE-OR-REPLACE was a no-regression superset of the live definition. B2's finish hit a rebase conflict in `env.server.ts` (A2 + B2 both added the same `AI_PGNET_HMAC_SECRET`) — resolved by unifying the comment.

## Why

E5 is the Phase-10 long pole: F13/F14 give the automations engine its first **unattended AI writes** (bounded, reversible, audited, killable — the async model hop out of Postgres mirrors the existing webhook path), and F15 is greenfield pgvector semantic retrieval. The already-shipped promotion cleared the board to take it on. The three north-star "review risks" were folded in: ANN-then-RLS recall (INVOKER `match_items`), the platform-bot seed (built, idempotent), and the single-managed-embedding-model decision.

## How to test (for the user)

Not on prod (`develop` never deploys). Test on a **preview deploy** with org AI mode `on` and the env below set:

1. **F13 AI step** — board → Automations → new rule → add an **"AI step"** action (instruction + allowed actions) → **"Test this step"** shows the chosen action _without applying_. Enable + trigger → check run history for an `ai_decided`/`ai_skipped` outcome.
2. **F14 Autopilot** — board settings → **Autopilot** card → enable + pick cadence/tasks. Next sweep → a `board_agent_runs` row; any bot comment attributed to **"Monolith Autopilot"**.
3. **F15 Find similar** — backfill first (`POST /api/ai/embed?mode=backfill`, signed) or edit a few items and wait for the 2-min sweep → item panel → **"Find similar"** → ranked related items (or "indexing…").
4. **F15 semantic Ask** — Ask AI, ask a meaning-based question → the `semantic_search_items` tool surfaces lexically-disjoint matches.

**Required env first** (endpoints 503 / crons no-op until set — app stays healthy): `OPENAI_EMBEDDING_API_KEY`, `AI_PGNET_HMAC_SECRET` (≥32 chars) + Vault mirror `ai_pgnet_hmac_secret`, and confirm Vault `app_url` points at the deploy serving `/api/ai/*`.

## Open threads

- **Env not set anywhere yet** — the four vars above must land on the test/preview env, then on prod at promotion.
- **Not on prod.** Promoting `develop → main` carries E5 + the earlier Timeline/report work; needs the env on prod first.
- RLS/confinement integration tests are authored but skip without `PULSE_TEST_DB` — cross-tenant posture was verified directly on DEV instead, not by an automated cross-org run.
- Minor runtime check: F14 `board_agent_apply` notify writes `notifications.kind='mention'` + `update_id` — exercise once to confirm (no check-constraint on DEV; real @mentions use the same shape).
- Carryover: rotate the prod DB password; Report Builder v2 (charts + wide-board) and E6 (Stripe, F16 blocked on creds) still open.

## Next session entry point

Set the four env vars on the target environment, then `/promote` `develop → main` to ship E5 + Timeline/report work to prod. Or pick the next roadmap build (Report Builder v2 / E6).
