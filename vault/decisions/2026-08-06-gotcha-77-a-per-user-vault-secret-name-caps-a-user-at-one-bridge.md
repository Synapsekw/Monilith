---
type: decision
date: 2026-08-06
tags: [decision, gotcha, oauth, mcp, vault, agents]
related:
  - "[[2026-08-06-0902-mcp-oauth-loopback-and-bridge-secret]]"
  - "[[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]]"
---

# Gotcha 77 — a per-user Vault secret name caps a user at one bridge, forever

## What happened

With gotcha-76 fixed, the same connect got one step further and died again: `POST /api/oauth/token`
answered **HTTP 500 with an empty body**. The client could report only "500, no token".

The cause was visible nowhere but the platform log:

```
Error: duplicate key value violates unique constraint "secrets_name_idx"
```

`vault.secrets.name` carries a UNIQUE index. `oauth_bridge_rotate_secret` inserts through
`vault.create_secret(p_secret, p_name, …)` (`supabase/migrations/20260724133321_mcp_oauth.sql`), and
`mintBridgeSecret` always asked for `p_name = 'mcp_bridge:' || userId` with `p_old_secret_id = null`.

The name was derived **only from the user id**, so the *first* bridge a user ever minted squatted it
permanently:

- Connect one MCP client → `mcp_bridge:<uid>` exists. Connect a second → collision, 500, forever.
- `src/lib/agents/owner-client.ts` mints through the same function, so the reverse pairing broke too:
  a user with a personal agent could not connect an MCP client at all.

This account had held `mcp_bridge:edd948c1-…` since a `claude.ai` connection on 2026-07-27. Every
subsequent client was structurally unable to connect, and had been since the feature shipped.

## Why it matters here

Two failure modes compounded, and the second is the expensive one.

**The naming was wrong in a way that reads as right.** "One bridge secret per user" is a sentence
that sounds like a design, not a bug. It is wrong on its own terms: each client holds its **own**
GoTrue session, so collapsing them onto one Vault row would make each client's refresh rotate the
other's token out from under it. The unique index was not an obstacle to work around — it was
correctly telling us the key was wrong.

**The 500 had an empty body.** The route let an unhandled throw escape, so Next answered a bare 500
with nothing in it. Every layer that could have named the cause — the response, the client's error
report, the operator's first hypothesis — carried no information. Diagnosis required going to the
Vercel runtime log and matching on a timestamp. A route that already returns a structured
`{"error": …}` envelope on all four of its *validation* branches, and nothing at all on its
*infrastructure* branch, has an observability hole exactly where failures are least predictable.

## The rule

**A uniqueness key must be as fine-grained as the thing it identifies.** Name a secret after the
credential it holds, not after the principal it belongs to — one user legitimately holds many
sessions. The user id belongs in the name only as a greppable *prefix*:

```
mcp_bridge:<userId>:<uuid>
```

The rotation path needs the same treatment. Its `DELETE` of `p_old_secret_id` frees only *that*
bridge's name, so a sibling bridge for the same user collides there identically.

**And: an endpoint that speaks a structured error protocol must speak it on its failure paths too.**
Code redemption now returns the RFC 6749 §5.2 `server_error` envelope and logs the real cause
server-side — never in the response body. The generalisable form: *the branches you did not
anticipate are the ones whose errors you most need to read.*

## Consequences

- Positive: multiple MCP clients per user now coexist — verified live, two token rows (Claude +
  Hermes) with distinct bridges for one user. Personal agents and MCP clients no longer contend.
- Positive: token-endpoint failures are now self-describing to the client.
- Neutral: pre-existing `mcp_bridge:<uid>` secrets are left in place. They are valid and no longer
  contended, so no migration or cleanup is owed.
- Open follow-up: nothing sweeps Vault secrets orphaned by a token row deleted outside the
  before-delete trigger's path. Not observed, not currently a problem.

## Related

- [[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]] — the failure
  immediately upstream of this one; this bug was unreachable until that was fixed.
