---
type: session
date: 2026-08-06-1343
branch: develop
trigger: wrapup
status: complete
tags: [session, mcp, agents, time-tracking, rls]
related:
  - "[[2026-08-06-gotcha-78-postgrest-on-conflict-cannot-infer-a-partial-unique-index]]"
  - "[[2026-08-06-0902-mcp-oauth-loopback-and-bridge-secret]]"
---

# MCP full-surface reads — 7 tools to 22, and a shipped bug fixed on the way

## What changed

- **`task/mcp-full-surface` merged to `develop` (`7edb1bdd`, 24 commits, 63 files, +5272/−312).**
  Spec + plan authored, then executed with `subagent-driven-development`: 11 tasks, one implementer
  and one reviewer each, plus a whole-branch review on opus.
- **MCP goes 7 → 22 tools.** New: `list_organizations`, `get_my_work`, `list_time_allocations`,
  `get_time_summary`, `log_time_allocation` (w), `list_goals`, `get_goal`, `list_portfolios`,
  `get_portfolio`, `list_dashboards`, `get_dashboard`, `get_widget_data`, `get_workload`,
  `list_reports`, `get_report`. Three writes total.
- **Seven query modules refactored to client-injected cores** (`…Core(supabase, …)`) with the
  cookie-bound exports surviving as thin wrappers, so every RSC page is untouched — the
  `upsertCellCore` precedent from gotcha-60.
- **Migration `20260806060855_upsert_time_allocation_rpc.sql`** — a `SECURITY INVOKER` RPC that
  **fixes manual time entry, which had never worked in production**
  ([[2026-08-06-gotcha-78-postgrest-on-conflict-cannot-infer-a-partial-unique-index]]). Ledger
  132/132 in sync after the usual `apply_migration` mis-stamp (now 6 for 6) and reconcile.
- **The consent table told users a lie and now doesn't.** It listed 7 of 22 tools, and its trailer
  claimed "a connected client cannot delete anything" while `log_time_allocation` with `secs: 0`
  issues a DELETE. Both corrected; the sync guard now derives names by running the real
  `registerTools()` against a recording stub, so no hand-maintained mirror can drift.

## Why

The MCP was a window onto one seventh of the product — an agent could edit board rows but could not
see a user's workload, week's time, dashboards, goals or portfolios. Read parity is what makes the
server worth connecting. The single write verb was chosen over full CRUD to keep the blast radius
small; authoring writes are deferred to Spec 2.

## How to test (for the user)

Pull `develop`. Steps 1–3 need no MCP client.

1. **My Time** — click a day cell, enter `2` hours, save, reload. It should persist. Before this
   branch it silently failed and the table held zero rows. Enter `0` in the same cell; it clears.
2. **Workload** — the hours from step 1 should appear against you.
3. **Settings → MCP** — the table should list **22** tools with exactly three marked **write**
   (`create_item`, `update_item`, `log_time_allocation`). The paragraph below it should name
   clearing a time entry as the one destructive capability.
4. Connect (or reconnect) Claude Desktop from that page; confirm it sees 22 tools.
5. Ask it: *"What's on my plate this week?"*, *"How's the team's workload?"*, *"Show me my
   dashboards, then what does the <name> widget say?"*
6. Ask it: *"Log 3 hours against <item> for yesterday."* Check **My Time**. Ask again with a
   different number for the same day — it must **replace**, not accumulate.
7. Negative: ask for goals or dashboards in an org you don't belong to, passing a foreign `orgId`.
   Expect refusal, not data.

## Open threads

- **Dashboard aggregate widgets are probably erroring in production.** `number`/`battery`/
  `completion`/`health` call `SECURITY DEFINER` RPCs through the service client, where `auth.uid()`
  is null and the `can_read_board` guard denies (verified on DEV: all five carry the guard;
  `can_read_board` returns false with no auth). Chart/list use the bridged client and are fine.
  **Verify in the running app** — this is a live-breakage suspicion, not a leak.
- **`src/lib/dashboards/queries-cached.ts`'s doc comments are now false** — they claim the service
  client bypasses RLS as the tenant boundary, which those RPC guards ended.
- **The RLS integration suites have never executed.** No `.env.test`, so they skip. Reviewed, not
  proven. Deliberate: DEV holds live user data and seeding it for a green tick is the wrong trade.
- **Highest-value deferred test:** `listTimeAllocationsCore`'s `limit + 1` over-fetch has no direct
  test — reverting it silently reinstates wrong time totals with the suite green.
- Smaller deferrals: `get_workload` totals span all the caller's orgs (pre-existing, the rollup RPC
  takes no org); `getReportCore` swallows its DB error so a failure reads as not-found;
  `src/test/teardown-steps.ts` is untested.
- Three `_draft-*.md` (0507/0715/0918) and `decision-35-only-main-auto-deploys` belong to **other**
  sessions — left untouched.

## Next session entry point

`develop` is one merge ahead of `main` and ready to promote. Spec 2 (`create_dashboard`,
`add_widget`, `update_goal`) now has its cores extracted and is unblocked. Before either, decide on
the dashboard-aggregate-widget suspicion above — it is the only open item that may be affecting
users today.
