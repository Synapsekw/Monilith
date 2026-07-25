---
type: adr
status: accepted
date: 2026-07-24
tags: [project/pulse, adr, gotcha, supabase, auth, mcp]
related:
  - "[[2026-07-24-1950-mcp-server-oauth]]"
---

# Gotcha 56 — refreshing a bridged Supabase session on every request races under concurrent callers

## Context

The MCP server ([[2026-07-24-1950-mcp-server-oauth]]) needs to run every tool call through a real,
RLS-scoped Supabase client for the connected user — not a service-role bypass. The mechanism:
mint a genuine GoTrue session server-side (`admin.generateLink` + `verifyOtp`, no email sent),
store its refresh token in Vault, and on each MCP request call `refreshSession()` to get a fresh
access token, then build the client from that.

The first implementation refreshed on **every single call to `getBridgedClient`**. GoTrue rotates
the refresh token on each use — the old one becomes invalid — so each refresh also rotated the
Vault secret (delete old, create new) and persisted the new secret id back onto the `oauth_tokens`
row. This passed every task-scoped review (it matched the plan's own reference code, and each
task's tests were unit tests against mocks that never modeled concurrency). It only surfaced in
the **final whole-branch review**, which was asked to reason about cross-task integration
specifically — MCP clients (Claude Desktop, claude.ai) routinely dispatch multiple tool calls
concurrently on one connection. Two concurrent calls race over the same single-use refresh token:
one wins, the other either can't find the already-deleted Vault secret or presents an
already-consumed token to GoTrue — and GoTrue's refresh-token reuse detection can respond by
revoking the **entire session family**, permanently bricking the bridge until the user
disconnects and reconnects. There was also a durability gap: the Vault secret was rotated
_before_ the new id was persisted, so a crash in between stranded the row pointing at a deleted
secret.

## Decision

Don't refresh a bridged session on every read. Cache the **access token and its expiry** alongside
the refresh token (as a small JSON blob in the same Vault secret), and only call `refreshSession`

- rotate when the cached access token is actually within a short buffer (60s) of expiring. The
  common case becomes a pure Vault read — no GoTrue call, no secret rotation, no DB write — so
  there's nothing to race for the overwhelming majority of requests (Supabase access tokens are
  valid ~1h by default). The race is reduced to the narrow window of concurrent calls landing
  inside that 60s pre-expiry buffer, which is an acceptable residual risk, not eliminated risk
  disguised as fixed.

## Rationale

- Any server-side "impersonate a real user via a minted session, refreshed per request" pattern
  has this shape by construction — GoTrue's refresh-token rotation is the correct, secure default
  (single-use tokens), which means naive per-request refreshing is _inherently_ racy under any
  concurrent caller, not a bug specific to this implementation.
- A per-task review loop scoped to one task's diff cannot catch this: the flaw only exists in the
  _interaction_ between the session-bridge module (built in isolation, reviewed in isolation) and
  the calling pattern of the MCP transport it's plugged into later. This is exactly what a final,
  whole-branch review with fresh eyes is for — it's worth budgeting one, even after every
  individual task passed its own gate.
- Caching the access token, not just checking-and-skipping the refresh, was the right level: a
  mutex/serialize-per-token approach would have closed the race too, but still paid a GoTrue round
  trip on every single tool call, and only masks — doesn't remove — the durability gap.

## Consequences

- Positive: eliminates the race for the common case, removes a GoTrue round-trip + Vault write
  from the hot path entirely when cached, and the fix required no new migration (same Vault
  secret slot, just a richer payload).
- Negative: a Vault secret written before this fix (bare refresh-token string) will fail
  `JSON.parse` on read — a non-issue since this shipped pre-launch with no existing rows, but
  worth remembering if this pattern is reused: **changing what's stored inside an existing secret
  format needs a migration/fallback path once real data exists**, unlike this first-ship case.
- Open follow-up: the fast-path (`getRequestClient`) still writes `bridge_secret_id` back to
  `oauth_tokens` on every call even when nothing rotated (a harmless same-value no-op update,
  flagged in review as a minor optimization opportunity, not fixed).

## Related

- [[2026-07-24-1950-mcp-server-oauth]] — the session this surfaced in, via subagent-driven-development's final whole-branch review step
- `src/lib/mcp/oauth/session-bridge.ts` — the fixed module
