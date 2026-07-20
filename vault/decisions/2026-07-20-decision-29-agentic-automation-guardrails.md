---
type: decision
date: 2026-07-20
status: accepted
tags: [decision, ai, automations, agentic, security, phase-10, e5]
related:
  [
    "[[00-north-star]]",
    "docs/superpowers/specs/2026-07-14-e5-agentic-semantic-design.md",
    "docs/superpowers/plans/2026-07-14-e5-agentic-semantic.md",
  ]
---

# decision-29: Agentic-automation guardrail box (E5 F13/F14)

## Context

Until E5, every AI write in Pulse followed **propose → human approves → persist** (E2/E3/E4). E5's
F13 ("AI action step" in a rule) and F14 ("Autopilot" scheduled board agent) deliberately **relax**
that stance: an automation is, by definition, **unattended action** — the whole point is that it runs
with no human in the loop. That relaxation is only safe inside a hard, enforced guardrail box. This
ADR records the box, because "the AI can now write to your board without asking" is a claim that must
be bounded in code, not prose. Full design: the E5 spec §4.1.

## Decision — the six guardrails (all enforced, all verified on DEV)

1. **Human authorship + explicit enable.** A person builds the rule / agent and toggles it `enabled`.
   The AI never creates or enables an automation (E4 invariant preserved). `board_agents` write is
   RLS-gated to org **owner/admin**; the `ai_step` action is authored in the existing rule builder.

2. **Constrained, reversible action vocabulary only.** The model **chooses parameters within** the
   existing bounded actions; it can never invent an action shape. F13 allows a per-step subset of
   `{set_option, set_percent, move_to_group, notify}`; F14/Autopilot allows only
   `{move_to_group, set_percent, notify}` (never `set_option`). **Never** `call_webhook`, never
   delete/archive, never arbitrary SQL. Enforced twice: the Zod `ai_step` schema rejects
   `call_webhook`/unknown at the boundary, and the confined SQL appliers return
   `ai_skipped_bad_type` for anything outside the vocabulary.

3. **Execution stays in a confined SECURITY DEFINER applier.** The model **decides**; the mutation
   goes back through `automation_ai_apply` (F13) / `board_agent_apply` (F14), which re-apply the same
   per-action confinement guards as `_automation_run` (target column/group must belong to the board;
   notify recipient must be `is_member_of` the org; item must be top-level on the agent's board). The
   AI never gets a raw write path. Both appliers are `search_path=''`, `revoke ... from
public/anon/authenticated`, `grant ... to service_role` — **verified: `authenticated` cannot
   execute either**.

4. **Full audit + kill switch.** Every agentic evaluation writes an `automation_runs` /
   `board_agent_runs` row (outcomes `ai_decided` / `ai_skipped*` / `ai_error`). Kill switches: a
   per-rule/agent `enabled` toggle, and org-level `ai_mode = off` disables all of it. A minute-cron
   (`automation-ai-reconcile`) times out wedged jobs; the Autopilot sweep is idempotent via the
   `board_agent_fires` ledger.

5. **Entitlement-gated + metered + bounded spend.** Every model call is preceded by
   `requireAiEntitlement(org, feature)` and wrapped in `runAi` so tokens/cost/credits land in
   `ai_usage`. `off` / over-quota short-circuits to a skipped job with **no token spend**. Per-run
   round + token caps bound worst-case cost. Execution is off the request path entirely (pg_cron /
   pg_net driven).

6. **Dry-run / preview.** The F13 builder offers "Test this step" — runs the AI decision against a
   sample item and shows the chosen action **without applying it** (reuses the E3/E4 propose→preview
   pattern).

## The one new architectural piece — the async model hop

`_automation_run` runs inside the mutating transaction as a definer, so it **cannot** call a model
inline. F13/F14 mirror the existing `call_webhook` path exactly: enqueue an audited job → non-blocking
`pg_net` `net.http_post` of an **HMAC-signed** body → a service-role Next route (`/api/ai/automation-step`,
`/api/ai/autopilot`) verifies the signature (`AI_PGNET_HMAC_SECRET`, Vault mirror
`ai_pgnet_hmac_secret`, base URL from Vault `app_url`), runs `runAi`, and hands the **chosen** action
back through the confined definer. One outbound-to-model architecture for the whole epic (F15's embed
pipeline reuses the same substrate).

## Agent identity

F14 authors comments/notifications as a dedicated **platform bot** — one `auth.users` row
(`pulse-autopilot@pulse.internal`, no password, cannot log in, fixed id, seeded idempotently) with a
`profiles.is_agent = true` flag for badging, resolved via `platform_agent_user_id()`. Truthful
attribution that satisfies the frozen-`author_id` trigger; the bot never holds a session or client key.

## Consequences

- Pulse now has genuinely unattended AI writes — bounded, reversible, audited, killable, metered.
- The blast radius is a small reversible vocabulary applied through the same guards a manual rule
  uses; the AI's only new power is _choosing parameters_, not _choosing capabilities_.
- Confirmed against the E1 "no self-deploying automations" invariant: a human authors and enables
  every agentic rule/agent; the AI cannot mint or enable one.
