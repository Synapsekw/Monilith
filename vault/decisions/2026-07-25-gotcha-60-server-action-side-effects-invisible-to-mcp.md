---
type: adr
status: accepted
date: 2026-07-25
tags:
  [project/pulse, adr, gotcha, mcp, server-actions, notifications, architecture]
related:
  - "[[2026-07-25-1620-group-1-closeout-security-and-deletion]]"
  - "[[2026-07-24-1950-mcp-server-oauth]]"
---

# Gotcha 60 — side effects living in a Server Action are invisible to every non-cookie caller (MCP, cron, webhooks)

## Context

Pulse writes a cell value through `upsertCell` in `src/lib/boards/actions/cell.ts`. That function
does two conceptually different things:

1. **The write** — four validation guards plus the `cell_values` upsert.
2. **A side effect** — for a `people` column it reads the prior assignees and inserts
   `kind: "assigned"` notification rows for newly-added members (`cell.ts:78-106`).

When the MCP server shipped (2026-07-24) its `create_item` / `update_item` tools could not call
`upsertCell`: it is a `"use server"` action whose first act is `createClient()`, which reads
`cookies()` from `next/headers`. An MCP request carries an OAuth bearer token, not a cookie, and is
resolved to a _bridged_ client. Calling the action would have silently built an unauthenticated
client and failed under RLS. So the tools re-implemented the write — and faithfully copied the four
guards and the upsert while **dropping the notification fan-out entirely**.

The result is a behavioral fork that no test caught and no type error flagged:

- "Assign Sarah to this task" via Claude Desktop **assigns Sarah and never notifies her**.
- The identical edit in the Pulse UI **does** notify her.

Confirmed three ways during the 2026-07-25 MCP dedupe work: `people` is a live column kind and
`cellValueSchema("people")` accepts `{userIds: […]}`, so MCP can write those cells today;
`cell.ts:92` is the **only** producer of `kind: "assigned"` in the entire codebase; and the
notification is **not** DB-triggered — `gate_notification_by_pref` only _filters_ inserts, it never
creates them.

## Decision

Treat **"is this side effect reachable by a non-cookie caller?"** as a required question whenever a
Server Action does more than validate-and-write.

A side effect belongs in one of two places:

- **In the database** — a trigger on the table, so every caller gets it by construction regardless
  of how it authenticated. This is already how `updated_at`, the automation engine, and activity
  logging behave on `cell_values`, which is exactly why MCP writes fire _those_ correctly.
- **In a client-injected core** — `doThing(supabase, …)` containing the logic, with the
  `"use server"` action reduced to a thin cookie-client wrapper around it. Non-cookie callers pass
  their own client and inherit the side effect.

What must **not** happen is the third option we took by accident: duplicating the write in the new
caller and leaving the side effect behind in the action. It type-checks, it passes tests, and it
silently diverges.

## Consequences

- The `assigned`-notification gap is **real and still open** as of 2026-07-25. It was deliberately
  excluded from the dedupe refactor, which was scoped as no-behavior-change; folding a behavior fix
  into it would have made that claim false. It survives as a `KNOWN GAP (do not fix here)` note in
  `src/lib/mcp/tools/shared.ts`.
- The fix is now cheap: the refactor collapsed two `writeCellValue` copies into one, so hoisting
  `upsertCellCore(supabase, …)` out of `upsertCell` and pointing both callers at it is a one-line
  swap on the MCP side. It was deferred only because it edits the hottest write path in the product
  and deserves its own task with its own tests.
- **This generalizes past MCP.** Any future non-cookie caller — a cron job, a webhook receiver, an
  Autopilot agent, a queue worker — inherits the same blind spot against every Server Action in the
  codebase. `upsertCell` is the one we found, not necessarily the only one; the `people` fan-out is
  worth auditing for siblings.
- Absence of a notification is a silent failure. Nobody files a bug for an email that never
  arrived, so this class of divergence can persist indefinitely — which argues for the DB-trigger
  option wherever the side effect is genuinely unconditional.
