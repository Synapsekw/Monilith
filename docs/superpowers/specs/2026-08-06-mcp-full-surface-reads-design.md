# MCP full-surface reads + time logging — design

**Date:** 2026-08-06
**Status:** Approved, ready for planning
**Scope:** Spec 1 of 2. Spec 2 (`create_dashboard` / `add_widget` / `update_goal`) depends on this one and is deliberately deferred.

## 1. Problem

Pulse's MCP server exposes seven tools, all of them board/item:
`list_boards`, `get_board`, `list_items`, `search_items`, `get_item`, `create_item`, `update_item`
(`src/lib/mcp/tools/register.ts`).

The product has six more first-class surfaces — My Time, Dashboards, My Work, Workload, Goals,
Portfolios — plus Reports. A connected client (Claude Desktop, an agent, any MCP consumer) can
read and edit board rows but cannot see a user's workload, their week's time, a dashboard, a goal
tree, or a portfolio rollup. The MCP is a window onto one seventh of the product.

This spec makes the MCP a **complete read surface** over the whole product, and adds exactly one
write verb: logging time.

### 1.1 The wall

Every read module is cookie-bound. `src/lib/{time,goals,portfolios,my-work,workload,reports}/queries.ts`
and `src/lib/dashboards/queries.ts` all call `createClient()` from `@/lib/supabase/server`, and
several call `getUser()` / `getActiveOrgId()`. An MCP request carries an OAuth bearer token resolved
to a **bridged** Supabase client — there are no cookies in the request. **Not one of those functions
is callable from a tool handler as written.**

This is the same wall `upsertCell` hit
([`2026-07-26-mcp-assigned-notification-design.md`](./2026-07-26-mcp-assigned-notification-design.md),
gotcha-60), and it takes the same fix: extract a client-injected core, leave the cookie-bound
export as a thin wrapper.

The dominant cost of this project is therefore **the core extraction**, not the tool files. The
tools are thin. The extraction is shared by all seven surfaces, which makes it the dependency root
of the whole plan.

### 1.2 What is already pure

`src/lib/my-work/bucket.ts`, `src/lib/workload/rollup.ts`, `src/lib/portfolios/rollup.ts`,
`src/lib/time/hours.ts` and `src/lib/goals/progress.ts` touch neither `createClient` nor
`next/headers`. All the derivation logic is already client-free; only the I/O layer needs work.

`pickActiveOrg(orgs, cookieValue)` in `src/lib/org/active.ts` is likewise already pure.

## 2. Decisions

| Decision        | Choice                                           | Why                                                                                                                                                                                       |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces        | All seven                                        | Read parity is the point; a partial mirror leaves the agent guessing what it can see.                                                                                                     |
| Read vs write   | Read everything, write only time                 | Smallest blast radius that still delivers the highest-value write. Authoring writes are Spec 2.                                                                                           |
| Tool shape      | Flat — one tool per operation                    | Tiny unambiguous schemas beat fat `action`-discriminated unions for model accuracy. Matches today's seven exactly.                                                                        |
| Core extraction | In-place client injection                        | Established precedent (`upsertCellCore`). RSC call sites change zero lines. A separate MCP query layer would duplicate bucketing/rollup/hours logic — the exact drift gotcha-60 punished. |
| Org scoping     | Explicit optional `orgId` + `list_organizations` | MCP has no active-org cookie. Explicit and testable; silently defaulting to first org is wrong for multi-org users and gives the agent no way to correct it.                              |
| Response shape  | Trimmed, agent-shaped projections                | The RSC payloads are UI-shaped (cells, layout, palettes). Projecting costs work per tool and repays it in model accuracy and client context.                                              |

### 2.1 Rejected

- **Fresh MCP-only queries** (no refactor). Fastest first tool, zero risk to the web app, but
  re-implements derivation in a second place. Rejected on gotcha-60 precedent.
- **A `DataContext { supabase, userId, orgId }` threaded through every module.** Cleanest end
  state; rewrites every call site across seven surfaces for a benefit in-place injection already
  delivers. Rejected as unjustified scope.
- **Per-connection active org** stored on the OAuth token row with a `set_active_org` tool.
  Mirrors the web cookie most closely but adds hidden cross-turn state the agent must remember.
- **Scoped sub-servers** (`/api/mcp/analytics`). Cleanest context cost; costs the user multiple
  OAuth connections.

## 3. Architecture

Two layers: one refactored, one new.

### 3.1 Layer 1 — client-injected cores

Each query module gains a `…Core(supabase, ctx)` export holding the current body, where `ctx`
carries only the context that module actually needs, passed explicitly. My Work needs neither a
userId nor an orgId (its RPC is SECURITY INVOKER and RLS-scoped per caller); time reads need
`userId`; workload, goals and portfolios need `orgId`. The existing exported name survives as a wrapper, so every
RSC page is untouched:

```ts
// src/lib/my-work/queries.ts
export async function getMyWorkItemsCore(
  supabase: SupabaseClient<Database>,
  ctx: { userId: string; orgId: string },
): Promise<MyWorkItem[]> {
  /* the current body, minus createClient() / getUser() / getActiveOrgId() */
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function getMyWorkItems(): Promise<MyWorkItem[]> {
  const [supabase, user, orgId] = await Promise.all([
    createClient(),
    requireUser(),
    getActiveOrgId(),
  ]);
  return getMyWorkItemsCore(supabase, { userId: user.id, orgId });
}
```

Rules for the extraction:

- **`"server-only"` stays.** MCP route handlers are server code; the directive is not the obstacle.
- **Org resolution never moves into a core.** `resolveActiveOrg` is `cache()`-wrapped and reads
  cookies. Cores take `orgId` as a parameter. The web wrapper passes `getActiveOrgId()`; MCP passes
  the tool's resolved org (§3.3).
- **`cache()` stays on the wrapper.** `getDashboardPayload` (`src/lib/dashboards/queries.ts`) and
  `getReport` (`src/lib/reports/queries.ts`) are `cache()`-wrapped consts. The core is a plain
  uncached function; the wrapper keeps the `cache()` so RSC request-scoped dedupe is preserved and
  the tool path does not depend on a React request scope existing.
- **Pure helpers are called from the cores unchanged** — `bucket.ts`, both `rollup.ts`, `hours.ts`,
  `progress.ts`.
- **Behaviour is identical.** This is a mechanical move: relocate the body, add parameters. Any
  behaviour change is a bug, and §7.2 exists to prove there wasn't one.

Modules to extract: `time`, `goals`, `portfolios`, `my-work`, `workload`, `reports`, `dashboards`
(both `queries.ts` and the parts of `queries-cached.ts` the tools need).

`upsertTimeAllocation` (`src/lib/time/actions.ts`) gets the same treatment on the write side:
`upsertTimeAllocationCore(supabase, input, ctx)` with the `"use server"` action reduced to
cookie-binding + `revalidatePath("/workload")`. Revalidation stays in the action — an MCP call has
no Next.js cache to revalidate.

### 3.2 Layer 2 — tool modules

One file per tool in `src/lib/mcp/tools/`, exactly matching the existing seven: each exports a
`…Handler(getClient, …)` (unit-testable, no server dependency) and a
`register…Tool(server, getClient, actorId)`, wired in `register.ts`.

Invariants carried over from the existing tools:

- **`getClient()` is called exactly once per handler invocation.** Each call charges the MCP rate
  limit and rotates the OAuth bridge secret (`src/lib/mcp/context.ts`). Never inside a loop.
- **Never the service-role client.** Every read runs through the bridged, RLS-scoped client.
- **`ToolResult` shape unchanged** — one text block, optional `isError: true`.
- **Projection lives in the tool module, not the core.** Cores keep returning their existing types
  so RSC keeps its shape.

### 3.3 Org scoping

New pure helper, tested in isolation:

```ts
// src/lib/mcp/org-scope.ts
export function resolveToolOrg(
  orgs: UserOrg[],
  requested?: string,
): UserOrg | null;
```

Semantics mirror `pickActiveOrg`: a requested id is honoured **only** if it matches one of the
user's memberships; otherwise the first org; otherwise `null`. On `null` the handler returns
`isError` with `"No organization."`.

A foreign or stale `orgId` therefore cannot scope a tool to a tenant the user does not belong to —
and RLS remains the actual boundary underneath. This is UX, not security.

The org list comes from the RLS-scoped membership read on the bridged client (the same query
`getUserOrgs` performs), so it never widens what the token can see.

## 4. Tool surface

15 new tools, 22 total. `(w)` marks the sole write.

| Tool                          | Args                                                        | Returns                                                                    |
| ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `list_organizations`          | —                                                           | `[{ id, name, timezone }]`                                                 |
| `get_my_work`                 | —                                                           | `[{ bucket, items: [{ id, name, boardId, boardName, dueDate, status }] }]` |
| `get_workload`                | `orgId?`, `from?`, `to?`                                    | `[{ userId, name, allocatedSecs, capacitySecs, itemCount }]`               |
| `list_time_allocations`       | `orgId?`, `from`, `to`                                      | `[{ date, itemId, itemName, category, secs, note }]`                       |
| `get_time_summary`            | `orgId?`, `from`, `to`, `groupBy: item\|category\|day`      | `[{ key, label, totalSecs }]`                                              |
| `log_time_allocation` **(w)** | `orgId?`, `date`, `itemId?` \| `category?`, `secs`, `note?` | `{ date, secs }`                                                           |
| `list_dashboards`             | `orgId?`                                                    | `[{ id, name, widgetCount }]`                                              |
| `get_dashboard`               | `dashboardId`                                               | `[{ widgetId, title, type, boardIds, summary }]`                           |
| `get_widget_data`             | `widgetId`                                                  | resolved rows or series, row-capped                                        |
| `list_goals`                  | `orgId?`                                                    | `[{ id, name, parentId, depth, progress, status, ownerName }]`             |
| `get_goal`                    | `goalId`                                                    | goal + linked items + owner + progress                                     |
| `list_portfolios`             | `orgId?`                                                    | `[{ id, name, boardCount }]`                                               |
| `get_portfolio`               | `portfolioId`                                               | `[{ boardId, boardName, total, byStatus }]`                                |
| `list_reports`                | `boardId`                                                   | `[{ id, name, createdAt }]`                                                |
| `get_report`                  | `reportId`                                                  | `{ id, name, boardId, updatedAt, blocks: [{ type, title }] }`              |

Notes:

- **Naming** follows the existing convention (`list_*`, `get_*`, `verb_noun`).
- **`log_time_allocation` is named for the table it writes.** "Time" is two tables:
  `time_allocations` is the manual weekly card (`upsertTimeAllocation`, unique on
  `user_id,work_date,item_id` or `user_id,work_date,category`); `time_entries` is timer-tracked and
  surfaces read-only as `timerSecs`. Naming the verb for the allocation table leaves room for a
  future timer verb without a rename.
- **`log_time_allocation` is an upsert, self-only.** RLS guarantees `user_id = auth.uid()`; the
  handler sets `user_id` from `mcpActorId(auth)`, matching the write-path precedent in
  `src/lib/mcp/tools/shared.ts`. Exactly one of `itemId` / `category` is required — enforced by a
  Zod refinement, because the choice selects the `onConflict` target.
- **`list_time_allocations` returns flat rows**, not the `TimeCardData` week/cell structure. The
  `weekStart` / `days` / `cells` scaffolding exists for the grid UI and is noise to an agent.
- **`get_dashboard` omits layout and palette** for the same reason.
- **`get_report` returns the report's structure, not resolved data.** `shapeReport`, `computeKpis`
  and `computeChartSeries` (`src/lib/reports/{shape,chart-data}.ts`) all take a full `BoardPayload`
  — every cell value, attachment and time entry on the board. Resolving a report inside a tool
  would be an unbounded read, violating §5. The tool returns the ordered blocks the report is built
  from; resolved report data moves to Spec 2, which can build a bounded report-data core. HTML/PDF
  export stays out of scope either way (§10).
- **`get_widget_data`** reuses `resolveWidgetSlot` (`src/lib/dashboards/actions.ts`), which already
  takes the Supabase client as a parameter — so it needs a module move out of the `"use server"`
  file, not a rewrite. Its caps come from the widget's own configuration.

## 5. Performance and data-fetching budget

_(Working agreement #5. There is no interactive UI here; the budget is about bounded reads.)_

- **First call vs. repeat calls.** Every tool is a single round trip. No tool fans out per row; no
  tool calls `getClient()` more than once. `get_dashboard` returns widget _descriptors_ only —
  resolving data is a separate, explicit `get_widget_data` call per widget, so listing a dashboard
  never triggers N aggregations.
- **Every list tool is hard-capped.** The cap is an exported const beside the handler (the
  `QUERY_ITEMS_MAX` pattern), stated in the tool description so the model knows results may be
  truncated, and asserted in tests. Existing caps are reused, not duplicated:
  `MY_WORK_ITEM_LIMIT`, `MY_WORK_COLUMN_LIMIT` (`src/lib/my-work/queries.ts`), `DASHBOARDS_LIMIT`
  (`src/lib/dashboards/queries-cached.ts`).
- **Date-ranged tools cap the span, not the row count.** `list_time_allocations`,
  `get_time_summary` and `get_workload` reject a range longer than the cap with an `isError`
  message naming the limit. Failing loudly beats silently truncating a year of time data into a
  plausible-looking partial answer.
- **Reads stay over indexed columns.** The cores are the existing queries verbatim, which already
  satisfy this; the extraction must not add an unindexed filter. `time_allocations` reads are keyed
  by `(user_id, work_date)`, matching the unique partial indexes that drive the upsert.
- **No unbounded `select *` on a growing table** is introduced anywhere.

## 6. Errors

The existing contract is unchanged: one text block, `isError: true` on failure, message taken from
the DB error or the validation message.

- Zod validates every tool input at the boundary; unknown arguments are rejected.
- Rate limiting is unchanged and automatic — it lives in `getRequestClient`.
- `resolveToolOrg` returning `null` → `"No organization."`.
- A range exceeding its cap → an error naming the cap.
- Malformed auth (`mcpActorId`) continues to throw: a programming error, not a runtime condition.

## 7. Testing

_(Working agreement #4. Three layers, matching what the repo already does.)_

### 7.1 Handler unit tests

One `*.test.ts` per tool. Mock the **core module** with `vi.mock` and assert:

- the projection shape (exact keys, no UI scaffolding leaking through),
- the cap is applied and surfaced,
- the error path returns `isError`,
- `getClient()` is called **exactly once**,
- org resolution passes the resolved id to the core.

This deliberately avoids extending `src/test/mcp-fake-client.ts`, whose header documents it as a
structural fake of four specific call shapes. Fifteen tools' worth of query shapes would push it
past the point where the fake is easier to trust than the thing it fakes.

### 7.2 Core equivalence tests

Each extracted `…Core` gets tests proving behaviour is unchanged from the pre-refactor function,
plus a test that the cookie-bound wrapper still passes the cookie-derived `userId` / `orgId`. This
is what makes the refactor safe to land: the RSC pages are untouched, so nothing else would catch a
regression.

### 7.3 RLS integration tests

`*.rls.integration.test.ts`, skipped unless `PULSE_TEST_DB` is set (per the dev/prod split — these
never run against the live DEV database in CI). One per new surface, plus an extension of
`src/lib/mcp/tools/cross-org-access.rls.integration.test.ts` covering each new org-scoped tool
called with a **foreign** `orgId`, asserting it is refused rather than honoured.

### 7.4 Gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before the branch merges.

## 8. Settings UI

`src/components/settings/mcp/mcp-tools-table.tsx` gains 15 rows with correct read/write pills.

Its test currently asserts `"lists all seven registered tools"` — a hardcoded count, not a
comparison against `register.ts`. The component's own header comment says the list "must stay in
sync" with the registrations because it is _the user's only account of what they are granting_, but
nothing enforces that. Adding 15 tools under that arrangement guarantees the settings page
understates the access being approved.

**Fix as part of this work:** the test derives the expected names from the registered tools, so a
tool added to `register.ts` without a table row fails CI.

## 9. Independent units (for the plan's execution DAG)

_(Working agreement #6. The plan owns the DAG; this section names the units it will schedule.)_

**Dependency root — must land first:**

- **U0 · Core extraction.** Seven query modules + `upsertTimeAllocation` → client-injected cores
  with cookie-bound wrappers, plus §7.2 equivalence tests. Everything below consumes it.
  Internally parallelisable **per module** — the seven are independent of each other and touch
  disjoint files.
- **U1 · `resolveToolOrg`** (`src/lib/mcp/org-scope.ts`) + tests. Independent of U0; can run
  concurrently with it. Consumed by every org-scoped tool.

**Then, all mutually independent (one unit per surface, disjoint files):**

- **U2 · Org** — `list_organizations`. _Consumes: U1._
- **U3 · My Work + Workload** — `get_my_work`, `get_workload`. _Consumes: U0, U1._
- **U4 · Time** — `list_time_allocations`, `get_time_summary`, `log_time_allocation`.
  _Consumes: U0, U1._
- **U5 · Dashboards** — `list_dashboards`, `get_dashboard`, `get_widget_data`. _Consumes: U0, U1._
- **U6 · Goals + Portfolios** — `list_goals`, `get_goal`, `list_portfolios`, `get_portfolio`.
  _Consumes: U0, U1._
- **U7 · Reports** — `list_reports`, `get_report`. _Consumes: U0, U1._

**Convergence point — must land last:**

- **U8 · `register.ts` + settings table + sync test.** _Consumes: U2–U7._ Every tool unit touches
  `register.ts` and `mcp-tools-table.tsx`, so those two files are the guaranteed rebase conflict if
  the units run in parallel worktrees. The plan should either serialise the two-line registration
  edits into U8, or accept trivial conflicts there.

The critical path is **U0 → U4 (or any tool unit) → U8**. U0 is the wall-clock floor.

## 10. Out of scope

- `create_dashboard`, `add_widget`, `update_goal` — **Spec 2**, which depends on the cores this
  spec extracts.
- Any `time_entries` (timer) write verb.
- Deleting or updating time allocations from MCP (`deleteTimeAllocation` is not exposed).
- Resolved report data (KPIs, chart series) — needs a bounded report-data core; see §4.
- Report generation, PDF/HTML export, or AI report drafting via MCP.
- Board/item tool changes. The existing seven are untouched.
- New OAuth scopes. Scopes are still `[]`; the settings table remains the consent surface.

## 11. How to test (user-facing)

The only visible in-app change is the settings table. Everything else is new capability for
connected clients.

1. Pull `develop`, run the app, go to **Settings → MCP**. The tools table now lists 22 tools with
   read/write pills — confirm the 15 new ones appear and that only `create_item`, `update_item`
   and `log_time_allocation` are marked **write**.
2. Connect Claude Desktop through the MCP connection flow on that page (or reconnect an existing
   connection so it re-lists tools).
3. Ask it: _"What's on my plate this week?"_ → expect it to call `get_my_work` and answer with your
   real assigned items.
4. Ask it: _"How is the team's workload looking?"_ → expect `get_workload` with per-person totals.
5. Ask it: _"Log 2 hours against <an item name> for yesterday."_ → expect `log_time_allocation`,
   then open **My Time** in the web app and confirm the cell shows 2h on the right day.
6. Ask it: _"Show me my dashboards"_, then _"what does the <name> widget say?"_ → expect
   `list_dashboards` then `get_dashboard` / `get_widget_data`.
7. Negative check: ask it to read a board in an org you do not belong to (or pass a foreign
   `orgId` directly) → expect a refusal, not data.
