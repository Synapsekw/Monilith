---
type: adr
status: accepted
date: 2026-07-25
tags: [project/monolith, adr, gotcha, testing, playwright, worktrees]
related:
  - "[[2026-07-25-1056-settings-redesign-mcp-guide]]"
  - "[[2026-06-21-gotcha-31-worktree-needs-real-install]]"
---

# Gotcha 58 — Playwright reuses whatever is already on :3000, so visual verification from a worktree silently tests the main checkout

## Context

While verifying the settings redesign from `.claude/worktrees/settings-redesign`, a Playwright spec
navigated to `/settings` and timed out waiting for the redirect to `/settings/profile` — a redirect
that demonstrably worked. The branch was correct, the build was green, the route existed.

The cause is in `playwright.config.ts`:

```ts
webServer: {
  command: "pnpm dev",
  url: "http://localhost:3000",
  reuseExistingServer: !process.env.CI,
}
```

A `pnpm dev` from the **main checkout** was already listening on :3000. `reuseExistingServer` saw a
healthy server at that URL and attached to it, never starting one for the worktree. Every assertion
then ran against `develop`'s old code — the pre-redesign settings page, where `/settings` really does
not redirect.

This is worse than a plain failure: had the change been _additive_ rather than a redirect, the run
would have **passed against the wrong code** and reported false confidence.

## Decision

When driving a browser against a task worktree, do not use the repo's `playwright.config.ts` port.
Start the worktree's own dev server on a distinct port and point the script at it explicitly:

```bash
pnpm dev -p 3100          # from inside .claude/worktrees/<name>
```

then drive it with a standalone script (`chromium.launch()` + an explicit `BASE` of
`http://localhost:3100`) rather than `pnpm exec playwright test`, which would re-read the config.

Two supporting details, both of which cost time here:

- The script must live **inside** the worktree. Node resolves `dotenv`/`@playwright/test` from the
  nearest `node_modules`, so a script in a scratchpad directory fails with `ERR_MODULE_NOT_FOUND`.
- Authenticate the same way the e2e suites do: create a **pre-confirmed** user with the service-role
  admin API, log in through the UI, delete the user in a `finally`. Email confirmation on the DEV
  project otherwise blocks a UI signup from reaching an authenticated session.

## Consequences

- Visual verification from a worktree is trustworthy again, at the cost of a second dev server.
- Anything checking "is the page right?" from a worktree must confirm which server it hit. `lsof -ti:3000`
  plus `lsof -a -p <pid> -d cwd` names the owning directory in two commands.
- Worth noting the general shape: the isolated-worktree model (working agreement #1) isolates _files_,
  not _ports_. Any tool that discovers a service by fixed port can silently cross the boundary — the
  same shape as the `node_modules/.bin` PATH issue in
  [[2026-06-21-gotcha-31-worktree-needs-real-install]], in a different guise.
