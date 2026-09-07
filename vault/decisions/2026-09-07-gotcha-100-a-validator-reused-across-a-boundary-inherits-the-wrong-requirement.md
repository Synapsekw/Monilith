---
type: adr
date: 2026-09-07
status: accepted
tags: [decision, gotcha, oauth, mcp, validation]
related:
  - "[[2026-09-07-0901-oauth-native-schemes-promote-110]]"
  - "[[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]]"
---

# Gotcha 100 — a validator reused across a boundary inherits the wrong requirement

## Context

Cursor could not connect to Monolith's MCP server. Dynamic client registration
(`POST /api/oauth/register`) rejected its callback `cursor://anysphere.cursor-retrieval/…`
with `invalid_client_metadata: URL must be http or https`, so the connect flow
died before a browser ever opened.

The rejecting rule was `isHttpUrl`, imported by `src/lib/validations/mcp-oauth.ts` from
`src/lib/validations/boards.ts`. In its home module that function is exactly right and
its comment says why: a **link cell** is rendered as an `<a href>` any board viewer can
click, so http(s)-only is the stored-XSS defence.

An OAuth authorization server is not a link cell. RFC 8252 §7.1 has native apps redirect
to a **private-use scheme** (`cursor://`, `vscode://`, `com.example.app://`). Sharing the
predicate silently exported the board's requirement into a place where a different rule
applies — and no type, test or lint could notice, because both call sites want "is this
URL safe to send a user to?" and only the answers differ.

This is the **second** time this exact surface broke for a client that was not `claude.ai`.
[[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]] was the
same shape one layer down: a rule that is correct for one fixed https web callback,
generalised by accident to every client.

## Decision

Give the OAuth boundary its own scheme predicate, `isAllowedRedirectUri`, living beside the
matcher it belongs with in `src/lib/mcp/oauth/redirect-uri.ts`, and use it for **all three**
schemas (register, authorize, token). `isHttpUrl` stays untouched and keeps guarding board
link cells.

The rule is two-part, and both parts are load-bearing:

- **Deny list** — `javascript:`, `vbscript:`, `data:`, `blob:`, `file:`, `about:`,
  `filesystem:`, `view-source:` are never redirect targets.
- **Hierarchical form** — any non-http(s) scheme must parse as `scheme://…`, which keeps
  opaque `mailto:` / `tel:` URIs out.

Neither alone is sufficient. `javascript://%0aalert(1)` passes the hierarchical test (the
`//` is a JavaScript line comment), so shape checking cannot replace the deny list; and the
deny list cannot enumerate every opaque scheme, so it cannot replace the shape check.

One schema constant is shared by the three endpoints on purpose: a laxer register than
authorize registers a callback that authorize then refuses, which reads to the client as an
intermittent server, not as a validation rule.

## Rationale

Alternatives rejected:

- **Allow only a hardcoded list of known client schemes** (`cursor:`, `vscode:`, `claude:`) —
  breaks the next client for the same reason as the original bug, and dynamic registration
  exists precisely so a new client needs no deploy.
- **Require a reverse-DNS scheme** (a dot, as RFC 8252 §7.1 recommends) — Cursor's scheme is
  `cursor`, with no dot. The recommendation is not what clients do.
- **Relax `isHttpUrl` itself** — would widen the board link cell to `cursor://` hrefs, which
  is a new XSS-adjacent surface for a reason unrelated to boards.

Scheme permissiveness is not an authorization relaxation: a redirect target must still be one
the client registered (`isRegisteredRedirectUri`), and the RFC 8252 §7.3 loopback port
flexibility remains scoped to `http` loopback URIs — an app scheme matches exactly or not at
all.

## Consequences

- Positive: native/desktop MCP clients can complete an OAuth login. Verified end-to-end —
  registration and authorize probed live before merge, and the owner connected a real native
  client (Grok bot) against production after PR #110.
- Positive: the OAuth boundary now states its own rule in its own module, so the next reader
  sees an RFC citation rather than a link-cell XSS comment.
- Negative: two similarly-named URL predicates now exist. Mitigated by each documenting what
  the other is for, in both directions.
- Open follow-up: nothing blocks; the `http:` non-loopback case (a plaintext remote callback)
  is still accepted and was out of scope for this fix.

## Related

- [[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]] — same
  surface, same "correct for the only client we had seen" failure mode.
- The generalisable rule: **a shared validator exports its home module's threat model along
  with its signature.** Before reusing one across a boundary, read the comment that says why
  it is strict — if that reason does not hold at the new call site, the rule does not either.
