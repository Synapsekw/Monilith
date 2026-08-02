---
type: session
date: 2026-08-01-2021
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, agents, subagent-driven]
related:
  [
    "[[2026-08-01-gotcha-69-a-cookie-gate-turns-a-cron-post-into-a-silent-405]]",
    "[[2026-08-01-gotcha-70-an-interactive-path-reused-unattended-fails-silently]]",
    "[[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]",
    "[[2026-06-19-gotcha-22-parallel-subagent-commit-ref-race]]",
    "[[00-north-star]]",
  ]
---

# Personal Agents — Phase 1, built subagent-driven

## What changed

- **Explored [block/buzz](https://github.com/block/buzz) → scoped Personal Agents.** No code is
  portable (Rust/Nostr/Tauri); three ideas were: agents as first-class members with their own
  identity, agents in the same rooms as humans so **RLS does the security work**, one event log.
  Spec + plan committed, Phase 2 (thread dock, proposals, PDF-to-task) deliberately deferred.
- **Built the 12-task plan with 15 subagents in one shared worktree** — 31 commits, merged to
  `develop` as `4867952e`. Four migrations: `user_agents` / `user_agent_runs` (owner-scoped RLS),
  the sweep + `user_agent_fires` ledger, a Vault-cleanup trigger, and the `agent_briefing`
  notification kind. Gates green at merge: 534 files / 3899 tests / build OK.
- **Provisioned `app_url` in the DEV Vault** — it had never existed, so every signed `pg_cron` hop
  (Autopilot, digest ping, and the new sweep) returned before making a request. `digest_secret`
  followed. Confirmed live with `_health_digest_ping()` → `net._http_response` = **405**, the
  proxy-gate half diagnosed independently by the concurrent session as
  [[2026-08-01-gotcha-69-a-cookie-gate-turns-a-cron-post-into-a-silent-405]].
- **Six of the defects found in review originated in the plan, not the implementations** — a
  missing `is_org_member` guard, a loosely-typed `countOf`, a test fake asserting nothing,
  `callAnthropic` (does not exist), `notifications.user_id` (really `recipient_id`), and
  `notification_kind` being a closed enum. Implementers transcribed faithfully, as instructed.
- **The final whole-branch review caught a task I dropped**: the spec-mandated RLS integration
  suites were announced in the ledger and never dispatched. Eleven scoped reviews could not see
  it — each sees only its own diff. Written and passing now, verified against live DEV.

## Why

The ask was "can we borrow something from buzz" — a roster of per-person agents that email a
morning briefing. The substrate already existed (F14 Autopilot's scheduler, the digest's Resend
path, per-user Vault keys, `get_my_work_items`), so this was generalising an agent from a **board**
to a **person**, not building an agent platform. The security stance follows from that:
`get_my_work_items` is `SECURITY INVOKER`, so running as the owner makes "the agent sees only what
its owner sees" structural rather than conventional.

## How to test (for the user)

Pull `develop`. **Nothing fires until `develop → main` promotes** — the deployed build does not
allowlist the cron endpoints.

1. **Settings → Agents** (now linked in the settings nav).
2. Click **Morning Brief**; name, instructions, cadence and hour arrive pre-filled. Save.
3. Create two more, then try a fourth — expect a cap message. The real cap is **3**; the page's
   "of 20" label is wrong (follow-up).
4. **Settings → Notifications** — confirm a briefing toggle separate from the weekly digest, and
   that toggling one leaves the other alone.
5. After promotion: `select public._health_digest_ping();` then
   `select status_code from net._http_response order by created desc limit 1;` — **200** (not 405)
   means the whole cron chain is live.
6. Sign a body with `AI_PGNET_HMAC_SECRET` and POST `{agent_id, fire_date, fire_hour}` to
   `/api/ai/personal-agent`. POST the **same slot twice**: the second returns `noop` and sends no
   second email — the guarantee the design is built around.
7. Disabling an agent produces **no request and no run row** (the sweep filters `where enabled`) —
   not a `skipped` row.

## Open threads

- **Run history was specced and never built** (`lastRunStatus` hard-coded `null`). This is why a
  failing agent is invisible — and why the provider-mismatch bug would have stayed invisible.
  Highest-value follow-up.
- Promotion is the only unblock; a concurrent session is running it.
- Smaller: the "of 20" cap label; `bridge_secret_id` is client-writable via PostgREST;
  `board_scope` has no DB check constraint; the agent-name unique index is **global, not per-org**;
  `20260801094908` uses a bare `create trigger` (not re-runnable).
- Untested: `updateAgent` / `setAgentEnabled` / `deleteAgent` (real callers exist, so gotcha-66 does
  not apply — a test gap, not a live-endpoint risk). The spec's "owner loses board access" case is a
  known coverage seam; both ways to test it were judged worse than the gap.
- Email needs `RESEND_API_KEY`; without it runs file in-app notifications and send nothing.
- `_draft-2026-08-01-1707.md` belongs to the concurrent landing session — left in place, not folded.

## Next session entry point

Build **run history** (last 50 runs, per-agent last-run status) — it is the missing surface that
makes every other agent failure observable. After that, the small follow-ups above, then the
Phase 2 spec (thread dock, `@mentionable` agents in item threads, propose-writes, per-agent
identities) per `docs/superpowers/specs/2026-08-01-personal-agents-design.md`.
