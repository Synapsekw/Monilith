---
type: session
date: 2026-08-02-0708
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, agents, rls]
related:
  [
    "[[2026-08-01-2021-personal-agents-phase1]]",
    "[[2026-08-01-gotcha-70-an-interactive-path-reused-unattended-fails-silently]]",
    "[[2026-08-02-decision-32-production-runs-the-dev-database]]",
    "[[00-north-star]]",
  ]
---

# Agent run history — the surface that makes a failing agent visible

## What changed

- **Run history shipped** (`38ccf828`, merged `fddd74ca`). `get_my_agent_last_runs()` — a
  SECURITY INVOKER `distinct on` over the existing `(user_agent_id, created_at desc)` index —
  backs a last-run pill on every roster row in **one** query bounded by agent count, not run
  count. The last 50 runs load per agent **on expand** via `getAgentRuns`, mirroring the shipped
  `RecentRuns` disclosure rather than inventing a second pattern.
- **Stored status is not display status, and that distinction is the feature.** The endpoint
  claims its fire slot by writing `status = 'error'` before any spend, so a healthy in-flight run
  is indistinguishable from a failure on `status` alone. `run-status.ts` reads the claim sentinel
  plus the timestamp: fresh → "In progress", stale (>15 min) → "Didn't finish", never "Failed".
  The sentinel now has one definition, imported by the route instead of duplicated.
- **`bridge_secret_id` was client-writable, and RLS could not fix it.** `user_agents_owner_all` is
  `for all`, so the policy is satisfied by the owner patching their own row. The containment is a
  **grant**: `authenticated`'s table-level INSERT/UPDATE was revoked and re-granted column by
  column. It mattered concretely — `user_agents_vault_cleanup` deletes whatever secret id the row
  names, so a writable column was a way to delete **another user's** MCP OAuth secret.
- **Four smaller Phase-1 defects closed in the same migration:** agent-name uniqueness is per-org
  (was global, so "Morning Brief" in one org blocked it in another); `board_scope` gained a check
  constraint matching `boardScopeSchema`; the vault-cleanup trigger is re-runnable; the roster's
  "of 20 agents" now reads the real `max_agents_per_user` (default **3**).
- **Gates green:** 536 files / 3967 tests, typecheck + lint + build clean. New coverage includes
  the three previously untested mutations (`updateAgent` / `setAgentEnabled` / `deleteAgent`) and
  **live-DEV RLS tests** for the new RPC in both directions and for the grant lockdown.

## Why

Phase 1 shipped with `lastRunStatus` hard-coded `null` and the spec's "last 50 runs with a failure
reason" unbuilt, so every failure mode in [[2026-08-01-gotcha-70-an-interactive-path-reused-unattended-fails-silently]]
was silent — a wrong-provider key would kill an agent every morning with nothing to show for it.
This is the observability surface, not a feature on top of one.

The cap label and the grant were bundled because they share a table and an apply. The cap label
was a live lie (the page promised 17 agents it would refuse to create); the grant was a real, if
narrow, privilege issue that only column-level grants can close.

## How to test (for the user)

Pull `develop`. The `develop → main` promotion landed this morning (`8755f9de`) and the cron chain
is **confirmed live** — `_health_digest_ping()` now returns **200**, not 405.

1. **Settings → Agents.** The header should read "N of **3** agents", not "of 20".
2. Create a **Morning Brief** from the gallery, set the hour to the **next** clock hour in your
   org's timezone, save. The row shows **no status pill** (never run) and a collapsed
   **"Recent runs"** toggle.
3. Click **Recent runs**. Expect "No runs yet. This agent runs once a day, at its scheduled hour."
   Nothing else on the page re-fetches — the roster/gallery/editor toggle is still 0 round trips.
4. Wait for the hour to tick over. Reload: the row should carry a **Ran** (green) pill, and
   expanding shows one row — `Ran · <time> · Briefing sent`.
5. **To see a failure surface:** set Settings → AI to a non-Anthropic per-user key and let it fire.
   Expect a **Skipped** (gray) pill and the actual reason inline ("Personal agents currently
   require an Anthropic key…") — that reason was previously invisible.
6. Try creating a **fourth** agent. Expect a readable cap message; the button stays enabled on
   purpose, because the cap is enforced server-side and a dead control explains nothing.

## Open threads

- **The 15-minute stale-claim threshold is a judgement call, not a measurement.** If a real run
  ever legitimately exceeds it, a healthy agent will read "Didn't finish". Worth revisiting once
  there is real timing data.
- **A claimed-but-abandoned slot is never retried** — the fire ledger has consumed it. "Didn't
  finish" is honest about that, but there is no recovery path; a sweeper that reopens stale claims
  is the real fix if it turns out to happen.
- The MCP `apply_migration` version drift recurred exactly as documented (ledger stamped
  `20260802034441` for file `20260802034242`); `reconcile-migration-version.sh` fixed it and
  `db:ledger-check` is green. This is now a reliable, expected step, not a surprise.
- `_draft-2026-08-01-1707.md` and `_draft-2026-08-02-0337.md` belong to the concurrent landing
  session and are **left in place** — both list landing work already captured in
  [[2026-08-01-2000-landing-agentic-redesign]].
- Untouched from Phase 1: the spec's "owner loses board access" RLS case, still judged a
  known coverage seam.

## Next session entry point

Agent observability is closed. The queue is **Report Builder v2** (roll-ups + org templates — one
migration dropping `reports.board_id NOT NULL`, then unwinding the single-board assumption across
access checks, payload fetch, shaping, routing and ~1.4k lines of tests), and the **signup-vs-waitlist**
product call, which now ships live on the promoted landing: the nav says "Get started → `/signup`",
the footer says "Invitation only", and the closing band's waitlist input is inert.
