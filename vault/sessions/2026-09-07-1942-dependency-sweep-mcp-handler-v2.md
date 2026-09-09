---
type: session
date: 2026-09-07-1942
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-07-1904-agents-page-and-promote-115]]"
  - "[[2026-09-07-1726-mcp-write-surface-35-tools]]"
---

# Dependency sweep and the mcp-handler v2 transport migration

## What changed

- **Housekeeping first:** no worktrees and no `task/*` branches were open — the tree was clean.
  Pushed 3 unpushed vault/changelog commits, fast-forwarded local `main` to `4dba7aaa`, deleted a
  redundant `_draft-*.md` stub (its file list was identical to the already-committed 1904 note), and
  discarded `.obsidian` churn (Obsidian had rewritten two JSON files with different whitespace and
  no trailing newline — zero semantic change).
- **PR #33** (Vercel Speed Insights, draft since 2026-06-24, targeting `main` directly) closed as
  stale. **PR #112** (25 minor/patch bumps, green) squash-merged — the repo forbids merge commits.
- **PRs #104/#105/#106** (jsdom 29→30, openai 6→7, framer-motion 12→13) landed as `69caa32d` from
  worktree `task/dep-majors`, gated together rather than merged on their individually-green stale
  CI: typecheck, lint (0 errors), 6976 tests, production build.
- **PR #107 (mcp-handler 1.1→2.1) landed as `190e9ecb`** — the reason its CI was red is that v2 is a
  transport rewrite, not a bump. Server types moved to the new `@modelcontextprotocol/server`
  package (the old `@modelcontextprotocol/sdk` dependency is now unused and dropped);
  `createMcpHandler` lost its third options argument, so `basePath` and `disableSse` are gone and
  `maxDuration` became a Next.js route-segment export; and `registerTool` no longer accepts zod 4's
  `ZodRawShape` (`Readonly<Record<string, $ZodType>>`), so `ToolDescriptor.inputSchema` is now
  spelled `Record<string, z.ZodType>`.
- **`/api/mcp` had no test at all** — the whole transport was covered only by whatever a live client
  happened to exercise. Added `src/app/api/mcp/route.test.ts`: the unauthenticated challenge carries
  the resource-metadata URL, an unresolvable bearer is refused, `initialize` completes, and
  `tools/list` returns exactly `ALL_TOOL_DESCRIPTORS`.
- Merged to `develop` (`f73e24ae`), **CI green** (run 34138976762). All four dependabot PRs closed as
  superseded with the reason written into each. Orphan dependabot branches pruned; origin now carries
  only `vercel/install-and-configure-vercel-s-cz9g1t`, since deleted too. **Nothing announced on `/updates`** — none of
  this is user-observable. (The coverage check flags 2026-08-24, which is a false positive of the
  by-date heuristic: that document work is announced under a later ship date.)

## Why

The dependabot backlog had regrown to five PRs since it was last cleared on 2026-08-27, and the one
that mattered was silently mis-scoped: #107 reads as a routine bump and is actually a rewrite of the
transport that Claude Desktop and claude.ai connect through. Landing it under gates — rather than
merging on green CI or leaving it to rot — is also what surfaced the missing test.

## How to test (for the user)

Nothing user-facing changed, but the MCP endpoint is externally consumed, so the transport swap is
worth one manual confirmation **before the next promotion to `main`**:

1. `git checkout develop && git pull && pnpm install` (dependencies changed), then `pnpm dev`.
2. In Claude Desktop or claude.ai, reconnect the Monolith MCP connector against your dev server
   (Settings → Connected Apps has the server URL and per-client steps).
3. Complete the OAuth handshake — expect the same authorize → consent → connected flow as before.
4. Ask the client to list its available tools: expect **35**, unchanged.
5. Run one read (e.g. "list my boards") and one write (e.g. create an item) and confirm both return.

If any of that misbehaves, the transport migration is the suspect — nothing else in this session
touches that path.

## Open threads

- **The mcp-handler v2 swap is unproven against a real client.** The new route test drives the real
  JSON-RPC transport, and a dev-server smoke test confirmed the 401 challenge and both `.well-known`
  documents, but no actual Claude Desktop/claude.ai session has run against it. Do the walkthrough
  above before promoting.
- `develop` is now ahead of `main` by the dependency work — the first unpromoted delta since PR #115.
- **CLOSED in the same session:** `origin/vercel/install-and-configure-vercel-s-cz9g1t` deleted (PR
  #33 is closed and GitHub keeps the commits restorable from it), so **origin now carries exactly
  `develop` and `main` and nothing else**. And the `.obsidian` churn is fixed at the cause rather
  than discarded again: `app.json` and `community-plugins.json` are written by the Obsidian app in
  its own format, lint-staged ran prettier over them on commit, and the two formats fought — so both
  files sat permanently modified. `.prettierignore` already exempts `vault/` for exactly this
  reason; `.obsidian` is its sibling and was missed. Added it and committed the files as Obsidian
  writes them (`e2ab5f35`); the tree is clean and stays clean.

## Next session entry point

Either promote this dependency work (after the MCP client walkthrough above) or go back to E6 Stripe,
which remains the only open epic and is still blocked on a test-mode key.
