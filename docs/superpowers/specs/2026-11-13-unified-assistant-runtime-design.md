# Unified assistant runtime and confirm card

**Date:** 2026-11-13
**Status:** Design approved in brainstorming; awaiting owner review of this document
**Scope:** Sub-projects 1 and 2 of the AI turnaround (runtime, trust model, dock). See "Programme" for the rest.

## Why

The in-app AI is barely used and cannot do much. Evidence from the live database (DEV project, which serves production) on 2026-11-12:

- Personal agent runs: 93 in total, all from one owner, all on a schedule. 31 succeeded, 59 failed, 3 were skipped. The last success was 2026-09-15. Every run since has failed with `Invalid Refresh Token: Refresh Token Not Found`, and nobody noticed.
- The only tool any agent ever called is `get_my_work`. Runs averaged two steps.
- `user_agent_proposals`: 0 rows ever. `agent_memory`: 0 rows. `board_agents`: 0 rows. No delegation child runs.
- 29 built-in orchestrator agents were seeded across 20 users and none has a recorded run.
- Ask: 46 conversations from 4 users, the last on 2026-09-16. Board Intelligence: 5 runs from 1 user.

The code audit explains the numbers:

- Agents get no context. Nothing about the board or item is injected, and an @mention run is not told which item it was summoned on.
- Agents cannot act. Capabilities default to empty, so every write becomes a proposal, behind about ten layers (org entitlement, run caps, org ceiling, per-agent grant, board-scope guard, RLS, validation, human approval). A capability outside the org ceiling is refused with no message.
- There are four separate products (Ask, personal agents, Board Intelligence, Autopilot board agents) with four tool sets, three approval mechanisms and two kinds of run loop. Ask's loop is hand-written against the Anthropic SDK and has 4 read tools and 4 write proposers; the agent loop uses the AI SDK and the full catalog but does not stream.
- `src/lib/agents` and `src/lib/ai` hold about 23,000 lines of code and 43,000 lines of tests across 18 tables.

## Decisions made in brainstorming

| Question          | Decision                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary job       | One assistant everywhere that knows the workspace and can act. An "agent" becomes saved instructions plus a trigger on the same runtime.                                   |
| How writes happen | Always confirmed inline: one card per batch of changes. No queue, no grants, no org ceiling. The user's own RLS is the boundary.                                           |
| Unattended runs   | Same card, delivered later: the run ends with a report and one pending card in its thread.                                                                                 |
| Acceptance jobs   | Catch me up; triage this board; text to work.                                                                                                                              |
| Where it lives    | A dock on every page type (board, item, folder, dashboard, My Work), plus `/ask` as the full-page view of the same threads.                                                |
| What is retired   | Proposal queue, ceiling and grants, orchestrator and delegation, agent memory, Autopilot board agents, the four templates, the hand-written Anthropic loops. Dropped last. |
| How to get there  | A new small runtime that takes streaming, threads and the card from Ask, and the AI SDK loop and full catalog from the agent path.                                         |

## Goals

1. One runtime that every AI chat surface calls.
2. The assistant always receives a snapshot of what the user is looking at.
3. All catalog tools are available. Reads run directly; writes are staged and applied only through one confirm card.
4. Works with any tool-capable provider in the existing provider layer.
5. The three acceptance jobs work from the dock on a board or item.

## Not in this spec

- Moving @mention and scheduled runs onto the runtime, event triggers, "Run now", loud failure handling for unattended runs (sub-project 3). The existing agent path keeps running unchanged until then.
- Deleting retired code and dropping tables (sub-project 4).
- Signup approval (sub-project 0) and a platform OpenAI key with caps (sub-project 5).
- Changes to the MCP server's behaviour for external clients. They keep executing tools directly.

## Design

### 1. Runtime

New module `src/lib/assistant/`.

```ts
runAssistant({
  user, org,
  thread,            // ai_conversations row
  focus,             // { kind, id } from the client, or none
  message,           // the user's turn
  mode,              // "live" | "unattended"
}): AsyncIterable<AssistantEvent>   // text deltas, tool activity, staged batch
```

- **Loop.** AI SDK `streamText` with a step cap of 12. The model is resolved by the existing provider layer (pinned model, then org default). The Anthropic-only pin in `src/lib/ai/tool-capability.ts` is removed for this path.
- **Tools.** Built from `ALL_TOOL_DESCRIPTORS` in `src/lib/mcp/tools/catalog.ts`, minus descriptors marked `agentExcluded`. A descriptor whose `capability` is `null` is a read. Anything else is a write; an action mapped to `board.destroy` is destructive. This spec reuses that field as the classifier and does not rename it; the rename to an explicit `effect` field belongs to sub-project 4.
- **Reads** call `descriptor.invoke` immediately with a client bound to the user, so RLS decides what is visible.
- **Writes** are wrapped by `stage()`. It validates the input against the descriptor's `inputSchema`, resolves the ids it names, adds the call to the turn's batch and returns `{ staged: true, summary }` to the model so that it can keep planning. It never calls `invoke`.
- **End of turn.** A non-empty batch is stored with the assistant message and sent to the client as one card.
- **Kept from today.** Org AI mode and quota (`requireAiEntitlement`), usage metering into `ai_usage`, thread storage in `ai_conversations` and `ai_messages`, Ask's stream-drop recovery.
- **Not used by this path.** Capabilities as permissions, grants, the org ceiling, the board-scope guard, `user_agent_proposals`.

Live and unattended modes differ in one respect: live streams to a browser, unattended collects the result and writes it to a thread with a notification. The loop, the staging and the card are the same. Only live mode is wired to a surface in this spec.

### 2. Focus

The client sends `{ kind, id }` and nothing else. The server builds the snapshot under the user's RLS, so a modified client can neither inject content nor read what the user cannot.

| Kind        | Snapshot                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board`     | name, columns with types and status labels, groups, members, counts by status, up to 50 items (id, name, status, owner, due) and a note that `list_items` returns the rest |
| `item`      | every field value, the last 10 comments, recent activity, the parent board's columns                                                                                       |
| `folder`    | the boards inside it with item counts and overdue counts                                                                                                                   |
| `dashboard` | widget titles with their current values                                                                                                                                    |
| `my-work`   | assigned items grouped as overdue, today, this week                                                                                                                        |
| `none`      | workspace and board names only                                                                                                                                             |

- Each snapshot targets about 1,500 tokens. Every read is bounded and uses indexed columns.
- Prompt order is: stable preamble, tool schemas, focus, conversation. The stable part comes first so provider prompt caching applies.
- Each kind is one builder function in `src/lib/assistant/focus/` with its own tests. Adding a page type later means one builder and one page marker.

### 3. Confirm card and apply

- **One card per assistant turn.** Each row describes a change in plain words, grouped by board or item, with a checkbox so the user can leave single changes out.
- **Destructive rows** are marked and unticked by default.
- **Size.** At most 50 changes per card. Beyond that the assistant says so and splits the work.
- **States.** pending, applying, applied (with a result and reason per row), dismissed, expired.
- **Storage.** The batch lives in `ai_messages.tool_trace` (jsonb), which is where Ask already keeps an unconfirmed proposal. No migration is needed. The outcome is appended as a new assistant turn, as Ask does today, so the model's next turn knows what happened.
- **Apply.** One Server Action, `applyBatch(messageId, selectedRowIds)`. It checks that the org can still use AI, refuses a batch that already has an outcome, re-validates each row, executes rows in order through `descriptor.invoke` with the user's client, and records a result per row. A row whose target has changed or gone fails with a reason while the others proceed.
- **Resolved, not claimed.** `ai_messages` has no UPDATE policy, so a batch is resolved the way an Ask proposal is today: a later message names it in `resolvesProposal`, and Apply refuses when such a message exists. This is check-then-insert, so two Apply requests fired at the same instant are not strictly serialized. The card disables its buttons while running, which is the same protection Ask ships with today.
- **Showing the change on the board.** The mounted board never refetches its server payload, and `revalidatePath` and `router.refresh()` are ruled out by earlier decisions (`docs/superpowers/specs/2026-08-04-ai-write-visibility-design.md`). Catalog tools return text, not rows, so the row-patching used by Ask's four proposers does not apply. After a successful Apply the client invalidates the React Query cache for each touched board (`boardKey(boardId)`), which refetches that board once and does nothing when the board is not mounted.
- **Row descriptions.** The plain-language text comes from `summariseProposal` in `src/lib/agents/proposal-summary.ts`, which has no imports and is reused as it stands. It moves into the assistant module in sub-project 4.
- **Attribution: not in this spec.** The repo has no mechanism that marks a catalog write as made through the assistant. The only marker is a transaction-local setting used by Board Intelligence's own RPC, which cannot span separate requests. Applied changes therefore appear in activity as the user's own, which is accurate, since the user confirmed each one. Marking them "via assistant" needs a schema change and is a separate follow-up.

### 4. Dock

- One client component mounted in the app shell on the right. It opens from a button or a keyboard shortcut. Whether it is open is remembered per user in `localStorage`, read inside try/catch.
- Each page renders a small focus marker with `kind` and `id`. The dock reads the current marker.
- Opening the dock on a board resumes that board's most recent thread or starts a new one. "New thread" is always available. Every thread also appears in `/ask`.
- The opening state shows counts derived from data the page already has (stuck, overdue, no owner) and a "Catch me up" button. The model runs only when the user clicks or types.
- On a phone the dock is a full-screen sheet.
- The board dock's "Intelligence" tab is replaced by the dock. Its suggestions become ordinary confirm cards.
- User-facing copy uses "Assistant" or the org's configured assistant name, never "Pulse".
- Before the build, the dock and the card are shown to the owner as a live prototype in the Keystone styling.

### 5. Failures

- Errors in live chat appear in the thread in plain words with the next step: allowance used up (add your own key or ask an admin), no key (link to settings), stream dropped (existing recovery).
- A tool error is returned to the model, which may try another route. The user sees a one-line trace.
- If the model reaches the step cap, it reports what it finished and where it stopped.
- A partly failed apply shows a reason per row. Rows that succeeded stay applied.

## Performance and data-fetching budget

- **First paint.** The dock adds no server data. Its opening counts come from data already on the page.
- **Interactions with no server round-trip.** Open, close, switch between threads already loaded, tick or untick card rows.
- **Interactions that reach the server.** Sending a message (one streaming route; the focus snapshot is built here and nowhere else); Apply and Dismiss (Server Actions with revalidation limited to the touched board or item); loading an older thread (paginated).
- **Bounded reads.** Focus snapshots cap item rows at 50 and comments at 10, and filter on indexed columns. The thread list is paginated. No unbounded `select *` on a growing table.

## Tests

- **Runtime.** Unit tests with a fake model: a read tool runs, a write tool is staged, nothing is written before Apply.
- **Staging conformance.** One test walks the whole catalog and fails if any descriptor with a non-null capability can reach `invoke` during a model turn. A new write tool cannot bypass staging.
- **Apply.** Re-validation, stale rows, partial failure, single claim, and RLS (a user without access gets a failed row and no write).
- **Focus.** One suite per kind: shape, size bound, and RLS.
- **Acceptance scripts.** Catch me up, triage this board, and text to work on a seeded board, with the expected card contents written down and run by a person.
- **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Database behaviour is checked in a rolled-back transaction on DEV.

## Independent units and order

| Unit       | What                                                     | Depends on            |
| ---------- | -------------------------------------------------------- | --------------------- |
| R          | Runtime loop and staging                                 | none                  |
| F0         | Focus contract and the `none` builder                    | none                  |
| A          | Apply action and card data shape                         | R                     |
| Fb         | Board focus builder                                      | F0                    |
| Fi         | Item focus builder                                       | F0                    |
| Q          | `/ask` switched to the runtime; the old Ask loop removed | R, A, F0              |
| D          | Dock shell and card UI                                   | A                     |
| Ff, Fd, Fm | Folder, dashboard and My Work focus builders             | F0                    |
| M          | Dock mounted on all five page types                      | D, Fb, Fi, Ff, Fd, Fm |

Parallel batches: (R, F0), then (A, Fb, Fi), then Q, then (D, Ff, Fd, Fm), then M. The critical path is R, A, Q, D, M. Every batch leaves the app shippable: after Q, `/ask` has the full catalog and the card; after M, the acceptance jobs run from any page.

## Programme

| #   | Sub-project                                                                                                       | Depends on                                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 0   | Signup approval: every new account waits for a platform admin, including invited teammates                        | none                                          |
| 1+2 | This spec                                                                                                         | none                                          |
| 3   | Saved agents: run now, schedule, event triggers, teammate mention, loud failures                                  | 1+2                                           |
| 4   | Retire list and drop migrations                                                                                   | 3                                             |
| 5   | Platform OpenAI key in managed mode with layered caps (provider-side spend limit, per org, per user, per request) | 1+2 for code; 0 live before it is switched on |

Facts recorded for sub-projects 0 and 5: signup is open today and no approval step exists; all 9 orgs with AI settings are on `per_user` mode with a credit limit of 0; managed mode exists but serves Anthropic only (`src/lib/ai/gateway.ts`).

## Resolved during planning (2026-11-13)

- **Attribution.** No mechanism exists for catalog writes. Dropped from this spec; see "Attribution" above.
- **Ask's `propose_*` tools.** `/api/ask` stops offering them and offers the catalog with staging. `proposeLoop`, `askPulseStream` and `ActionConfirmCard` stay in the codebase because the command palette quick action and Board Intelligence's question box still call them; they are removed in sub-project 4. Old threads that hold `proposedActions` keep rendering and applying through the existing path.
- **A board dock already exists** (`src/components/boards/dock/BoardDock.tsx`) and hosts the same `AskChat` component as `/ask`. Unit D is therefore a generalisation of that dock, not a new build, and "item" focus is the board dock reacting to `?item=`.
- **Two plans.** Plan A covers the runtime, staging, the card, apply, and the `/ask` and board-dock cutover with board focus. After it, the three acceptance jobs run on a board. Plan B covers item, folder, dashboard and My Work focus, the dock on every page, and folding the Intelligence tab into it. Plan B is written after Plan A merges and the dock prototype is signed off.
- **Thread list.** The `/ask` rail is capped at 50 threads with no paging today. That stays as it is in Plan A.

## Still open

- Whether the daily-failing scheduled agent should be disabled now as a separate small fix, since its replacement arrives only in sub-project 3.
