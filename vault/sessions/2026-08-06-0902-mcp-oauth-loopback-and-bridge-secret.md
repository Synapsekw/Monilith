---
type: session
date: 2026-08-06-0902
branch: develop
trigger: wrapup
status: complete
tags: [session, oauth, mcp]
related:
  - "[[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]]"
  - "[[2026-08-06-gotcha-77-a-per-user-vault-secret-name-caps-a-user-at-one-bridge]]"
---

# MCP OAuth — CLI clients could never connect

## What changed

- **`src/lib/mcp/oauth/redirect-uri.ts` (new)** — `isRegisteredRedirectUri`, now the single predicate
  both `/api/oauth/authorize` and `approveConsent` gate on. Loopback `http` URIs match ignoring the
  port (RFC 8252 §7.3); everything else stays byte-exact. [[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]]
- **`src/lib/mcp/oauth/session-bridge.ts`** — Vault secret names are now per-secret
  (`mcp_bridge:<userId>:<uuid>`), not per-user, on both mint and rotate. [[2026-08-06-gotcha-77-a-per-user-vault-secret-name-caps-a-user-at-one-bridge]]
- **`src/app/api/oauth/token/route.ts`** — code redemption returns the RFC 6749 §5.2 `server_error`
  envelope instead of leaking an unhandled throw as an empty-bodied 500; real cause logged
  server-side only.
- **Tests: +54** — `redirect-uri.test.ts` (21), `session-bridge.test.ts` (8), and the first route
  tests for `/api/oauth/authorize` (7) and `/api/oauth/token` (11), plus consent-action loopback
  cases. Both bugs were reproduced red before fixing.
- **Two promotions:** PR #85 (`0bfa9967`) and PR #86 (`3f3f55b1`). PR #86 also carried another
  session's `vercel.json` (main-only auto-deploy) and the MCP full-surface-reads spec + plan.

## Why

The MCP OAuth server had worked since July — for exactly one client. `claude.ai` registers one fixed
https callback, so exact `redirect_uris.includes()` matching and a per-user Vault secret name both
passed every test and four months of production. Connecting a second, CLI-based client (Hermes)
exposed both at once: the first blocks any client that binds an ephemeral loopback port, the second
blocks any *second* client for a user, period. Neither was reachable from the client we use daily.

## How to test

1. From a terminal, run your MCP CLI's login (`hermes mcp login monolith`) — **foreground**, so the
   loopback listener survives.
2. Sign in at `www.monolith.works` when the browser opens, then click **Allow access** on the consent
   screen. Complete within 60s (the authorization-code TTL).
3. The browser lands on `http://127.0.0.1:<port>/callback?code=…`. A blank "site can't be reached"
   page here is **expected and not ours** — the client's own loopback server renders that page and
   Hermes closes the socket without writing a body.
4. Ask the client to list tools: `list_boards`, `list_items`, `get_board`, `get_item`,
   `search_items`, `create_item`, `update_item`.
5. Quit and log in **again**. The new random port is the exact case that used to fail
   `400 invalid_client`.
6. Ground truth is the DB, not the browser: `oauth_codes.consumed_at` set, and a row in
   `oauth_tokens` with `bridge_secret_id` not null. A user may now hold several — one per client.

## Open threads

- The blank callback page is a Hermes-side gap (its loopback handler should write a "you can close
  this window" body before shutting down). Nothing to change here; raise upstream.
- Three stale `_draft-*.md` stubs were deleted. The 2026-08-04 one's work is already logged in
  [[2026-08-04-2140-carryover-repairs]]; the 08-05/08-06 ones covered the desktop-app spec and MCP
  full-surface-reads spec sessions, which shipped commits but **never got session notes**.
- `/promote`'s step-3 commitlint gate is still mis-scoped (see north-star). Worked around again this
  session by linting the since-last-promotion range; two promotions in, it has now cost this twice.
- Stale local branch `task/offline-read-only` left in place.

## Next session entry point

`develop` and `main` are level at `3f3f55b1`. The MCP full-surface-reads spec + plan landed on
`develop` this session and are unstarted — that plan is the obvious next build. Otherwise the
critical path is unchanged: Report Builder v2 (no spec, no plan) or the E6 Stripe track.
