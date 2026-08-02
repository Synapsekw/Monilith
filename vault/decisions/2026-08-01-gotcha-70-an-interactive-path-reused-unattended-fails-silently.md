---
type: decision
date: 2026-08-01
status: accepted
tags: [decision, gotcha, ai, cron, agents]
related:
  [
    "[[2026-08-01-2021-personal-agents-phase1]]",
    "[[2026-08-01-gotcha-69-a-cookie-gate-turns-a-cron-post-into-a-silent-405]]",
    "[[2026-07-20-decision-29-agentic-automation-guardrails]]",
    "[[00-north-star]]",
  ]
---

# gotcha-70: an interactive code path reused by an unattended one fails silently

## Context

Personal agents run from `pg_cron` — no session, no cookie, nobody watching. They reuse
`runAi` / `resolveAiAdapter`, written for interactive callers where a human is holding the page.
Two independent failures came out of that reuse, and **neither raised anything a human would see**.

**1. Cookie-bound credentials.** `gateway.ts`'s `per_user` branch resolved the *session* user's key
via `requireUser()`. `runAi` already received a `userId` and ignored it. A cron hop has no cookie,
so it threw — and `DEFAULT_ORG_AI_SETTINGS.mode` is `per_user`, the mode an org gets with **no
settings row**. Every run for a default-configured org would have failed, daily, forever.

**2. An error type that assumed an audience.** `AiNotConfiguredError` covered both "this owner has
no personal key" (benign, user-fixable) and "`ANTHROPIC_API_KEY` is missing" (platform-wide,
urgent). Interactive callers surface a prompt, so collapsing them was harmless there. Unattended,
the platform outage recorded `status: "skipped"` with the message _"No AI key on file for this
agent's owner"_ — a false diagnosis, filed as a benign skip, paging nobody.

A third of the same shape survived to the final review: the run gate closed "owner has **no** key"
but not "owner has the **wrong** key". A per-user OpenAI or Gemini key was POSTed to
`api.anthropic.com` → 401 → an opaque `error` row, daily.

## Decision

**When an interactive path is reused by an unattended one, re-derive its assumptions rather than
inheriting them.** Concretely, for anything cron- or webhook-triggered in this repo:

- **Never resolve identity or credentials from the request context.** Take the principal as an
  explicit parameter. `resolveUserAdapterById(userId)` exists for this; the `per_user` branch now
  uses the `userId` `runAi` was already given.
- **A configuration state and a platform failure must be distinguishable in the record.** Config
  states (`PersonalAiKeyMissingError`, `ByoKeyMissingError`, wrong provider) record `skipped` with a
  reason and spend nothing. Platform failures record `error`. Reusing one error type for both
  destroys the only signal an unattended run leaves.
- **Assume nobody reads the result.** If the only evidence of failure is a row in a table with no
  UI, the failure is invisible. Ship the surface, or accept that the feature can die quietly.

## Consequences

- The severity of a finding depends on **who is watching**, not just what breaks. The reviewer that
  found the provider mismatch rated it Minor because it was "inherited from the autopilot route" —
  correct about provenance, wrong about impact: autopilot is opt-in per board, personal agents are
  per person and scheduled, so the same latent bug becomes a daily visible failure for every
  default-configured org. Provenance is not severity.
- **Run history is not a nice-to-have for unattended features.** Personal agents shipped without it,
  which is precisely why all three failures above would have been silent. Logged as the top
  follow-up.
- Pairs with [[2026-08-01-gotcha-69-a-cookie-gate-turns-a-cron-post-into-a-silent-405]]: that one is
  the transport half (the request never arrives), this one is the execution half (it arrives and
  fails without saying so usefully).
