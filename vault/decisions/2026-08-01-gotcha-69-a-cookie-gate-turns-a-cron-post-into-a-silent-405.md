---
type: adr
status: accepted
date: 2026-08-01
tags: [project/monolith, adr, gotcha, proxy, pg-cron, pg-net, silent-failure]
related:
  - "[[2026-08-01-1146-debt-audit-and-paydown]]"
  - "[[2026-08-01-gotcha-68-a-posix-path-join-silently-disables-a-windows-escape-hatch]]"
---

# Gotcha 69 — A cookie gate turns a cron POST into a silent 405, and the job still reports success

## Context

`item_embeddings` was 0 in **both** environments despite the pipeline having shipped weeks earlier.
Enqueuing 380 rows on prod and watching produced a flat queue: `380 → 380 → 380`, while every
`embed-sweep` run recorded `succeeded`.

`net._http_response` held the answer in one row: **405**.

`src/proxy.ts` gates on a session cookie. A `pg_cron` call carries none, so the proxy 307'd
`/api/ai/embed` to `/login?next=…`, and a POST to `/login` — a **page** route — answers 405. The
sweep's `net.http_post` is fire-and-forget from the function's perspective, so `_embed_sweep_ping()`
returned normally and pg_cron logged success.

Every endpoint `pg_net` posts to was affected — none were in `PUBLIC_PREFIXES`:

| Endpoint | Cron | Feature it silently disabled |
| --- | --- | --- |
| `/api/ai/embed` | `embed-sweep` | E5 semantic search |
| `/api/ai/automation-step` | `automation-ai-reconcile` | F13 AI automation steps |
| `/api/ai/autopilot` | `autopilot-sweep` | F14 Autopilot |
| `/api/digest/run` | `health-digest-ping` | weekly digest |
| `/api/ai/personal-agent` | `personal_agent_sweep` | agent briefings |

## Decision

Add every `pg_net` target to `PUBLIC_PREFIXES`, listed **individually** (never `/api/ai/`, which
would silently make a future session-authenticated route public). Each already verifies its own HMAC
(`AI_PGNET_HMAC_SECRET` via `verifyBody`; the digest uses `DIGEST_SECRET`) before doing anything, so
the exemption exposes nothing — the identical argument the file already made for `/api/mcp`.

Pin it with a test that **derives the endpoint list from the migrations** rather than hardcoding it.

## Rationale

The failure is invisible from every angle you would normally look from. The cron log says
`succeeded`. The function returns cleanly. The queue is full, which reads as "not processed yet"
rather than "cannot be processed". Nothing in the app errors, because the request never reaches the
app. The only witness is `net._http_response`, which nothing surfaces — **note that this contradicts
the intuition that pg_net is fire-and-forget and the DB never learns the outcome. It does learn. It
just never tells anyone.** That table turned a vague "the queue isn't draining" into a diagnosed
middleware bug in about two minutes; check it first, always.

The deeper problem is a missing affordance, not carelessness. Nothing connects "I added a
`net.http_post` to a migration" with "I must now edit `src/proxy.ts`". Three separate features added
a cron endpoint and all three omitted the exemption — the third (`/api/ai/personal-agent`) merged to
`develop` **while this very fix was parked**, and was caught only because the test derives its list
from the migrations. A hardcoded list of the four known endpoints would have passed and shipped the
bug.

## Consequences

- Positive: five cron integrations restored; the derived test fails in CI when a new `net.http_post`
  target is added without an exemption, which is the only reliable moment to catch it.
- Positive: the test guards against reading empty (which would pass vacuously) — the same
  vacuous-pass trap as the Tier 2 fixtures and the anchored conformance parsers.
- **The fix only takes effect in production when `develop` reaches `main`.** Prod runs `main`, so the
  380 queued rows stay queued until the promotion. This inverts the ordering in
  `docs/superpowers/plans/2026-08-01-debt-paydown-and-promotion.md`: **promote first, and the queue
  drains itself within ~15 minutes.** Draining before promoting is impossible.
- Follow-up: `scripts/new-migration.sh` (or its template) should mention `PUBLIC_PREFIXES` when the
  migration contains `net.http_post`. The test catches it; a pointer would prevent it.

## Related

- `[[2026-08-01-1146-debt-audit-and-paydown]]`
- `[[2026-08-01-gotcha-68-a-posix-path-join-silently-disables-a-windows-escape-hatch]]` — same theme,
  different layer: a green signal that means "did nothing" rather than "did the thing".
