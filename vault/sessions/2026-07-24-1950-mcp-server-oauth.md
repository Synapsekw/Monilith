---
type: session
date: 2026-07-24-1950
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-07-24-gotcha-56-per-request-session-refresh-race]]",
    "[[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]",
    "[[2026-07-25-0821-develop-sync-acl-migration-backfill]]",
  ]
---

# MCP Server — OAuth 2.1 authorization server + read/write tools

## What changed

- Shipped a hosted **MCP server** so AI agents (Claude Desktop, claude.ai) can connect as a real
  Monolith user and read/write board items: a from-scratch **OAuth 2.1 authorization server**
  (`/api/oauth/{register,authorize,token}`, RFC 8414 + RFC 9728 discovery, PKCE, a consent screen
  reusing the existing login) plus `/api/mcp` (Streamable HTTP via `mcp-handler` +
  `@modelcontextprotocol/sdk`), where every tool call runs through a **real, RLS-scoped Supabase
  session** for the connecting user — no service-role bypass anywhere near board/item data.
- Six tools: `list_boards`, `get_board`, `search_items`, `get_item`, `create_item`, `update_item`
  (deliberately no delete/archive/move). Plus a Settings → Connected Apps page (list + revoke),
  added beyond the originally-approved tool list to close a token-revocation gap.
- New migration `20260724133321_mcp_oauth.sql` (`oauth_clients`/`oauth_codes`/`oauth_tokens`,
  RLS default-deny, Vault-backed bridge-secret RPCs). 24 commits on `task/mcp-server`, merged to
  `develop` at `86f34fd`.
- Built with **subagent-driven-development**: a fresh implementer + independent reviewer per plan
  task (14 tasks), then a final whole-branch review on the most capable model. The review process
  caught and fixed real security bugs before merge — see [[2026-07-24-gotcha-56-per-request-session-refresh-race]]
  for the most consequential one.
- Spec: `docs/superpowers/specs/2026-07-24-mcp-server-design.md`. Plan:
  `docs/superpowers/plans/2026-07-24-mcp-server.md`.

## Why

Monolith's Phase 10 roadmap wants AI agents to act on the user's behalf inside their own tools
(Claude Desktop, Claude Code) rather than only inside Monolith's own chat surfaces. MCP is the
emerging standard transport for that; building it as a genuine OAuth-fronted remote server (not a
pasted API key) matches how Claude Desktop/claude.ai's "custom connector" flow actually works, and
routing every tool call through a real per-user Supabase session (rather than a service-role
shortcut) keeps RLS as the one security boundary instead of adding a second, parallel
authorization system to keep in sync.

## How to test (for the user)

1. Pull `develop`. Deploy to a preview URL (or run `pnpm dev` with a public tunnel — Claude
   Desktop/claude.ai need a reachable HTTPS URL for `/api/oauth/*` and `/api/mcp`).
2. In Claude Desktop or claude.ai, add a custom connector pointing at `https://<host>/api/mcp`.
3. It should complete dynamic registration and redirect to your existing Monolith login (if not
   already signed in) — sign in — then a consent screen ("X wants to access your Monolith account")
   — approve it.
4. The connector should show as connected with 6 tools available.
5. Ask the agent to list your boards — should match exactly what you see in the app.
6. Ask it to create an item on a board/group, then update its name and a field — both changes
   should appear in the Monolith UI immediately.
7. Confirm there's no delete/archive tool offered.
8. In Settings, confirm the new "Connected apps" card lists the connection, and Revoke removes it.

## Open threads

- **`/login` doesn't read a `?next=` param** — a not-yet-logged-in user starting the OAuth connect
  flow won't auto-resume back into consent after signing in (lands on the dashboard instead,
  needs to re-click connect). Pre-existing, app-wide gap (every `requireUser()` redirect has the
  same limitation) — not introduced by this branch, but this is the first flow where it actually
  bites an external client. Worth a small follow-up (`next` param support in the login page).
- Revoke button failures aren't surfaced in the UI (silent no-op on error) — `ConnectedAppsSection`.
- `/api/oauth/register` has no rate limit — unbounded dynamic client registration.
- `writeCellValue` is duplicated near-verbatim between `create-item.ts`/`update-item.ts`, and a
  `GetClient` type is redeclared in six tool files instead of a shared module — fine for now,
  natural extraction candidate.
- No live end-to-end connection test against an actual Claude Desktop/claude.ai client was run
  this session (no browser/tunnel access from the agent) — the manual checklist above is untested
  in practice, only the OAuth/MCP mechanics themselves were verified live against dev Supabase.

## Next session entry point

Either promote `develop → main` to ship this (bundled with whatever else is ahead of prod — check
north-star §3), or pick up the `/login` `?next=` follow-up and a real Claude Desktop connection
test before considering the MCP server done-done.
