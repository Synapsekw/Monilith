---
type: session
date: 2026-11-15-1838
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# MCP connection permanence

## What changed

- Reviewed the MCP connector end to end (transport, own OAuth 2.1 server, the Vault-backed Supabase
  session bridge) and found why connections die. One task, `bbde7d67`, merged to `develop`.
- Web sign-out now ends only that browser's session (`src/app/auth/actions.ts`). supabase-js
  defaults `signOut()` to the global scope, which also revoked the sessions behind every connector;
  the old comment claimed the opposite.
- A connection whose stored session is dead re-mints it for the same user instead of failing every
  tool call (`src/lib/mcp/context.ts`); the token row is written only when the secret rotated.
- The refresh token just rotated away stays usable for 60 seconds (`token-store.ts`), backed by
  migration `20261115084107` (two nullable columns and an index on `oauth_tokens`, live on DEV;
  the ledger mis-stamp was relabelled, ledger check in sync).
- "Sign out everywhere" now deletes the user's connector tokens, with the Security page copy
  updated, because a self-healing connector would otherwise survive it.
- No `/updates` entry yet, deliberately: see Open threads.

## Why

The owner had to re-authenticate the connector and asked for it to be simpler and more permanent.
A dead bridge left the MCP token valid, so clients saw tool errors and never re-prompted for
sign-in; the only fix was removing and re-adding the connector by hand.

## How to test (for the user)

After promotion, or on a local production build of `develop`:

1. Connect Claude to Monolith and ask "list my Monolith boards". Boards are listed.
2. In the web app, sign out, then sign back in.
3. Wait over an hour (the cached bridge token has to expire) and ask Claude again. Boards are
   listed with no reconnect prompt.
4. Settings → Security → Sign out everywhere, sign back in, open Settings → MCP. The connected
   apps list is empty and Claude asks to reconnect.

## Open threads

- Verified by unit tests on a faked Supabase client only. No live run of sign-out, self-heal or
  the grace path against real GoTrue. Do the walkthrough above, then announce the fix on `/updates`.
- The refresh-token expiry check in `rotateTokenPair` is dead code (it reads the expiry after
  overwriting it), so expired refresh tokens are accepted. Left alone: fixing it makes connections
  idle over 30 days expire. Owner to choose: fix with a longer lifetime, or leave.
- Concurrent tool calls during a self-heal can each mint a session and orphan a Vault secret.
- MCP is one-way (client-initiated). Options discussed for "Monolith tells my assistant what is
  pending": a scheduled pull of one pending-work tool, the existing `call_webhook` automation
  action, or a Monolith-side agent. Headless bots also need personal access tokens, since the
  connector is OAuth-only. Whether Grok accepts remote MCP with a static token is unverified.
- Larger simplification not started: replace the Vault bridge with a short-lived user JWT signed
  per request. Needs a check of the DEV signing-key setup and any RLS that reads session claims.
- Seven older `_draft-*.md` stubs from other sessions were left untouched.

## Next session entry point

Run the four-step walkthrough on a local production build of `develop`. Then scope personal access
tokens plus a single `get_pending` tool with a webhook event, and decide the refresh-expiry question.
