# Agents page (was Ask AI) — design

Date: 2026-09-07
Status: approved (design), not yet planned

## Problem

`/ask` is the full-page chat surface. Three things are wrong with it today.

1. **Talking to a specific agent is hard.** An `@handle` is honoured only when it
   LEADS the FIRST message of a NEW conversation, because the persona is a
   column on the conversation row (`ai_conversations.agent_id`). The existing
   thread page (`src/app/ask/[conversationId]/page.tsx`) does not even load the
   owner's agents, so the mention picker never opens there, and a handle typed
   mid-thread is refused with "Start a new chat to ask a different agent."
2. **Daily briefings bury the chats.** Every agent run writes a thread through
   `writeBriefingThread` (`ai_conversations.run_id` non-null, title
   `"<Agent> — <date>"`). `listConversations` reads all conversations
   newest-first with one bounded limit, and `ConversationRail` renders them as
   one undifferentiated list, so a daily agent pushes real chats off the rail.
3. **The surface reads as a generic AI box, not as the owner's agents.** The nav
   says "Ask AI", nothing on a turn says who answered, and the rail has no
   search, no grouping and no header context.

## Outcome

`/ask` becomes **Agents**: a place where the owner talks to the agents they
built, switching between them inside one thread, with the day's reports parked
in their own section instead of interleaved with conversation.

## Non-goals

- No route change. The page stays at `/ask` (`/ask/<conversationId>` for a
  thread). Renaming is user-facing labels only; code identifiers (`AskChat`,
  `AskAiMark`, `askPulseStream`) are untouched.
- No memory WRITES from chat. No agent capability grants in chat.
- No change to how scheduled runs execute, to briefing email, or to the
  proposal/approval flow.

---

## 1. Per-message agent routing (sticky)

### Model

A conversation no longer has one immutable persona. It has a **current
persona**, and every message records the agent it belongs to.

- `ai_conversations.agent_id` keeps its column but changes meaning: "who is
  answering this thread right now". It is rewritten when the owner addresses a
  different agent or picks one from the header switcher.
- **New column** `ai_messages.agent_id uuid references user_agents(id) on delete
set null`. On a user turn it records who the turn was addressed to; on an
  assistant turn, who answered. Null means the plain Monolith assistant. `on
delete set null` because a deleted agent must not delete transcript history.

### Resolution rule

Resolution happens **server-side only**. The client may send a hint, but the
server re-derives the answer from the message text and the owner's roster; a
client-supplied agent id is never trusted.

```
addressedAgent(text, roster, currentPersona):
  leading @handle in text that matches an ENABLED agent owned by the caller
    -> that agent            (and it becomes the thread's current persona)
  leading @handle that matches nothing
    -> currentPersona        (the question is still a good question)
  no leading handle
    -> currentPersona        (sticky)
```

"Leading" keeps the existing rule from `Composer.leadingAgent`: `@ops what
slipped?` addresses Ops, `ask @ops later` does not.

The escape back to the plain assistant is the **header switcher** ("Monolith
assistant"), which sets `ai_conversations.agent_id = null`. There is no magic
handle.

### Where each piece lives

- `src/lib/ai/ask/persona-routing.ts` (new, pure): `resolveAddressedAgent` over
  a roster + text + current persona. Unit-tested in isolation.
- `createConversation` / `appendUserMessage`
  (`src/lib/ai/ask/conversation-actions.ts`): resolve, persist
  `ai_messages.agent_id`, and update `ai_conversations.agent_id` when it
  changed. Both are Server Actions and stay so.
- `/api/ask` route: reads the persona from the **last user message's
  `agent_id`**, not from a client field, and composes the system prompt for that
  agent. The assistant row it inserts carries the same `agent_id`.
- New Server Action `setConversationAgent({ conversationId, agentId | null })`
  for the header switcher. Owner-only, validated against the roster; it writes
  the conversation row and nothing else — no navigation, no refetch.
- `AskChat` drops `personaIgnored` and its notice entirely.
- `src/app/ask/[conversationId]/page.tsx` now also loads
  `listOwnerAgentTargets` (the picker must work in an existing thread) and the
  thread's current persona.

Two consequences worth stating explicitly:

- **Replying into a briefing works by construction.** `writeBriefingThread`
  already sets `ai_conversations.agent_id`, so the first reply in a report
  thread is answered by the agent that wrote it, with no extra rule.
- **Old rows render fine.** `ai_messages.agent_id` is null for every existing
  turn, which renders as the plain Monolith assistant — the surface's own
  history is not rewritten.
- The new column needs no policy change: `ai_messages` is insert-only and its
  existing policies gate on conversation ownership, not per column.

### Failure behaviour

A roster read that fails degrades to "no suggestions / current persona
unchanged" — never a failed turn. An agent row deleted between send and answer
resolves to null (plain assistant) rather than 500-ing the turn.

---

## 2. What an agent brings into a chat turn

When a turn resolves to agent X, its system prompt is composed through the
**same** path a scheduled run uses — no second implementation and no second
budget arithmetic:

- `listDocumentsForAgent` + `listMemoryForAgent` (owner client, RLS-scoped),
- `documentBudget` with the resolved model's `contextLength` and
  `ASSUMED_PREFIX_TOKENS`, then `selectDocuments` / `selectMemory`,
- `buildDocumentBlock` / `buildMemoryBlock` / `composeSystemPrompt` with the
  agent's stable `doc_nonce`, so the instructions marker is nonce-keyed exactly
  as in a run.

These reads happen **inside the `runAi` callback**, which is the only place the
resolved model — and therefore the real context window — is known. That mirrors
`execute-run.ts` deliberately.

Composition order for a chat turn: Ask's own read/write guidance (the existing
`buildSystem` output, plus board scope when the thread has one) is the
`preamble`; then documents; then memory; then the agent's instructions last.

### Boundaries (confirmed with the owner)

- **Read-only knowledge.** No `agent_remember` / `agent_forget` descriptors in
  chat. Memory is the one untrusted block whose writer and reader are the same
  actor; opening that path on an interactive surface is its own spec, not a
  side effect of this one.
- **No capability grants in chat.** Chat keeps its existing read tools and the
  `propose_*` confirm-card flow. An agent's `capabilities` set governs
  scheduled runs only.

### Cost

The composed system block is stable per agent between turns, so Anthropic prefix
caching absorbs it after the first turn of a thread. Switching agents mid-thread
invalidates the prefix for that turn by construction — that is the cost of the
feature, and it is bounded by the same envelope a run pays.

---

## 3. Rail: chats and briefings separated

### Reads

`listConversations` is replaced by two bounded reads in
`src/lib/ai/ask/conversations.ts`:

```
listChats(userId)      -> ai_conversations where user_id = $1 and run_id is null
listBriefings(userId)  -> ai_conversations where user_id = $1 and run_id is not null
```

Both `order by updated_at desc limit 50`. Two reads, not one 100-row read with a
client-side split: a week of daily briefings would otherwise crowd every chat
out of the shared cap — which is the bug being fixed.

**Migration** adds two partial indexes so each read stays index-only:

```sql
create index ai_conversations_chats_idx
  on ai_conversations (user_id, updated_at desc) where run_id is null;
create index ai_conversations_briefings_idx
  on ai_conversations (user_id, updated_at desc) where run_id is not null;
```

Minted with `scripts/new-migration.sh`, applied to DEV via the `supabase-dev`
MCP with the same version + name, then `pnpm db:ledger-check`, and
`database.types.ts` regenerated in the same PR.

### Rail UI (layout C)

Top to bottom: **New chat** · **search field** · **Today / Earlier** groups of
chats · collapsed **Briefings ▸ N**, which expands to the newest briefings,
newest first, each row labelled by agent + date.

Search filters the already-loaded rows in the browser — a keystroke costs zero
round trips. Date grouping is computed from `updated_at` in the viewer's
timezone. Rename/delete menus stay exactly as they are, on both kinds of row.

---

## 4. Header, messages, composer

**Header** (`src/app/ask/layout.tsx` is the frame; the thread header belongs to
the page/chat so it can name the thread): thread title on the left, agent
switcher chip on the right (`● Ops ▾`), then the existing theme toggle. The
switcher lists the owner's enabled agents plus "Monolith assistant"; choosing
one calls `setConversationAgent` — one Server Action, no navigation, no refetch
(working agreement #5). On a not-yet-minted chat it is client state that is
handed to `createConversation`.

**Messages** (`MessageList`): every assistant turn carries a kicker with the
answering agent's name (or "Monolith") and the turn's time. User turns keep
their aligned bubble. Proposal cards, the drop notice and the thinking indicator
are unchanged apart from copy. Empty state becomes "Ask your agents" with
one-tap agent chips that insert the handle.

**Composer**: a row of agent chips under the field for one-tap addressing; the
existing mention picker keeps its behaviour and gains the same visual treatment
as the rest of the surface; the helper line names who answers next ("Asking Ops
— ⌘↵ to send") using the sticky persona, not just a leading handle.

---

## 5. Naming

User-facing labels only:

| Where                                          | Was               | Becomes                 |
| ---------------------------------------------- | ----------------- | ----------------------- |
| `src/components/shell/sidebar-nav.tsx`         | Ask AI            | Agents                  |
| `src/components/command-palette.tsx`           | Ask AI…           | Agents…                 |
| `src/components/ai/ask/MessageList.tsx` kicker | Ask AI            | Agents                  |
| `ThinkingIndicator` copy                       | Ask AI is working | (agent name) is working |
| Settings → Agents (`(app)/settings/agents`)    | Agents            | Agent setup             |

The route stays `/ask`. Settings is renamed so the sidebar's "Agents" is
unambiguously the chat page. Landing-page copy and the changelog are historical
record and are not rewritten.

---

## 6. Performance & data-fetching budget (working agreement #5)

- **First paint:** rail = 2 bounded indexed reads (chats, briefings); thread =
  messages (bounded, indexed) + run proposals only when `run_id` is set; page =
  the owner's agents (`ASK_AGENTS_LIMIT`, indexed).
- **Interactions with 0 new server round-trips:** rail search, Today/Earlier
  grouping, expanding Briefings, mention picker filtering, agent chips,
  composer state.
- **Interactions that change server data:** send (existing Server Action +
  stream), agent switch (`setConversationAgent`), rename/delete (existing).
  Each is a Server Action with targeted state updates — never a `<Link>` or
  `router` navigation, which would re-run every query on the page (gotcha-09).
- **Per-turn reads** (documents, memory) are bounded by `documentBudget` and
  happen server-side inside the model callback, exactly as a scheduled run does.
- Switching threads from the rail remains a legitimate RSC navigation to
  _different_ data.

## 7. Testing

- **Pure units:** `resolveAddressedAgent` (leading handle, unknown handle,
  sticky inheritance, disabled agent, foreign agent id from a client hint);
  rail partition + date grouping; chat-turn system composition (documents +
  memory + instructions order, nonce marker present when either block is
  non-empty).
- **Server actions / route:** `appendUserMessage` persists `agent_id` and
  updates the conversation persona; `/api/ask` composes the persona from the
  last user message and not from the request body; `setConversationAgent`
  refuses an agent the caller does not own.
- **Components:** rail renders both sections and filters on search; header
  switcher calls the action and reflects the chosen agent; `MessageList`
  attributes each answer.
- **RLS/integration:** existing `ai-conversations.rls.integration.test.ts`
  extended for the new column — a non-owner can neither read nor set
  `ai_messages.agent_id`.
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 8. Independent units (for the plan's execution DAG)

These have no shared state and can be built concurrently:

- **A — schema:** the migration (message column + two partial indexes) and
  regenerated types. Everything else consumes it, so it lands first.
- **B — routing core:** `persona-routing.ts`, conversation actions,
  `/api/ask` persona resolution, `setConversationAgent`. Depends on A.
- **C — agent knowledge in chat:** document/memory composition in the route.
  Depends on B only for knowing which agent answers; the composition itself is
  independent and testable against a fixed agent id.
- **D — rail:** split reads + rail UI (search, grouping, briefings section).
  Depends on A (indexes) only.
- **E — header / messages / composer UI:** consumes B's persona shape; the
  visual work is independent of C and D.
- **F — naming:** independent of everything; trivially parallel.

Critical path: A → B → (C, E). D and F run alongside from the start.
