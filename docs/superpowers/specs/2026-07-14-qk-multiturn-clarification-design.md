# ⌘K Multi-Turn Clarification — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorming) → ready for plan
**Area:** Phase 10 E3 — ⌘K natural-language actions (`QuickAction`)

## Problem

The ⌘K "Run a command" flow (`src/components/ai/actions/QuickAction.tsx` →
`proposeActions` → `proposeLoop`) is **single-shot**. When a command is
ambiguous (unknown board, no matching member, missing group), the model — per
its system prompt — declines to propose and returns a clarifying question. The
UI renders that question as passive gray `<p>` text with **no way to answer it**:
the user has to intuit that they must retype the entire command with the answers
baked in. During testing this read as a dead-end / broken flow, twice.

Two aggravating factors:

1. The model behaves **conversationally** ("did you mean Danijel?", asking 2-3
   follow-ups at once), which strongly implies a reply box that does not exist.
2. There is **no "working" indicator** between submit and response, so a slow
   turn (the loop can make several tool calls) looks stalled.

## Goals

- Turn the clarification into a real **multi-turn conversation**: user replies
  inline, the model continues until it can propose a concrete action (confirm
  card) or the user cancels.
- Model asks **one focused question at a time** (no multi-question dumps).
- A visible **"working" indicator** so the flow never looks stalled; clear error
  state on failure.

## Non-Goals

- No change to the confirm-card / execute path (`ActionConfirmCard`,
  `executeActions`, `executeAction`) beyond how it is reached.
- Not a general chat assistant — this is scoped to resolving one write command.
  Ask Pulse (F5) remains the conversational read surface.
- No persistence of conversations across palette open/close — the transcript
  lives only for the life of the open palette.

## Approach — thread the raw Anthropic transcript

The core decision: what state is threaded between turns.

**Chosen:** `proposeLoop` returns the full Anthropic `messages[]` transcript
(including the tool-use rounds where it already resolved boards, members, and
status options). The client holds it as **opaque state** and passes it back with
the user's reply, so the model **continues** the same conversation.

**Rejected:** replaying only the visible text turns. Simpler to store, but forces
the model to re-run every read tool (`list_boards`, `list_board_members`,
`get_board_overview`) on each turn — more tokens, more latency, and it re-creates
the "which board again?" repeats we are trying to kill. Threading the real
transcript makes turn 2 _cheaper_ than a cold start.

### Safety on the threaded transcript

- The transcript contains only the user's own **RLS-scoped** org data (boards,
  members they can already read). Nothing new is exposed.
- **Nothing executes off the client-supplied transcript.** It is context for the
  model only. Every proposed action is still re-validated server-side against
  `validatedActionSchema` and executed via `executeAction`, which is RLS-enforced.
  A tampered transcript can at most make the model _propose_ something the user
  must still confirm and that `executeAction` re-checks.
- **Bounded:** a hard **max-turns cap** (5 user replies) bounds cost/latency. On
  the 6th, the server refuses and tells the user to start fresh with a more
  specific command. Per-turn spend is still bounded by the existing
  `MAX_ROUNDS = 6` tool-use cap inside `proposeLoop`.

## Components & data flow

### `proposeLoop` (`src/lib/ai/write/propose.ts`)

- Accept an optional `messages?: Anthropic.MessageParam[]` seed. When present,
  append `{ role: "user", content: instruction }` to it; otherwise start fresh
  (current behavior).
- Run the existing tool-use loop unchanged.
- Return `{ actions, clarification?, usage, messages }` — `messages` is the full
  transcript _after_ the loop (so a clarification turn can be threaded back).
- When the loop ends with proposals, `clarification` stays undefined and the
  transcript need not be threaded further (conversation is over → confirm card).

### `proposeActions` (`src/lib/ai/write/actions.ts`)

- New signature: `{ instruction: string; history?: AiConversationTurn[] }`.
- Validate `history` with a Zod schema (roles `user`/`assistant`, content is a
  string or an array of content blocks). Unparseable history **degrades to a
  fresh start** (drop it, treat the instruction as turn 1) rather than hard-
  failing — a dead-end is the very UX we are removing. Enforce the **5-turn cap**
  (count user-role turns in well-formed history); exceeding it _is_ a hard `fail`.
- Still entitlement-gated (`requireAiEntitlement`) and metered via `runAi` **per
  turn** — each turn is real token spend, so each is charged. Correct.
- Return `{ actions, clarification?, history }` where `history` is the updated
  transcript to thread back on the next reply.

`AiConversationTurn` is a thin alias for `Anthropic.MessageParam` with a Zod
guard; defined next to the schema so client and server share one shape.

### `QuickAction` (`src/components/ai/actions/QuickAction.tsx`)

- State: a **display transcript** (`{ role: "you" | "ai"; text: string }[]`), the
  opaque `history: AiConversationTurn[]`, plus `actions`, confirm `state`,
  `note`, `error`, and a `phase` (`idle` | `working`).
- Submit / reply: push the user's row → set `phase = working` → call
  `proposeActions({ instruction: reply, history })`.
  - `actions.length > 0` → render `ActionConfirmCard` (conversation ends).
  - `clarification` → push an `ai` row, replace `history` with the returned
    transcript, keep the reply box focused for the next turn.
  - `error` → show error row, re-enable the box.
- The reply box is a persistent textarea pinned at the bottom, disabled while
  `phase === "working"`. All **client state — zero RSC navigation / refetch.**

### System prompt (`propose.ts` `systemPrompt`)

Add: "Ask exactly ONE focused question at a time. Do not batch multiple
questions." Keeps the existing "don't propose when ambiguous" rule.

## The "working" indicator

While a turn is pending:

- An animated **"Pulse is working…"** row (pulsing dots) renders in the transcript
  where the next answer will appear.
- The reply box is disabled; the submit button shows a spinner + "Working…".
- On error (timeout / quota / provider), that row is replaced by a clear error
  message and the reply box is re-enabled so the user can retry.

So there is always a live signal between submit and response — never dead air.

## Error handling

- Reuse `mapAiError` for typed AI errors (disabled / quota / not-configured / BYO
  missing / not-capable) → friendly copy in an error row.
- Turn-cap exceeded → "Let's start fresh — try a more specific command."
- Malformed history → treated as a fresh start server-side rather than a hard
  error, but the 5-turn cap still applies to what is well-formed.

## Performance & data-fetching budget (working agreement #5)

- **First paint:** the palette is already client; mounting `QuickAction` loads no
  server data.
- **Each interaction:** a reply is a Server Action call — unavoidable, it _is_ the
  model call, and it changes no server data on the board until Approve. **Zero RSC
  refetch**; no `<Link>`/router navigation. In-page toggles remain 0 round-trips.
- **Bounded:** 5-turn cap × `MAX_ROUNDS` per turn bounds worst-case token spend
  and latency. Threading the transcript avoids redundant read-tool calls, so
  later turns do _less_ work, not more.

## Testing

- **`propose.ts`:** a continuation seeded with a prior transcript reaches a
  proposal **without re-running read tools** (mocked Anthropic client returns a
  clarification, then a proposal on continuation). Assert the seed messages are
  preserved and the returned `messages` grows.
- **`actions.ts`:** history threading round-trips; turn-cap enforcement (6th reply
  refused); malformed-history rejection; entitlement error mapping unchanged.
- **`QuickAction.tsx` (RTL):** submit → **working indicator visible** →
  clarification appended as an `ai` row → reply → confirm card appears; error path
  replaces the working row and re-enables the box; ⌘↵ submits.

## Execution DAG

Single tightly-coupled vertical (~4 files) around one shared interface
(`AiConversationTurn` + the `proposeActions` signature). The client depends on the
server contract, so it is **inherently sequential**, not parallelizable:

1. `AiConversationTurn` shape + `proposeLoop` seed/return + prompt tweak (server).
2. `proposeActions` signature, history validation, turn cap (server) — depends on 1.
3. `QuickAction` transcript UI + working indicator (client) — depends on 2's contract.
4. Tests written alongside each (TDD).

Critical path = 1 → 2 → 3. One worktree (`task/qk-multiturn`), single agent, TDD,
all four gates before merge to `develop`.
