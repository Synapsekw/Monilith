# Board Intelligence — Act and Ask (Phases 3 & 4)

Status: approved 2026-09-13. Implementation detail for
[`2026-09-11-board-intelligence-design.md`](./2026-09-11-board-intelligence-design.md) §5 (Act) and
§6 (Ask). The parent spec's §7 (security), §8 (performance budget) and §10 (testing) rulings apply
unchanged; this document resolves the decisions §5 and §6 left open and names the seams each change
touches.

Phases 1 (Orient) and 2 (Advise) are live in the production deployment, verified by the owner in an
authenticated browser. `board_intelligence_runs` exists on DEV only, and the production deployment
reads DEV.

## 1. What the parent spec left open

Four decisions, resolved here:

1. §5 maps `nudge` and `set_status` onto triggers but names **no trigger for `reassign`** — the
   card the whole phase was blocked on.
2. §5 requires a new `assign_person` action but does not say whether it joins
   `AI_STEP_ALLOWED_ACTIONS`, the vocabulary a model may choose from while a rule fires.
3. §5 does not fix `assign_person`'s write semantics: replace the people cell, or append to it.
4. §6 says "Open in Chat" creates a thread with the Q/A as its opening turn, without saying whether
   the answer is persisted verbatim or re-generated, and does not say what the composer does before
   a run exists.

## 2. Phase 3 — Act

### 2.1 The `assign_person` automation action

`assign_person { columnId, userId }`. Four seams, all verified present:

**Validation** — a new member of `automationActionSchema` in `src/lib/validations/automations.ts`.

- It is **excluded** from `AI_STEP_ALLOWED_ACTIONS`. The list's stated bar is reversibility, and a
  reassignment is reversible in data; it is not reversible in perception. An `ai_step` chooses its
  action at fire time from board text the org does not control, and the effect of this one is to
  hand a named human someone else's work, with a notification. Manual rules and agent-filed rules
  are a person's decision reviewed before it is saved; an `ai_step` is not.
- It **is** admitted to the agent-filed-rule vocabulary, which is derived from
  `automationActionSchema.options` minus `AGENT_FORBIDDEN_AUTOMATION_ACTIONS` — so inclusion is
  automatic, and the agent path stays gated by the existing org-admin check in
  `createAutomationCore`.
- Both facts get tests that name them: one asserting `assign_person` is absent from
  `AI_STEP_ALLOWED_ACTIONS`, one asserting it is present in the derived agent union. A guard test
  whose assertion never names the thing it guards cannot guard it.

**Semantics** — the action **replaces** the people cell with `[userId]`. This mirrors Intelligence's
own `reassign`, which writes `next: [action.toUserId]` and diffs against the prior `userIds` to
notify (`src/lib/ai/board-intelligence/apply.ts`). Two code paths that write one column must agree
on what writing it means; append would make the same user gesture mean two different things
depending on which surface issued it.

**Executor** — a migration extending `tg_run_automations()`. Its body must be copied from
`supabase/migrations/20260704111500_automation_run_recipient_and_target_guards.sql`, the latest of
the **seven** migrations that redefine the function; copying from the original engine migration
silently reverts six later fixes. The new branch is an `elsif a->>'type' = 'assign_person'` arm
carrying the same class of guard that migration added for `notify`: the column must be a people
column on the firing board, and the user must be a member of the board's org. The TypeScript schema
is not the security boundary — the executor is.

Minted with `scripts/new-migration.sh`, applied to DEV through the `supabase-dev` MCP with the same
version and name, verified with `pnpm db:ledger-check`, types regenerated and committed in the same
change. Budget one version reconcile (`scripts/reconcile-migration-version.sh`) — `apply_migration`
has mis-stamped every migration so far.

**Editor and presets** — a row in `src/components/boards/automations/ActionRows.tsx` with its label;
`recipeItemCreatedAssignPerson(peopleColumnId, userId)` in `recipes.ts`; and a human-readable
sentence for the action in the rule list `AutomationsDialog` renders.

### 2.2 "Always do this"

A pure mapper, `src/lib/ai/board-intelligence/rule-draft.ts`:

```
ruleDraftFor(action: Action, ctx: BoardContext): Draft | null
```

`Draft` is the existing not-yet-persisted automation type from `recipes.ts`. The mapper holds no
React and no I/O, so it is table-tested per card kind.

| Card         | Trigger                    | Action                            |
| ------------ | -------------------------- | --------------------------------- |
| `nudge`      | `date_reached(dateCol, 0)` | `notify` the owner                |
| `set_status` | `date_reached(dateCol, 0)` | `set_option` from the action      |
| `reassign`   | `item_created`             | `assign_person(columnId, userId)` |

The engine's `notify` action carries a recipient and no message — so a `nudge` card's one-off
message text does **not** survive into the rule, which notifies the owner with the engine's own
notification. Extending `notify` with a message field is a wider change to a shipped action than
this phase justifies, so the prefill drops the text and the editor shows the rule as it will
actually fire. The user reviews the draft before saving, so nothing is written that the copy implies
but the engine cannot do.

`item_created` is the trigger for `reassign` because it is the standing rule the card's own signal
implies: the suggestion exists because work is unowned or piled on one person, and the durable form
of "fix that" is that new work on this board lands on a named owner. The suggestion itself is bulk
(up to 50 items, one write); an automation fires per item, so the rule is the forward-looking half
of the same intent, not a replay of the apply.

The mapper returns `null` when the board lacks a column the draft needs — `nudge` and `set_status`
need a date column, `nudge` needs a people column for the owner recipient. A `null` draft renders no
button, which is the same behaviour the parent spec already specified for `reassign` before
`assign_person` existed. The button is also hidden for anyone who cannot create automations; the
`getBoardAdminStatus` read the dialog already performs is the gate.

### 2.3 Wiring

No new mechanism. `src/stores/board-intelligence.ts` is already the ephemeral bridge between the
dock and the board header, carrying nonce-stamped commands (`openRequest`, `filterRequest`) that the
consumer clears by nonce so a command issued while another is in flight is never lost. Act adds a
third of the same shape:

```
ruleRequest: { boardId: string; draft: Draft; nonce: number } | null
requestRule(boardId, draft) / consumeRule(nonce)
```

`BoardHeader` consumes it, opens `AutomationsDialog`, and seeds the builder through the existing
`startBuild(draft)` / `initialDraft` path that `generateAutomationDraft` already drives. Client
state end to end: zero server round-trips until the user presses Save, which is the existing
`createAutomation` server action.

Intelligence never executes a rule. The separation between suggesting and executing is the design,
and this phase must not erode it.

Out of scope, per the parent spec: stall-based triggers and any autopilot mode.

## 3. Phase 4 — Ask

### 3.1 The streaming route

`src/app/api/board-intelligence/ask/route.ts` (the directory does not exist yet). Modelled on
`src/app/api/ask/route.ts`: default Node runtime with no `runtime` export, which Cache Components
forbids.

- `requireUser` → `resolveActiveOrg` → `requireAiEntitlement("board_intelligence")`. The feature key
  already exists in `FEATURE_TIERS` (`src/lib/ai/model-map.ts`); metering and entitlement come for
  free and a second key must not be minted.
- Request body, Zod-validated: `{ runId, question, history }`, where `history` is the prior Q/A
  pairs the client holds. Validation is **strict on shape and truncating on size**: a count or
  length cap the model was never told about must never throw after the call is metered, because a
  failed run leaves the input hash unchanged and every retry pays again.
- The run is read by `runId` through RLS, which already restricts `board_intelligence_runs` to the
  owning user; a miss is a 404 and never a fabricated context.
- Context: the cached run payload (brief, suggestions, signals), `buildBoardSnapshot`, and the
  board's columns and members so option and user ids can be decoded into labels.
- Tools: `query_items` and `semantic_search_items` from `src/lib/ai/ask/tools.ts`, and nothing else.
  No write tools, no `propose_*`, no memory writes.
- `assertToolLoopCapable` before the loop, as `api/ask` does. No provider knob that any model in the
  catalog rejects — `thinking: { type: "disabled" }` is a 400 on Fable 5/5.1, and `pickModel` lets
  an org's default model outrank a feature's tier hint, so the request shape must be valid for every
  model an org could be on.
- Events are encoded with the existing `stream-protocol.ts`, so `useAskStream` needs no change.
  Usage is recorded under `board_intelligence`.

### 3.2 The composer

A composer at the bottom of `src/components/boards/dock/intelligence/IntelligenceTab.tsx`, driving
the existing `useAskStream` (`src/components/ai/ask/use-ask-stream.ts`).

- Up to five Q/A pairs in component state, oldest dropped past five. Nothing is persisted, no
  `ai_conversations` row is created, a reload clears them.
- Disabled when no run is cached, with a one-liner pointing at "Catch me up". Answers are grounded
  in the run by §6's contract, and keeping the composer inert without one also keeps a single
  entry point to LLM spend on this surface.
- Disabled while a write is in flight for the board (`busy[boardId]` in the store).

### 3.3 Open in Chat

A server action, `openQaInChat({ runId, question, answer })`, modelled on
`src/lib/agents/briefing-thread.ts`:

- Insert one `ai_conversations` row with `board_id` set to this board and `title` the question
  truncated to 60 characters, then two `ai_messages` rows — the user's question and the assistant's
  answer **verbatim as streamed**, in that order.
- Returns the conversation id; the dock switches to the Chat tab on that thread.
- The answer is persisted, not re-generated: the user is promoting the answer they just read, so a
  second call would both cost money and risk contradicting what is on screen.
- Written through the owner client, never the service client, so RLS bounds the write exactly as it
  bounds the read.

## 4. Performance and data-fetching budget

Extends §8 of the parent spec; nothing here relaxes it.

- "Always do this": client state only. Opening the dialog issues the automation reads it already
  issues today; nothing new on first paint.
- Composer submit: one streaming request. Pair history, scrolling, tab switches and rendering
  "Open in Chat" are zero round-trips.
- "Open in Chat": one server action — one insert plus two message inserts — then a client tab
  switch, no board refetch.
- Rule creation: the existing `createAutomation` server action with its existing revalidation.
- No new unbounded read. The run read is a primary-key read; the board snapshot is already bounded
  by `buildBoardSnapshot`.

## 5. Testing

Per §10 of the parent spec, plus the specifics this document introduces:

**Phase 3**

- `assign_person` is absent from `AI_STEP_ALLOWED_ACTIONS` and present in the derived agent action
  union — each assertion naming `assign_person` explicitly.
- Schema accepts a well-formed `assign_person` and rejects a missing or non-uuid `columnId`/`userId`.
- Executor (integration, under `PULSE_TEST_DB`): the action replaces the people cell with
  `[userId]`; a `columnId` that is not a people column on the firing board is refused; a `userId`
  outside the board's org is refused.
- `ruleDraftFor` table tests: the three mappings above; `null` for a board with no date column;
  `null` for `nudge` with no people column; `null` for `set_due` and `filter`, which map onto no
  primitive.
- `ruleRequest` round-trip in the store: request, consume by nonce, a stale nonce clears nothing.
- The button does not render for a non-admin, and does not render when the mapper returns `null`.

**Phase 4**

- The route's tool list contains exactly `query_items` and `semantic_search_items`; the assertion
  names the write tools it excludes.
- Stream-protocol round-trip against `useAskStream`.
- An over-length `history` truncates and the call still runs; malformed `history` is rejected before
  the call is metered.
- The composer is disabled with no run, and while `busy` is set.
- `openQaInChat` writes exactly two messages, user turn first; a `runId` the caller does not own is
  rejected server-side.

## 6. Execution DAG

Extends §9.3 of the parent spec. Phase 3 precedes Phase 4: Act carries the prerequisite, Ask is
self-contained.

Tasks:

1. **A — `assign_person` validation + agent-vocabulary tests.** Produces: the schema member and its
   exported type. Consumes: nothing.
2. **B — `assign_person` executor migration + regenerated types.** Consumes: A (the shape it
   executes). Produces: the DEV ledger row and `database.types.ts`.
3. **C — editor row, recipe preset, rule-list sentence.** Consumes: A.
4. **D — `rule-draft.ts` mapper + tests.** Consumes: A. Produces: `ruleDraftFor`.
5. **E — store `ruleRequest` + `BoardHeader`/dialog seeding.** Consumes: nothing (the `Draft` type
   already exists). Produces: `requestRule`.
6. **F — "Always do this" button on the cards.** Consumes: D, E, and the admin gate.
7. **G — Ask route.** Consumes: nothing in Phase 3. Produces: the streaming endpoint.
8. **H — composer + Q/A pairs in the Intelligence tab.** Consumes: G.
9. **I — `openQaInChat` + dock switch.** Consumes: H.

Waves:

- **Wave 1 (parallel):** A, E, G.
- **Wave 2 (parallel):** B, C, D, H.
- **Wave 3 (parallel):** F, I.

Critical path: A → B (migration and types) on the Act side, G → H → I on the Ask side. Migrations
land through the orchestrator one at a time so `database.types.ts` never races; each parallel task
gets its own worktree off the task branch, agents gate and commit, the orchestrator rebases and
merges. No agent runs `finish-task.sh`, merges, or pushes.

A whole-branch review runs before the merge to `develop`. It has found the blocking defect on every
session of this feature so far.
