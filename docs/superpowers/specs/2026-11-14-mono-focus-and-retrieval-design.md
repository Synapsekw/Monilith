# Mono: Focus Today and the retrieval foundation

Date: 2026-11-14
Status: design approved in brainstorm, awaiting written-spec review
Scope: the org assistant served by `/api/ask` (the `/ask` page, the board dock, Personal Mono threads) and the My Work page.

## 1. Problem

The assistant has a sound runtime (one loop, staged writes, per-user permissions) but cannot see enough to help a member on a large project.

- `get_my_work` includes done items, applies its limit before any ordering (so the rows kept are arbitrary), reads only the first status and first date column of each board, has no org filter, and computes "today" in UTC.
- `list_items` filters only by group. A question such as "what is overdue in project X" means paging raw cells, 200 items at a time, inside a 12-step budget.
- `search_items` covers one board and matches names only. Semantic search exists (`item_embeddings`, `match_items`) but is not offered to `/api/ask`.
- No tool reads comments, activity or dependencies, so the assistant cannot say why an item is stuck or who is waiting.
- Nothing tells a member what to do first. My Work is a flat bucketed list.

## 2. Goals and non-goals

Goals:

1. A member opens My Work and sees a short ranked "Today" list with a reason on every row, with no AI call and no AI key required.
2. The assistant answers "what should I focus on today", filtered project questions ("what is overdue in project X", "what is Ana working on", "what changed this week"), "why is this stuck", and "find the item about …" across boards, each in one or two tool calls.
3. Every read is one bounded query over indexed columns, pinned to the active org, under the caller's row-level security.

Non-goals (follow-on specs):

- Project context injected into folder threads (waits for the folder command center redesign).
- Personal memory and preferences.
- Morning briefings and nudges (belongs with Personal Monos Plan 2B).
- A category on every status option (not started / in progress / done / blocked).
- Priority columns or goal links as ranking boosts.
- Any change to write tools, and a notifications tool.

## 3. Facts checked on 2026-11-14

Live database (the DEV project, which serves production):

| Measure               | Value                                        |
| --------------------- | -------------------------------------------- |
| Live items            | 2,523 (largest org 2,447, largest board 441) |
| Cell values           | 40,013                                       |
| Live boards           | 27                                           |
| Dependencies          | 1,360                                        |
| Activity rows         | 47,373                                       |
| Comments              | 39                                           |
| Items with embeddings | 2,537, queue depth 0                         |

Consequences: embedding coverage is complete, so no backfill task is needed. Embeddings use a platform key (`OPENAI_EMBEDDING_API_KEY`) independent of an org's `ai_mode`, so semantic search works for every member. At this size a view over the live tables is comfortably fast once two indexes exist.

Code:

- Cell shapes: people `{"userIds": [...]}`, date `{"date": "YYYY-MM-DD"}`, status `{"optionId": "..."}`. Status option labels live in `columns.settings`.
- `cell_values` is indexed only on `column_id` and `org_id`.
- `boards` has no setting for which column is the status or the due date.
- `portfolio_boards` and `goal_links` each already carry `done_column_id` and `done_option_ids`.
- Assistant tools are built from the shared catalog in `src/lib/mcp/tools/catalog.ts`, so a new read tool is also offered by the external MCP server under its existing rate limit. This is accepted.

## 4. Design

### 4.1 Units

| #   | Unit                          | Purpose                                                                                          | Depends on                    |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| U1  | Board work settings           | Where a board says which column is status, which options mean done, which column is the due date | none                          |
| U2  | `item_facts` view and indexes | One shared definition of "open, due, assigned"                                                   | U1 migration                  |
| U3  | Focus engine                  | Ranked candidates for one member                                                                 | U2                            |
| U4  | Today block                   | The ranked list on My Work                                                                       | U3                            |
| U5  | Work tools                    | `get_focus_today`, `query_items`, rebuilt `get_my_work`                                          | U2 (U3 for `get_focus_today`) |
| U6  | Story tools                   | `get_item_thread`; dependencies on `get_item`                                                    | none                          |
| U7  | Search tool                   | Cross-board name and semantic search                                                             | none                          |
| U8  | Prompt                        | Tell the model when to use each tool                                                             | U5, U6, U7                    |

### 4.2 U1: board work settings

Migration adds three nullable columns to `boards`:

- `work_status_column_id uuid` references `columns(id)` on delete set null
- `work_done_option_ids text[]`
- `work_due_column_id uuid` references `columns(id)` on delete set null

No backfill. An empty setting means "guess live", using today's rule: lowest-position status column, lowest-position date column, an option is done when its label matches `(done|complete)` case-insensitively. An explicit setting always wins.

UI: a "Work tracking" section in board settings with three controls (status column, done options as a multi-select of that column's options, due-date column), each showing the current guess as its placeholder. Saved through a Server Action validated with Zod, requiring the capability that already gates board settings. The action rejects a column that is not on the board or is of the wrong kind, and done options that are not options of the chosen status column.

`portfolio_boards` and `goal_links` keep their own done settings in this spec.

### 4.3 U2: `item_facts` view and indexes

A view created with `security_invoker = true`, so the caller's RLS policies on `items`, `boards`, `columns` and `cell_values` are the only access rule. One row per item that is not archived on a board that is not archived:

`item_id, org_id, board_id, group_id, name, status_option_id, status_label, is_done, due_date (date), updated_at`

Assignment is not a column of the view, because an item can have several people columns. "Assigned to X" is an `exists` test on the item's people cells, written once as a SQL helper and used by every function below. "Assigned" keeps today's meaning: X appears in any people column of the item.

Indexes:

- A GIN index (`jsonb_path_ops`) on `cell_values.value` restricted to cells that carry `userIds`.
- An index on `(column_id, (value ->> 'date'))` restricted to cells that carry `date`.

At 40,013 rows a plain index build holds its lock for well under a second, so the plan may use a plain build inside the migration. If `cell_values` has grown past roughly a million rows by build time, use a concurrent build outside a transaction instead.

### 4.4 U3: focus engine

A SQL function `get_focus_today(p_today date, p_folder_id uuid default null, p_limit int default 20)`, `security invoker`, `stable`, `search_path = ''`, identity from `auth.uid()` inside the function, execute revoked from `public` and `anon` and granted to `authenticated` and `service_role`.

Candidates: open items in the active org that are assigned to me, plus open items with an unread notification addressed to me of kind `mention` or `update_on_item`. With `p_folder_id`, only boards in that folder.

Each candidate is placed in its highest matching tier:

| Tier                 | Rule                                                                                                                | Order within tier         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1 Overdue            | `due_date < p_today`                                                                                                | oldest due date first     |
| 2 Blocking           | I am assigned, and the item is the predecessor of an open item assigned to someone other than me                    | most waiting items first  |
| 3 Due soon           | `due_date` between `p_today` and `p_today + 2`                                                                      | earliest first            |
| 4 Waiting on a reply | unread `mention` or `update_on_item` notification for me on the item                                                | newest notification first |
| 5 Stalled            | I am assigned, the item has activity after its creation, and its latest activity or comment is more than 5 days old | longest quiet first       |

Open items assigned to me that match no tier are not returned; they remain in the ordinary My Work list.

Tiering, ordering and the limit all happen inside the function. Nothing is classified in TypeScript after the limit. The function also returns the total per tier, so callers can say "12 overdue, showing 7".

Returned per row: item id and name, board id and name, group name, status label, due date, tier, and the facts behind the reason (days overdue, the names of up to two waiting items and their assignees, the unread count, days quiet). Secondary facts are returned too, so an overdue item that also blocks someone says both.

The stall threshold reuses the existing 5-day constant in `src/lib/boards/intelligence/constants.ts`; the SQL takes it as a parameter so the two cannot drift.

A TypeScript module `src/lib/focus/` wraps the call through the typed RPC helper, validates the rows with Zod, and turns the facts into the reason sentence. It has no ranking logic.

`p_today` is the member's local date from their profile timezone, computed on the server. With no timezone set it is the UTC date and the result carries `timezoneAssumed: true`.

### 4.5 U4: Today block

Placed at the top of My Work.

- Up to 7 rows: item name, board and project name, reason chip, due date. A row opens the item panel exactly as existing rows do.
- "Show all" reveals the remaining rows up to 20 from data already on the page.
- "Ask about my day" opens a new assistant thread with the question pre-filled. Hidden when the member has no AI entitlement.
- Empty state: "Nothing urgent", with the next upcoming due item if there is one.
- If the focus query fails, the block is replaced by a single line and the rest of the page renders.

The visual treatment is not fixed here. The first build task is a live prototype, also published as an Artifact, for the owner to approve, using the `pulse-ui` and `frontend-design` skills. User-facing copy says "Today" and "Intelligence", never "Pulse".

### 4.6 U5: work tools

All three are reads (`capability: null`), pinned to the active org, and return people as names and statuses as labels, in compact rows.

`get_focus_today({ folderId? })` returns the engine result: up to 20 rows with tier and reason, per-tier totals, the local date used.

`query_items` accepts:

- `scope`: exactly one of `boardId`, `folderId`, or the org
- `assignee`: `me`, a user id, or `unassigned`
- `state`: `open` (default), `done`, `any`
- `dueFrom`, `dueTo`, or `overdue: true`
- `updatedSince`
- `groupId` (board scope only)
- `sort`: `due` (default) or `updated`
- `limit` up to 50, and a keyset `cursor`
- `countBy`: `board`, `assignee` or `status`, which returns counts in place of rows

It always returns `total`, the count of all rows matching the filter. It is backed by one SQL function over `item_facts` with the same security settings as the focus function.

`get_my_work` keeps its name and output shape and is rebuilt on `item_facts`: open items only, active org only, ordered by due date before the limit, bucketed against the member's local date. The My Work page list moves to the same function, replacing `get_my_work_items`, which is dropped once nothing calls it.

### 4.7 U6: story tools

`get_item_thread({ itemId, limit?, before? })` returns one timeline, newest first, at most 30 entries, merging `item_updates` (author name, plain text cut at 1,000 characters, time) and `item_activities` (actor name, column name, old and new values decoded to labels, time).

`get_item` gains `blockedBy` and `blocking`, at most 20 each, read from `item_dependencies`: item id, name, board name, status label, done flag, assignee names. Items the caller cannot read are omitted by RLS and reported as a count ("2 more you cannot see").

Comment and activity text is untrusted content. The existing preamble rule already covers tool output; the tool descriptions repeat it.

### 4.8 U7: search tool

`search_items({ query, scope, limit? })`, where scope is a board, a folder or the org, and the limit is at most 20.

- Name matches: `ilike` over item names in scope.
- Meaning matches: `match_items`, extended to accept a list of board ids. The query embedding goes through `runEmbedding`, so it is metered.
- Results are merged with name matches first, duplicates removed, each with board name, a snippet and `matchedOn: "name" | "content"`.
- If the embedding call fails or is not configured, the tool returns name matches with `semantic: false`.

The legacy `semantic_search_items` in the Intelligence loop is left alone.

A trigram index on `items.name` is not needed at 2,523 items. Revisit when one org passes about 50,000.

### 4.9 U8: prompt

Add to `ASSISTANT_PREAMBLE` in `src/lib/assistant/runtime.ts`:

- For "what should I do", "my day", "priorities": call `get_focus_today` and explain the order using the reasons given. Do not re-rank.
- For questions about a set of items: use `query_items` with filters; use `countBy` for "how many" questions. Do not page `list_items` to filter by hand.
- For "why" questions about one item: call `get_item` and `get_item_thread` before answering.
- When a search result says `semantic: false`, say that only names were searched.

Fix `composeFolderScope` in `src/lib/ai/ask/persona.ts`, which names a tool that does not exist (`get_board_overview`); point it at `query_items` and `get_focus_today` with the folder id.

## 5. Performance and data-fetching budget

| Surface                       | First paint                                                       | Interaction                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| My Work                       | One added query (focus), in parallel with the existing list query | "Show all" and row hover: 0 round-trips. Marking done: the existing Server Action, revalidating My Work only |
| Board settings, Work tracking | Read with the existing settings payload                           | Save: one Server Action, revalidating that board                                                             |
| Assistant tools               | not applicable                                                    | One SQL function call per tool call; at most 50 rows (20 for focus and search, 30 for a thread)              |

Hot-path reads are bounded and indexed: the assignee test uses the new GIN index, due windows use the new date index, dependencies use the existing predecessor and successor indexes, activity uses `(item_id, created_at desc)`, and unread notifications use the existing partial index on `recipient_id`.

Before merge, run `explain (analyze, buffers)` for `get_focus_today` and for `query_items` at org scope with an overdue filter, as a member of the largest org. Target: under 50 ms each and no sequential scan of `cell_values`.

## 6. Error handling

- Board without a status column: its items are open. Without a date column: tiers 1 and 3 never match.
- A work setting pointing at a deleted column becomes null (`on delete set null`) and the guess applies again.
- Tool failures return a short plain sentence in the tool result. The preamble already forbids answering without data.
- Cross-tenant: every function filters by the active org in addition to RLS. A `folderId` or `boardId` from another org returns an empty result.

## 7. Testing

- `src/lib/focus/`: unit tests for reason wording and Zod validation of rows.
- SQL (view, `get_focus_today`, `query_items`, rebuilt my-work, extended `match_items`): fixtures created and asserted inside a rolled-back transaction on DEV. Cases: each tier alone; an item matching several tiers lands in the highest; done items excluded by setting and by guess; the member's date differing from the UTC date; folder scope; a second org's data invisible; the limit applied after ordering.
- The existing conformance suite must pass for function grants.
- Tool descriptors: unit tests against the real catalog and existing fixtures, not invented ones. Each tool's test must fail if the tool is removed from the catalog.
- Today block: component tests for rows, the empty state, the failure line and "Show all" without a fetch.
- Work tracking settings: Server Action tests for the validation rules in 4.2.
- A live run in the owner's Chrome against a local production build, before merge, with these questions: "What should I focus on today?", "Only in project X", "What is overdue in project X?", "What is Ana working on?", "How is project X spread across people?", "What changed this week on board Y?", "Why is item Z stuck?", "What is waiting on me?", "Find the item about the vendor contract", and one question with no matching data.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 8. Parallelization

| Wave | Units in parallel                      | Unmet dependency |
| ---- | -------------------------------------- | ---------------- |
| 1    | U1 migration; U6; U7; U4 prototype     | none             |
| 2    | U2; U1 settings UI                     | U1 migration     |
| 3    | U3; U5 `query_items` and `get_my_work` | U2               |
| 4    | U4 build; U5 `get_focus_today`; U8     | U3; all tools    |

Critical path: U1 migration, U2, U3, U4.

Shared files that force serialized merges: `src/types/database.types.ts`, `src/lib/mcp/tools/catalog.ts`, `src/lib/assistant/runtime.ts`. Each parallel unit works in its own worktree; the orchestrator merges one at a time and regenerates types after each migration.

Migrations are minted with `scripts/new-migration.sh`, applied to DEV through the `supabase-dev` MCP with the same version and name, and verified with `pnpm db:ledger-check`. DEV is the live database: every migration here is additive (new columns, a view, functions, indexes) and nothing is dropped until `get_my_work_items` has no callers.

## 9. Open points for the plan

- Confirm the capability name that gates board settings, and reuse it for the Work tracking action.
- Confirm how the external MCP path obtains the member's timezone for `p_today`.
- Confirm whether editing a cell bumps `items.updated_at`; `updatedSince` and "stalled" must use the latest of item edit, activity and comment either way.
