---
type: session
date: 2026-09-07-0931
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-07-0901-oauth-native-schemes-promote-110]]"
  - "[[2026-09-04-1253-close-three-stalled-worktrees]]"
---

# Spec 3 — orchestration and @handle addressing, scoped and built in eleven tasks

## What changed

- `/whats-next` triage, then Spec 3 scoped to a spec + plan and built as **11 tasks across 4
  worktree batches**, each branch gated and merged one at a time:
  `docs/superpowers/specs/2026-09-04-agent-orchestration-addressing-design.md` +
  `plans/2026-09-04-agent-orchestration-addressing.md`.
- Shipped: a seeded per-user orchestrator delegating to other agents through **one** `delegate`
  tool (`{handle, task}`, roster in the description, server-built enum — not one tool per agent,
  because that makes the tool namespace a function of user text), `@handle` in item updates and
  `/ask`, a renameable per-org assistant name, and a nested-run tree in the run history.
- Containment lives in the database: `agent_run_claim`, a SECURITY DEFINER RPC enforcing depth ≤1,
  fan-out ≤3, a 5-minute mention cooldown, the org daily cap and ownership **under a row lock** —
  the only path that may create a non-scheduled run.
- Four migrations (`20260905045101/045106/045108/045111`); ledger 156/156. Promoted in **PR #110**.
- Announced on `/updates`: `@handle` in Ask, and the renameable assistant. Delegation deliberately
  **not** announced — it is inert until an admin opens the ceiling.

## Why

Spec 3 was the last unblocked slice of Phase 10, the final phase. With it merged the build is
feature-complete except for E6 billing, which is what gates declaring feature-complete and cutting
production over from the DEV database to the idle PROD project.

## How to test (for the user)

1. Pull `develop`, `pnpm install`, `pnpm dev`. Ensure `.env.local` has `AI_PGNET_HMAC_SECRET` and
   `APP_BASE_URL`, or mention dispatch no-ops and logs `mention dispatch not provisioned`.
2. **Settings → Agents** — every row shows `@handle` and its real schedule; a manual agent reads
   "Only when you ask", not "Daily at 07:00".
3. New agent: type a Name, watch Handle auto-fill; hand-edit it, change the Name again — the handle
   must not move. `everyone` → "That handle is reserved."; a duplicate → "You already have an agent
   with that handle."
4. Open the built-in **Assistant** — no Delete button, everything else saves; the roster count
   excludes it.
5. **Settings → AI** → rename the assistant, reload, then check a board's Autopilot card reads
   "posting as <new name>".
6. Item → **Updates** → post `@ops what's blocking us?`. The comment saves at once with a toast;
   within ~10–60s the agent replies **answering the question**, badged AGENT.
7. Post again inside five minutes — the comment still saves and a toast explains the cooldown.
8. **`/ask`** → type `@op`, pick the suggestion, send — answered in that agent's voice.
9. To see a nested run at all: as an admin tick **`agent.delegate`** in the org ceiling, grant it to
   an agent, keep a second agent enabled, then run the first. Recent runs shows the child indented
   with a subtree token total.

## Open threads

- **E6 Stripe is the only feature epic left, and it is blocked on you** — `stripe` is still absent
  from `package.json`; units B/C/E need at minimum a test-mode key to be verifiable.
- **Two shipped features are dark.** Verified on DEV: of 9 orgs, **0** carry `memory.write` and
  **0** carry `agent.delegate`. Agent memory and delegation stay inert until an admin opens the
  ceiling. Mentions and `@handle` work without it.
- One owner has ≥2 enabled agents, so their runs now *see* a `delegate` tool the ceiling denies —
  a longer prompt, no behaviour change.
- An ungranted `delegate` call becomes a proposal the approval path cannot rebuild, so it degrades
  to "delegate is no longer available". Honest, but worth suppressing.
- `maxDuration = 300` is the non-Enterprise platform ceiling; the next fix is a smaller fan-out,
  not a longer timeout. Not yet verified against a real delegating run on the deployment.

## Next session entry point

Provision a Stripe test-mode key and start **E6** (units B+E → C/F/G → H) — the last thing between
here and declaring feature-complete. Decide separately whether to open the org ceiling for
`memory.write` and `agent.delegate`, or two shipped features stay dark.
