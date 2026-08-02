# Ask Monolith Phase 2 — Confirm-Before-Execute Write Actions — Design

**Date:** 2026-07-26
**Slug:** `ask-pulse-phase2-write-actions`
**Status:** Spec written — awaiting review
**Phase:** 10 (AI & Agents) — Phase 2 of `2026-07-12-ask-pulse-full-page-conversational-design.md` (E3 F6 pulled forward)
**ADR:** `vault/decisions/2026-07-12-decision-27-ask-becomes-standalone-surface.md` §5

## Why this exists

`/ask` is read-only today. The write engine that would make it act — propose tools, resolution,
validation, execution, and the confirm card — **already exists and is tested**, built for the ⌘K
quick-action surface (`src/lib/ai/write/*`, `src/components/ai/actions/*`). This is a **plumbing
task**: teach the streaming Ask loop to carry the propose tools, carry a proposal through the NDJSON
protocol and the persisted transcript, and render the existing `ActionConfirmCard` in the thread.

No new engine, no new model prompt strategy, no new mutation path. The human gate stays
non-negotiable: nothing writes until the user clicks Approve.

## What already exists (reused verbatim, not rebuilt)

| Module                                               | What it gives us                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/ai/write/write-tools.ts`                    | `WRITE_TOOLS`, `LIST_MEMBERS_TOOL`, `createWriteToolExecutor` — **propose-only**, never mutates       |
| `src/lib/ai/write/resolve.ts`                        | Turns a proposal into a `ValidatedAction` with a human `summary` + `warnings`                         |
| `src/lib/ai/write/schema.ts`                         | `validatedActionSchema`, `ValidatedAction`, `ExecutionResult` — **client-safe** (no `server-only`)    |
| `src/lib/ai/write/execute.ts`                        | `executeAction` → the canonical `createItem` / `createGroup` / `upsertCell` Server Actions, RLS-gated |
| `src/lib/ai/write/propose.ts`                        | `proposeLoop` — the buffered reference implementation of the same tool loop                           |
| `src/components/ai/actions/ActionConfirmCard.tsx`    | The confirm card, already documented as "exported for the Ask-full-page track"                        |
| `src/components/ai/actions/QuickAction.tsx`          | The reference wiring (⌘K), mounted from `src/components/command-palette.tsx`                          |
| `src/lib/ai/entitlement.ts`, `src/lib/ai/gateway.ts` | `requireAiEntitlement`, `runAi` metering chokepoint — already wrapping every Ask turn                 |

What is **net-new**: one stream event, one branch in `ask-stream.ts`, one client-safe trace module,
two Server Actions, and the render path in `MessageList` / `AskChat`.

## The hard part: a propose tool returns nothing to continue on

Today's loop (`src/lib/ai/ask/ask-stream.ts`) is uniform: every `tool_use` block is executed, its
content is pushed back as a `tool_result`, and the model runs another round. A `propose_*` tool
breaks that shape — it **records** a `ValidatedAction` and produces no information the model needs
in order to keep reasoning. `proposeLoop` papers over this by feeding a `{preview, warnings}` blob
back and letting the model narrate; the streaming loop cannot afford that.

### Decision 1 — the turn ENDS at the confirm card

When a round collects ≥1 new `ValidatedAction`, the loop **stops**: it does not push tool results,
does not start another round, and returns immediately with the proposals.

Why:

1. **Correctness/safety.** Continuing gives the model a turn in which it will very often narrate in
   the past tense ("I've created Ship v2 for you") while nothing has been written. That is the exact
   failure the human gate exists to prevent. Ending the turn makes the lie structurally impossible.
2. **The lead-in sentence is free.** Anthropic emits `text` blocks **before** the `tool_use` block in
   the same assistant message, and `client.messages.stream()` fires `on("text")` for them. So the
   user already sees "I'll create that task for you —" streaming in, then the card. No extra round
   is needed to get good copy.
3. **Cost & latency.** A continuation round is a full extra request with the whole transcript. Zero
   value for a turn whose only remaining event is a human click.
4. **Testability.** One deterministic branch, asserted by counting `stream()` calls.

**Sub-rule — a propose tool that _errors_ does not end the turn.** `createWriteToolExecutor.execute`
returns `{content: '{"error": …}'}` for "board not found" / "that group isn't on this board" /
invalid input, and in that case collects nothing. Those results **are** fed back so the model can
self-correct within `MAX_ROUNDS`, exactly as a failing read tool does today. The branch keys off
`writer.collected().length` growing, not off the tool name.

**Sub-rule — mixed rounds.** If one assistant message contains both a read tool and a propose tool,
every block still executes in order (reads through `executeAskTool`, everything else through the
writer); the turn then ends because a proposal was collected. The read results are discarded — the
model does not get another turn to use them, and the proposal it already made is what the user
judges.

### Decision 2 — one new stream event; execution results do NOT ride the stream

`src/lib/ai/ask/stream-protocol.ts` gains exactly one variant:

```ts
| { type: "proposal"; actions: ValidatedAction[] }
```

emitted by the engine the instant it branches, before persistence and before the auto-title call.
`done` keeps its current shape (`conversationId`, `assistantMessageId`, `boardsConsulted`, `title?`);
the client stashes the proposal from the `proposal` event and binds it to the real
`assistantMessageId` when `done` arrives — the same closure-local pattern already used for `acc`.

`ValidatedAction` is safe to name in this module: `src/lib/ai/write/schema.ts` has no `server-only`
import and is already imported by the `"use client"` `ActionConfirmCard`.

**No execution-result event.** The brief anticipated one; it does not belong. The NDJSON body is one
server→client model turn, opened by `POST /api/ask` and closed when the turn ends. Approve happens
after that stream is closed — seconds or days later, possibly in a different browser session after a
reload. There is no stream to emit into, and adding the variant would create a type no producer can
ever construct. Execution is a **Server Action** returning `ActionResult` (below), which is also the
AGENTS.md-correct home for a mutation.

### Decision 3 — how a proposal rides on `UIMessage`

`UIMessage` (in `MessageList.tsx`) is `{id, role, content}` today. It gains one optional field:

```ts
trace?: AskToolTrace;
```

— the parsed `ai_messages.tool_trace` for that turn. `MessageList` then renders an
`ActionConfirmCard` under the assistant bubble for each entry in `trace.proposedActions`.

Whether a given card is still pending is **derived, not stored on the proposal**: a pure
`resolveProposalStates(messages)` walks the thread once and maps each proposal message id to a
`ConfirmState` + result note, by looking for a later message whose trace carries
`resolvesProposal === <that id>`. Pure function, trivially unit-tested, and it makes reload and
live-update produce byte-identical UI.

## Persistence — `tool_trace` jsonb, **no migration**

`ai_messages.tool_trace jsonb` (migration `20260716173339_ai_conversations.sql`) currently holds
`{boardsConsulted}`. Proposals and execution results ride in the same column. The original spec
already reserved it for exactly this: _"tools consulted / (phase 2) proposed & executed actions, for
transparency + re-render."_

**Why no migration:**

- The data is strictly **1:1 with one assistant message**, is never queried across rows, never
  filtered, aggregated, or joined. The only read is "load this thread's turns" — already bounded and
  indexed on `(conversation_id, created_at)`, and `getMessages` **already selects `tool_trace`**, so
  this costs **zero new queries and zero new columns** on first paint.
- **RLS comes for free.** `ai_messages` policies derive ownership from the parent conversation. A
  separate `ai_actions` table would need its own default-deny policies — new attack surface, new
  integration tests, for no capability we need.
- Volume is bounded: proposals per turn are capped at 10 (mirroring `executeActions`), each a small
  object.
- A migration would be justified only if actions had to be queried **independently** of their
  message — a cross-thread audit view, "everything Ask created this month", a retry queue. None of
  those are in scope, and the real audit trail already exists elsewhere: the underlying rows carry
  their own provenance, and `ai_usage` meters the model call.

### The shape

Two trace shapes, both under `askToolTraceSchema` (unknown keys tolerated, so today's
`{boardsConsulted}` rows keep parsing):

```jsonc
// the proposal turn (assistant)
{ "boardsConsulted": ["<uuid>"], "proposedActions": [ /* ValidatedAction */ ] }

// the outcome turn (assistant, appended on Approve or Cancel)
{ "resolvesProposal": "<assistant message uuid>",
  "outcome": "applied" | "cancelled",
  "results": [ { "ok": true, "itemId": "<uuid>" } ] }
```

### Decision 4 — the outcome is an APPENDED message, not an update to the proposal row

Two independent reasons, either of which is decisive:

1. **There is no UPDATE policy on `ai_messages`.** The table has `select` / `insert` / `delete`
   policies only. Default-deny means an update through the cookie-bound client fails. Writing the
   result back onto the proposal row would therefore need **either** a migration (adding an update
   policy) **or** the service client — and this is user-owned content, so the RLS-writes stance from
   decision-27 says neither.
2. **The model's context is built from `content` only.** `buildAskMessages` maps rows to
   `{role, content}` and drops `tool_trace` entirely. If the outcome lived in a trace field, the
   model would never learn that the action was applied, and a follow-up "did you create it?" would be
   answered wrong. An appended assistant turn whose `content` reads _"Created "Ship v2" in Backlog."_
   is what makes the conversation coherent.

Cancel is persisted too (`outcome: "cancelled"`, content _"Cancelled — nothing was changed."_). It
costs one insert and buys two things: the card does not come back as pending after a reload, and the
model knows the user declined rather than silently re-proposing.

## Server Actions (all mutations, per AGENTS.md)

New module `src/lib/ai/ask/proposal-actions.ts` — naming mirrors the existing
`conversation-actions.ts`.

### `applyAskProposal({ conversationId, messageId })`

1. Zod: both uuid.
2. `requireUser()` + `resolveActiveOrg()`.
3. **Entitlement:** `getAiEntitlement(org.id)`; `mode === "off"` → fail. No `runAi`, no new charge —
   execution is deterministic DB work, not a model call. Mirrors `executeActions` exactly.
4. **Re-read the proposal from the DB** through the cookie-bound client
   (`ai_messages`, `.eq("id", messageId).eq("conversation_id", conversationId).single()`). RLS scopes
   it to the owner, so a foreign or missing message returns no row → "Proposal not found."
5. `parseToolTrace(row.tool_trace)` → `proposedActions`, then **re-parse each through
   `validatedActionSchema`** (defence in depth against a hand-edited jsonb row), capped at 10.
6. **Idempotency:** refuse if the thread already contains a message with
   `tool_trace->>resolvesProposal = messageId` → "This proposal was already resolved." Stops
   double-apply from two tabs or a double click. The filter is scoped by `conversation_id`, which is
   indexed, over a thread bounded at 200 rows.
7. Run each action through the existing `executeAction`.
8. Insert the outcome assistant message (content + trace), return
   `{ messageId, content, results }`.

**The client never sends the action array.** It sends two ids. This is strictly stronger than
`QuickAction`'s model, where the client round-trips the `ValidatedAction[]` and the server
re-validates the shape — here there is nothing to forge, because the payload is read from a row the
caller could only have obtained through RLS.

### `cancelAskProposal({ conversationId, messageId })`

Same steps 1–2, 4–6, then insert the `cancelled` outcome. No entitlement check (no model call, no
writes), no `executeAction`.

Neither action calls `revalidatePath`. Within-board mutations in this repo deliberately do **not**
revalidate the board RSC (see the rule comment in `src/lib/boards/actions/group.ts`) — open boards
converge via Realtime. The `/ask` transcript converges via the returned outcome message appended to
client state.

## Entitlement, provider, and permission gating

- **Proposal path:** `/api/ask` already calls `requireAiEntitlement(org.id, "ask_pulse")` before any
  token spend, and already throws `ProviderNotCapableError` when the resolved adapter lacks tool
  support (write tools are Anthropic-only, same as read tools). **No new gate** — proposing rides the
  same single metered `runAi` turn.
- **Metering feature label stays `"ask_pulse"`.** One turn is one call; splitting the label per tool
  would misattribute the same tokens. `conversational_action` remains the ⌘K surface's label.
- **Execution path:** re-checks `mode !== "off"` so a stale proposal cannot be applied after an admin
  turns AI off, then relies on RLS at every write.
- **Board permissions are RLS's job, not ours.** A viewer-level user can get a proposal that fails at
  execute with the policy's error; the confirm card surfaces it verbatim in `resultNote`. We do not
  pre-flight writability — the check would be a second, drift-prone copy of the policy. Noted as a
  known rough edge, not a bug.
- **Not in scope:** an org-level "let Ask write" toggle. If it is ever wanted, `org_ai_settings` is
  its home.

## Reload with an unconfirmed proposal pending

The proposal **survives**, because it lives in the persisted `tool_trace`, not in client state.

- `/ask/[conversationId]/page.tsx` already selects `tool_trace` via `getMessages`. It maps each row
  through `parseToolTrace` into `UIMessage.trace`.
- `resolveProposalStates` finds no resolving message → the card renders `idle` with Approve/Cancel
  live. Approve works because the server re-reads the actions itself.
- If it **was** resolved, the card renders `done` (or `error`, if any result failed) with the stored
  note, and the outcome message renders as the next turn.

**Staleness:** proposals have **no TTL**. A proposal made against a group that has since been deleted
fails at execute, and `executeAction`'s error (from the canonical action / RLS) is surfaced in the
card's `resultNote`. A TTL would be arbitrary and would silently discard valid intent; a real error
message is more useful than a preemptive expiry.

**Two tabs:** the idempotency check in step 6 makes the second Approve fail with "already resolved"
rather than double-creating.

## System prompt

Today's `SYSTEM` in `route.ts` is read-only in tone ("Use the read tools to ground every claim").
It merges the write guidance already proven in `propose.ts`:

- today's date + the user's timezone, so "Friday" resolves to an ISO date. Sourced from
  `getUserTimeZoneCached(user.id)` (`src/lib/profile/queries-cached.ts`) — one cached read.
- resolve exact ids via the read tools first; never assume an id.
- the `propose_*` tools do **not** write; the user confirms.
- if the board/group is ambiguous, ask **exactly one** focused question instead of proposing.

`askPulseLoop` (`src/lib/ai/ask/ask.ts`, the non-streaming twin used by other callers) stays
**read-only**. Only the streaming loop gains write tools.

## Performance & data-fetching budget (working agreement #5)

| Moment                        | Cost                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **First paint** (`/ask/[id]`) | Unchanged — conversation list (≤100, indexed `(user_id, updated_at desc)`) + thread (≤200, indexed `(conversation_id, created_at)`). `tool_trace` is already in the existing `select`: **0 new queries, 0 new columns.** |
| **Proposal appears**          | **0 additional round-trips** — rides the open NDJSON stream. One extra cached read per turn (`getUserTimeZoneCached`).                                                                                                   |
| **Model turn that proposes**  | **Cheaper than today's**: the loop stops a round earlier than a read-only answer would.                                                                                                                                  |
| **Approve**                   | Exactly **1** Server Action round-trip: 1 PK read + ≤10 bounded writes + 1 insert. No RSC navigation, no `router.refresh()`.                                                                                             |
| **Cancel**                    | Exactly **1** Server Action round-trip: 1 PK read + 1 insert.                                                                                                                                                            |
| **Outcome renders**           | Client state append. **0 RSC navigations** — the existing `router.refresh()` after `done` (rail titles) is untouched.                                                                                                    |
| **Bounded**                   | ≤10 proposals per turn; `MAX_ROUNDS = 6` unchanged; `tool_trace` per message bounded by that cap.                                                                                                                        |

No unbounded reads are introduced. The one non-PK filter (the idempotency check) is scoped by the
indexed `conversation_id` over a thread already capped at 200 rows.

## Testing (working agreement #4 — written AND executed)

**Unit — engine**

- `ask-stream.test.ts`: a round collecting a proposal ends the turn (assert `stream()` called exactly
  once, no continuation), emits `proposal`, returns the streamed lead-in as `answer`, and returns the
  actions; a propose tool that **errors** feeds back and the loop continues; the existing read-only
  path is unchanged.

**Unit — trace**

- `tool-trace.test.ts`: `parseToolTrace` accepts a legacy `{boardsConsulted}` row, accepts both new
  shapes, returns `null` for garbage; `resolveProposalStates` returns `idle` when unresolved, `done`
  when applied, `error` when any result failed, `done` with the cancel note when cancelled.

**Unit — Server Actions**

- `proposal-actions.test.ts`: rejects a non-uuid; fails when RLS returns no row (foreign message);
  fails when the trace has no proposals; **refuses a second apply**; fails when AI mode is `off`;
  re-validates from the DB and never from an input array (assert no action array is accepted);
  inserts the outcome message with the right trace on both apply and cancel.

**Component**

- `MessageList.test.tsx`: renders a confirm card per proposed action; renders no card without a
  trace; renders the resolved state and note; fires `onApprove`/`onCancel` with the message id.
- `AskChat.test.tsx`: a `proposal` event followed by `done` renders the card bound to
  `assistantMessageId`; approving appends the outcome message and marks the card done; a failed
  apply surfaces the error without appending a success turn.

**Route**

- `route.test.ts`: the entitlement gate still rejects before token spend; a proposal turn persists
  `proposedActions` into `tool_trace`.

**Integration (skips without `PULSE_TEST_DB`, rolled-back txn on DEV)**

- Extend `ai-conversations.rls.integration.test.ts`: a non-owner can neither read a message carrying
  a proposal trace nor insert an outcome message into someone else's thread.

**E2E — the known gap, addressed narrowly.** No `e2e/ask*.spec.ts` exists. This task adds
`e2e/ask.spec.ts` covering only the **deterministic, non-AI surface**: `/ask` loads for an
authenticated user, the rail and composer render, and the first send rewrites the URL to
`/ask/<id>`. It deliberately does **not** drive a model round-trip — that needs a live Anthropic key
plus credits and a non-deterministic response, which is a flake and cost generator, not a test. The
confirm/approve half is covered deterministically at the component level with mocked Server Actions.
This is stated as a conscious limit, not an oversight.

All four gates must pass before merge: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Out of scope (v1)

Editing a proposal before approving; partial approval of a multi-action proposal (approve-all or
cancel-all only, matching `QuickAction`); undo after execute; destructive proposals (delete/archive —
`WRITE_TOOLS` has none, and adding one is a separate decision); an org toggle for Ask-writes;
proposals in the ⌘K popup path (unchanged); a follow-up model turn narrating the result (the outcome
message is written deterministically — no extra tokens).

## Independent units (for the plan's DAG)

- **A.** `executionResultSchema` in `write/schema.ts` + the new client-safe `ask/tool-trace.ts`.
- **B.** `stream-protocol.ts` `proposal` event + the `ask-stream.ts` branch.
- **C.** `proposal-actions.ts` Server Actions (needs A).
- **D.** `route.ts` wiring — write-aware system prompt, `orgId`/timezone, trace persistence (needs A, B).
- **E.** `MessageList` + `UIMessage` + `[conversationId]/page.tsx` mapping (needs A).
- **F.** `AskChat` wiring (needs B, C, E).
- **G.** RLS integration extension + `e2e/ask.spec.ts` (needs F).

C, D and E touch disjoint files and can run concurrently. A and B are independent leaves.

## Closure

- **No migration.** `pnpm db:ledger-check` should report no drift; nothing to apply via the
  `supabase-dev` MCP, nothing to `sync-prod`.
- ADR: none required — this executes decision-27 §5 as written. If review overturns Decision 1 or 4,
  that reversal gets an ADR.
- Update `vault/00-north-star.md` §3 and the Phase 10 roadmap note when Phase 2 lands.
- "How to test" walkthrough handed to the user at merge (the plan carries it).
