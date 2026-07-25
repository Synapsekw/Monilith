# MCP Server — Design

**Date:** 2026-07-24
**Status:** Approved (brainstorm) — ready for implementation plan
**Author:** Dani (with Claude)

## Summary

A hosted **remote MCP server** — a new integration surface on the existing Pulse Next.js
deployment — that lets AI agents (Claude Desktop, claude.ai custom connectors, Claude Code,
other MCP-speaking clients) connect as a specific Pulse user and read and write items on
boards on that user's behalf. This is net-new scope: `docs/prd.md` §6 currently lists
"third-party integrations marketplace" / "OAuth app registrations" as an explicit non-goal —
this spec supersedes that line for the MCP use case specifically (agent-as-user, not a
third-party integrations marketplace).

## Goals

- An AI agent can connect to Pulse over MCP, authenticate as a real Pulse user via OAuth, and
  call tools to list boards, read items, create items, and update items.
- Every tool call is authorized by the **same RLS policies** that protect the app today — no
  service-role bypass, no parallel authorization system to keep in sync.
- No changes to the existing board/item schema or Server Action behavior.

## Non-goals (explicit v1 scope line)

- **No delete operations** — create/update/read only.
- **No board/column/group creation or mutation** via MCP — items only.
- **No automations, relations, comments, attachments, dashboards, goals** as MCP tools.
- **No per-board allowlisting** — a connected agent has exactly the same visibility as the
  user has when logged into the app (full permission-set inheritance, not a scoped subset).
- **No MCP "resources" or "prompts" primitives** — tools only.
- **No quota/billing system for MCP usage** — a basic per-token rate limit is in scope, a full
  usage-metering system is not.
- **Local/stdio transport is out of scope for v1** — remote (hosted) only.

## Architecture

Two new subsystems inside the existing Next.js app — no separate service, no new deployment
target.

### 1. MCP transport — `/api/mcp`

A route handler built on Vercel's `mcp-handler` package (wraps `@modelcontextprotocol/sdk`),
implementing the **Streamable HTTP** transport — the transport Claude Desktop and claude.ai
custom connectors expect for a remote server. Every request carries a bearer access token
issued by the OAuth server below; the route resolves that token to a request-scoped, RLS-bound
Supabase client (see "Auth bridging") before dispatching to a tool handler.

### 2. OAuth 2.1 Authorization Server — `/api/oauth/{register,authorize,token}`

- `POST /api/oauth/register` — dynamic client registration (MCP clients self-register on first
  connect; no manual app-registration step for the user).
- `GET /api/oauth/authorize` — if the user has no Pulse session, sends them through the
  **existing Supabase Auth login UI** first; once authenticated, shows a one-time consent
  screen ("Claude wants to access your Pulse account") and redirects back with an
  authorization code. PKCE required.
- `POST /api/oauth/token` — exchanges the code (or a refresh token) for an MCP access token.

### Auth bridging — the core design decision

The repo's standing invariant is **RLS is the security boundary; never trust the client** —
every existing write path (Server Actions) runs through a cookie-bound Supabase client so
`auth.uid()` in RLS policies reflects a real, live session. MCP requests arrive with our OAuth
access token, not a Supabase session cookie, so each `/api/mcp` call must resolve to a genuine
RLS-respecting Supabase client for that user rather than falling back to a service-role client.

**Approach:** at OAuth consent time, use the Supabase Admin API to mint a real GoTrue session
(access + refresh token) for the consenting user. Store the refresh token **encrypted in
Vault**, reusing the exact storage pattern already shipped for per-user BYO AI keys
(`byo-ai-per-user-keys-shipped` — Settings → AI). On each `/api/mcp` request: look up the
OAuth access token → load the associated Vault-stored Supabase refresh token → refresh it to
get a live Supabase access token → build a request-scoped Supabase client from that token →
run the tool handler through it. RLS applies exactly as if the user were logged into the app;
no service-role client touches user data on this path.

**Open question flagged for the implementation plan (spike first):** the exact Admin API call
to mint a session server-side needs to be confirmed against the current `supabase-js`/GoTrue
version in this repo. The project uses **ES256 asymmetric JWT signing** (confirmed via
`getClaims()` in `src/lib/auth/session.ts`), which rules out hand-signing JWTs with a shared
secret — the session must be a real GoTrue-issued one (e.g. via an admin-generated link/OTP
exchange, or an equivalent current API). If no clean server-side session-minting path exists,
this is a **blocking finding** for the plan, not something to route around with a service-role
shortcut.

## Data model — new tables only

No changes to boards/items/columns/cells. Three new tables (migration via
`scripts/new-migration.sh`):

- `oauth_clients` — dynamically registered MCP client apps (client_id, redirect_uris, name).
- `oauth_codes` — short-lived authorization codes (code, client_id, user_id, PKCE challenge,
  expiry).
- `oauth_tokens` — issued access/refresh tokens (hashed at rest), `user_id`, pointer to the
  Vault-stored Supabase refresh token, expiry, revocation state.

All three are org-agnostic (keyed by `user_id`, not `organization_id`) since a connection is
per-user, not per-org — RLS on the underlying board/item tables is what enforces org
boundaries once the bridged client is built.

## Tools (v1)

Six tools, matching "read + write, no delete":

| Tool           | Purpose                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `list_boards`  | Boards visible to the user (id, name, org)                                          |
| `get_board`    | Board metadata + columns (id/name/type) + groups — schema context for create/update |
| `search_items` | Text search / filter within a board, bounded + paginated                            |
| `get_item`     | Full item detail including cell values                                              |
| `create_item`  | New item in a board/group with initial field values                                 |
| `update_item`  | Update fields/cell values on an existing item                                       |

**Integration note for the plan:** existing Server Actions in `src/lib/boards/actions/` likely
resolve their own cookie-bound Supabase client internally. MCP requests have no cookie jar —
only the bridged client from the auth layer. The plan should verify whether the core mutation
logic already accepts an injected client (as `queries.ts` does) or needs a small refactor to
accept one, so MCP tool handlers and Server Actions share one mutation code path instead of
duplicating write logic. Each tool's input is a Zod schema (this repo's existing validation
library), and tool errors map to MCP `isError: true` responses rather than throwing —
consistent with the `ActionResult`/`fail` convention already used by Server Actions.

## Testing

- Zod schema tests for each tool's input shape.
- OAuth flow tests: code exchange, PKCE verification, token expiry, refresh.
- An integration test that proves cross-org access is blocked **through the bridged client**
  (an actual RLS check, not an app-level permission check standing in for one).
- A manual end-to-end pass: connect a real Claude Desktop or claude.ai custom connector to a
  dev deployment and run through list → create → update.

## Performance & data-fetching budget (working agreement #5)

- `search_items` and `list_boards` are paginated/bounded — no unbounded `select *` over
  growing tables; both read over indexed columns already used by the existing board queries.
- This is a request/response tool-call API, not a UI with tabs/filters/interaction state — the
  "0 new round-trips on in-page toggles" clause doesn't apply; every tool call is inherently a
  server round-trip by design (an agent asking Pulse for or to change data).

## Risks / things that could invalidate this design

- The auth-bridging session-minting mechanism (the flagged open question above) may not have a
  clean current API — this is the single biggest technical risk and should be spiked before
  the rest of the plan is built out.
- MCP client OAuth support varies — dynamic client registration and PKCE are the MCP spec's
  recommended path, but should be verified against the actual client(s) the user intends to
  connect (Claude Desktop / claude.ai) before assuming zero client-side friction.
