---
type: decision
date: 2026-08-06
tags: [decision, gotcha, oauth, mcp, spec-compliance]
related:
  - "[[2026-08-06-0902-mcp-oauth-loopback-and-bridge-secret]]"
  - "[[2026-08-06-gotcha-77-a-per-user-vault-secret-name-caps-a-user-at-one-bridge]]"
---

# Gotcha 76 — exact redirect_uri matching locks out every CLI client

## What happened

Both redirect-URI gates — `/api/oauth/authorize` and `approveConsent` — decided whether a
redirect_uri belonged to a client with a plain `client.redirect_uris.includes(candidate)`.

That is correct for the only client we had ever tested with. `claude.ai` registers one fixed
`https://claude.ai/api/mcp/auth_callback` and presents that exact string forever, so exact matching
passed every test, every review and four months of production.

It breaks **every native/CLI client**, structurally. An RFC 8252 native client asks the OS for an
*ephemeral* loopback port at login time. It registers `http://127.0.0.1:38559/callback` on its first
run via dynamic client registration, and its **next** run binds a different port and presents
`http://127.0.0.1:45011/callback`. Exact matching rejects it `invalid_client`.

Measured against production before the fix:

```
port 38559 -> 307   (the port that happened to be registered)
port 45011 -> 400 invalid_client
```

RFC 8252 §7.3 is explicit that this is the server's job, not the client's: an authorization server
**MUST** "allow any port to be specified at the time of the request for loopback IP redirect URIs,
to accommodate clients that obtain an available ephemeral port from the operating system".

## Why it matters here

The bug is invisible to the test suite and invisible to the one client we use daily. Nothing about
`includes()` looks wrong; it looks like the careful thing to do. The failure only appears for a class
of client we had never connected, and it presents to that client as `invalid_client` — a message that
blames the *client's* registration, sending the operator to debug the wrong side entirely.

That is what happened: the first diagnosis from the connecting agent was "the authorization page's
Continue button doesn't work, send a screenshot". There is no Continue button in this app. The real
evidence was in the DB — `oauth_clients` had a Hermes row, `oauth_codes` had none for it, so the
flow died before consent, not at it.

## The rule

**A spec's MUST that you have never exercised is an untested branch.** When implementing a protocol,
the clients you happen to test with define a *subset* of the surface; the RFC defines the rest. For
redirect URIs specifically:

- Loopback (`http`) redirect URIs match **ignoring the port**. Everything else — scheme, host, path,
  query, fragment, embedded credentials — still matches exactly.
- Non-loopback URIs stay strictly exact. Port flexibility on a remote host would be an open redirect.
- `127.0.0.1`, `[::1]` and `localhost` are **three distinct registrations**, never normalized to each
  other. RFC 8252 §8.3 warns `localhost` resolves through host name resolution and may not reach the
  loopback interface, so a client that registered the IP literal must not become redirectable to a
  name.
- The token endpoint keeps its strict `!==` compare. It answers a *different* question (RFC 6749
  §4.1.3: does the presented URI match the one recorded on this code?) and is meant to be exact.

Structurally: both gates now call one predicate, `isRegisteredRedirectUri`
(`src/lib/mcp/oauth/redirect-uri.ts`). Two copies of this rule would drift, and the two drift
directions are both bugs — a laxer authorize renders a consent screen that then throws, a laxer
consent is an open redirect.

## Related

- [[2026-08-06-gotcha-77-a-per-user-vault-secret-name-caps-a-user-at-one-bridge]] — the next failure
  in the same connect, found only once this one was fixed.
