---
type: decision
date: 2026-11-13
status: accepted
tags: [decision, mono, auth]
---

# decision-44 — A Mono gets its own session by minting a fresh one, never by refreshing

**Date:** 2026-11-13
**Status:** accepted (proven on DEV the same day)

## Context

A Mono is a no-login bot user. For RLS to judge its reads and writes by its own memberships, it needs a real Supabase session whose `auth.uid()` is the bot.

- **Nothing in the repo mints JWTs.** DEV signs access tokens with asymmetric **ES256** keys whose private key cannot be exported. Minting our own tokens would mean importing a key and rotating signing for every user on the live project. Not worth it.
- **The MCP OAuth bridge already makes real sessions** for a user id, with `generateLink` (magic link) and `verifyOtp`. Both calls are gated behind the service-role key and no email is sent.
- **Aria (the old scheduled agents) broke because it stored refresh tokens and rotated them.** GoTrue rotates the refresh token on every use. Concurrent refreshes and a lost rotation revoke the session family, and the agent went quiet with no error anyone saw.

## Decision

- `src/lib/mcp/oauth/session-bridge.ts` exports `mintSessionForUser(userId)`, which runs getUserById, generateLink and verifyOtp and returns the `Session` without storing it. It also exports `clientFromAccessToken(token)`. `mintBridgeSecret` is now a thin wrapper that mints and then stores the result in Vault. Its behaviour is unchanged.
- `src/lib/mono/session.ts` exports `getMonoClient(monoUserId)`. It caches the access token per Mono **in process memory only**. It reuses the token until it is within 5 minutes of expiry, then **mints a brand-new session** (about once an hour per Mono per warm instance). It shares one in-flight mint between concurrent callers and does not cache a failed mint. It **never calls `refreshSession`** and stores no refresh token anywhere.
- **Every Mono bot user must have an internal email**, `mono-<uuid>@monolith.internal`, because the magic-link primitive needs one. Create it confirmed (`email_confirm: true`).

## Evidence (DEV `hjqca…`, 2026-11-13)

A throwaway bot `mono-spike-<uuid>@monolith.internal` was created with `admin.createUser({ email_confirm: true, app_metadata: { pre_approved: true } })`. `pre_approved` keeps `handle_new_user` from queueing a pending account approval.

- **Mint #1:** about 0.9 s. Access token `expires_in` 3600 s, JWT `alg` ES256, `session.user.id` equals the bot id.
- **RLS judged the bot as itself:**
  - `profiles where id = bot` returned 1 row, the bot's own.
  - Other profiles returned 0 rows.
  - `org_members` returned 0 rows (the bot belongs to no org).
  - There were no errors.
- **Rate limits:** 5 more mints back to back (6 in total) all succeeded in 0.4–0.6 s each. None was rate limited.
- **Session growth:** after 6 mints the bot had **6 rows in `auth.sessions` and 6 in `auth.refresh_tokens`**. Each mint leaves a live session behind.
- **Cleanup:** `admin.deleteUser(bot)` cascaded. Afterwards `auth.users` had 0 `mono-spike-%` rows, and the bot had 0 rows in `auth.sessions`, `profiles` and `account_approvals`. The script was run from `node_modules/.cache/` and then deleted. It was never committed.

## Consequences

- **Each mint leaves a GoTrue session (plus an unused refresh token) behind.** At one mint per hour per Mono per warm instance, that adds up. Plan 2 must either sign out superseded sessions (for example, `admin.signOut` on the previous session's JWT, or a periodic prune of the bot's `auth.sessions` older than the token lifetime) or deliberately accept the growth and say so.
- **Plan 2 must give every Mono an email** (`mono-<uuid>@monolith.internal`), confirmed at creation, and should pre-approve it so it never appears in the admin approval queue.
- The cache is per serverless instance, so a cold start mints again. That is correct but means a few extra mints. The 6-mint burst shows no rate limit at this scale. If many Monos share one instance burst at once, watch for GoTrue rate limits on `generateLink`/`verifyOtp`.
- **Rejected:** self-signed JWTs (ES256 key not exportable) and stored refresh tokens (Aria's failure). The fallback (a service-role client plus explicit membership checks in a definer applier) is not needed.
