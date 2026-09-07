---
type: session
date: 2026-09-07-1726
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-07-1105-promote-111-113-and-smartfill-deflake]]"
  - "[[2026-09-07-0931-spec3-orchestration-eleven-task-build]]"
---

# MCP write surface — 35 tools, agents can build boards

## What changed

- **Spec + 13-task plan + build + promotion, one session.** `docs/superpowers/specs/2026-09-07-mcp-write-surface-design.md` and its plan; then three waves (contract → six concurrent tool worktrees → integration) merged to `develop`, promoted as **PR #114**, `main` @ `7556df77`, Vercel `state=success`, main CI green (run 34125939429).
- **Catalog 24 → 35.** Ten grouped-dispatch `manage_*` tools (board, group, column, item, view, dashboard, widget, goal, portfolio, report) plus `describe_schema`. `manage_automation` replaced `create_automation` and stayed **agent-only**, honouring the prior ruling that a standing org-visible side effect belongs behind a capability grant, not a bearer token.
- **`ToolDescriptor.capability` and `.scope` resolve per action**, via `capabilityFor`/`scopeFor`; `TOOL_SCOPES` gained `columnId`/`viewId`/`automationId`; `refusesUnscopedCreate` refuses creates a narrowed agent cannot address. Sixteen Server Actions across five modules were extracted onto `*Core` functions taking an injected client, so one implementation serves both transports.
- **Two capabilities, one DDL-only migration** (`20260907083013`): `board.structure`, `board.destroy` widened into both CHECK constraints. No ceiling backfill, no DEFAULT change — ships **installable-but-inert**, same ruling as memory and delegation.
- **Containers are archive-only.** Boards, groups, items archive to Trash and restore; leaf objects delete. Purge is human-only on both transports.
- `/updates`: **announced nothing.** Everything shipped is denied by every org ceiling, so no user can observe it yet. Announcing it now would advertise a feature nobody can reach — the convention's own "don't announce what doesn't work yet" rule.

## Why

Agents could fill a board and never make one — every write tool operated on structure a human had already built. That put a hard ceiling on autonomy: "track this quarter's hiring" was not actionable. This removes the ceiling for the tool surface while keeping the blast radius recoverable, and leaves the grant closed until an admin opens it.

## How to test

1. Pull `develop`, restart the dev server. **Settings → AI → Org agent ceiling** — turn on **Build and change board structure** and **Remove things**. Nothing below works before this.
2. **Settings → Agents** — grant an agent the same two. Leave board scope **All boards**.
3. **Settings → MCP** — 35 tools; the ten `manage_*` show **write**, `describe_schema` **read**, every row has a description.
4. In a connected MCP client: *"Use describe_schema, then build me a hiring board with a status, date and owner column, two groups, and three roles."* Expect a correct board in ~6 tool calls.
5. Ask it to **archive** the board → check Trash, restorable. Ask it to **permanently delete** → it cannot, and says so.
6. Narrow the agent to one board, ask it to create a board → *"This agent is scoped to specific boards, so it cannot create new ones."*
7. Revoke **Remove things**, ask it to archive → approval card reads *"Archive a board, moving it to Trash. You can restore it from there."*, not *"Run manage_board."*

## Open threads

- **The six new `*.rls.integration.test.ts` files have never executed.** No `.env.test`, and DEV/PROD are deny-listed as integration targets, so all 92 integration suites skip. Cross-tenant refusal is inspection-verified only. The final review's counsel: don't chase a test project — add fake-client unit tests for the *silent no-op write* class, which is what it actually found twice by reading.
- **`create_goal`/`create_portfolio` pick the destination org with `limit 1` and no `ORDER BY`** — arbitrary for multi-org users, shared with the web UI. Descriptions were made honest; the RPCs were not touched. Needs its own migration + PR.
- **Zero-row RLS-filtered writes report success** in `goals/core.ts:113` and `portfolios/core.ts:88,115` — newly reachable by an unattended agent that will narrate a delete that did not happen.
- `task/agents-page` is still open and unmerged; its migration `20260907073911` is applied to DEV with no file on `develop`.
- SDD ledger kept at `.superpowers/sdd/2026-09-07-mcp-write-surface/progress.md` rather than deleted — it is the only record of the three plan defects and every deferred minor.

## Next session entry point

E6 Stripe is still the only feature epic left and is owner-blocked. Cheapest real work here: the two follow-up PRs above (org determinism, zero-row write reporting), then open the org ceiling on DEV to make the structure surface actually reachable.
