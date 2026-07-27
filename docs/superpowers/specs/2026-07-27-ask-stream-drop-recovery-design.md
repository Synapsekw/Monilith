# Ask stream drop recovery — design

Date: 2026-07-27
Rationale: `vault/decisions/2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams.md`

## Problem

When the `/api/ask` NDJSON response is severed mid-turn, `/ask` renders **nothing** — no error,
no spinner change, no notice. The streaming bubble simply stops growing. Meanwhile the
server-side turn almost always runs to completion and **persists** the assistant message (a
2,594-char reply with its tool trace was confirmed sitting in `ai_messages` at the exact moment
the user saw silence). A hard reload showed it instantly.

The client is the only broken part: `readAskStream` returns `void`, so `useAskStream` cannot tell
"the reader finished because the turn ended" from "the reader finished because the socket died".

## Design

### 1. Detection — a terminator-aware reader

`readAskStream` returns `boolean`: **true iff a terminal event was observed**. Terminal =
`done` (normal completion) **or** `error` (the route's own failure path, which already surfaces a
message and must not be treated as a drop).

Two robustness points:

- A severed stream usually truncates mid-line, so the trailing-buffer flush can hold **partial
  JSON**. Today that `JSON.parse` throws. A truncated tail _is_ the drop signature, not a protocol
  error — the flush now swallows a parse failure and reports "no terminator". Mid-stream lines stay
  strict (truncation only ever happens at the tail).
- `useAskStream.send` returns a `StreamOutcome`:
  - `"ok"` — a terminator was seen, **or** the request failed before the body (`!res.ok`, which
    already emits an `error` event).
  - `"dropped"` — the reader ended with no terminator, **or** `fetch`/the reader threw.

The wire union `AskStreamEvent` is unchanged: a drop is a _client-local_ condition and nothing
could ever emit it over the wire.

### 2. Recovery — re-read the thread, don't just apologize

New Server Action `recoverConversation({ conversationId })` in `conversation-actions.ts`. It
re-reads the thread through the existing bounded, indexed `getMessages` (limit 200, RLS-scoped)
and maps rows with `parseToolTrace` — **the exact mapping the `/ask/[conversationId]` page uses on
a hard reload**. The shared mapper `toThreadMessages` moves into `conversations.ts` so the page and
the action cannot drift.

The action returns the whole thread and the client **replaces** its message list with it. This is
correct because every user turn is persisted by `createConversation` / `appendUserMessage`
_before_ the stream opens — the server thread is always the complete truth. Replacing therefore:

- reconciles the optimistic `tmp-` user bubble with its real row,
- recovers the assistant answer verbatim (not the partial token accumulation),
- **recovers a proposal turn correctly**: `tool_trace.proposedActions` comes back, so
  `resolveProposalStates` renders the confirm card in `idle` and Approve/Cancel still work — they
  take only ids and re-read the actions server-side.

**Recovered vs. not** is decided by one predicate: the last row's role. `assistant` → the turn
landed. `user` → nothing landed yet.

### 3. Automatic first, manual fallback

**Decision: one automatic recovery attempt immediately on drop, and — only if it finds nothing —
a persistent "Connection lost" card with a "Check again" button.**

Reasoning:

- The answer is _usually already there_ (gotcha-61's row was written before the user even noticed).
  Making the user click to see an answer that already exists is silence with extra steps.
- The attempt is one cheap indexed read. No model call, no cost, no mutation, idempotent — nothing
  about it warrants a confirmation prompt.
- But it can legitimately find nothing: the drop typically happens _mid-turn_, and the server may
  need many more seconds to finish and persist. Auto-**polling** that window would mean a spinner
  that lies for an unbounded time, so the second attempt is the user's, on an honest card that says
  the reply may still be finishing.

Copy is deliberately non-committal about failure, because "your question was not answered" would be
a lie while the server is still working:

> **CONNECTION LOST** — The reply didn't reach your browser. It may still be finishing on the
> server. **[Check again]**

On success, a one-line muted note: "Connection dropped — recovered your answer."

### 4. Don't strand the composer

`useAskStream` already clears `streaming` in `finally`, so it is not stuck today — a regression
test pins that. The composer is additionally disabled while a recovery check is in flight
(`disabled={streaming || dropState === "checking"}`) and re-enabled in every terminal state, so
the input is never dead and never accepts a second question mid-check.

## UI (Monolith Keystone)

`StreamDropNotice` renders in the assistant gutter (`pl-10`), matching `ActionConfirmCard`'s
geometry: `bg-surface rounded-lg border p-3 text-sm`, `<Kicker>` label, hairline that brightens on
hover, `aria-live="polite"`, no shadow, no raw colors. "Check again" is a `size="sm"` ghost button
with a `RotateCw` lucide icon. Three states: `checking` (muted, `animate-pulse`), `unrecovered`
(the card), `recovered` (one muted line).

## Performance & data-fetching budget (working agreement #5)

- First paint: unchanged.
- Drop → recovery: **exactly one Server Action round-trip**, a bounded (≤200) read over the
  `(conversation_id, created_at)` index. No RSC navigation. One `router.refresh()` after a
  successful recovery to pick up an auto-title in the rail — the same single refresh a normal
  `done` already does.
- "Check again": one more of the same read. No polling, no timers, no unbounded retries.

## Testing

TDD; the central test simulates a severed stream — a reader that yields tokens then closes with
no `done`.

1. `readAskStream` → `true` on `done`, `true` on `error`, `false` on a severed close, `false`
   (no throw) on a truncated trailing line.
2. `useAskStream.send` → `"dropped"` on a severed stream and on a `fetch` throw; `streaming`
   cleared in both.
3. `AskChat` severed stream + **persisted answer** → the real answer renders, composer re-enabled.
4. `AskChat` severed stream + **nothing persisted** → "Connection lost" card; "Check again" then
   renders the answer once it lands.
5. `AskChat` severed stream on a **proposal turn** → confirm card renders and Approve works.
6. `recoverConversation` → uuid validation, thread mapping, trace parsing.

## Execution DAG

Single task, single file cluster, one agent — no parallel batches. Critical path:
reader → hook → action → chat wiring → notice component.
