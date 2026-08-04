# Personal Agents Phase 2 — Board Thread Dock

**Date:** 2026-08-03
**Status:** Approved 2026-08-03 — plan to follow
**Author:** Dani (with Claude)
**Supersedes:** the Phase 2 sketch in `docs/superpowers/specs/2026-08-01-personal-agents-design.md`
**Resolves:** that spec's open question #1 (extend `ai_conversations` vs. a separate table)
**Related:** `vault/decisions/2026-07-12-decision-27-ask-becomes-standalone-surface.md`,
`vault/decisions/2026-07-20-decision-29-agentic-automation-guardrails.md`,
`vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`,
`vault/decisions/2026-07-05-gotcha-50-tolocaledatestring-undefined-locale-hydration-mismatch.md`

## Summary

Give every board a **right-hand dock** hosting agent conversations. The dock is collapsed by
default, narrows the board rather than overlaying it, and talks either to plain Ask or to one of
the person's own agents — whose `instructions` finally shape something visible outside the 07:00
email. A scheduled run posts its briefing into the dock as a thread you can reply into, so the
roster and the conversation stop being two disconnected halves of one feature.

The substrate is almost entirely shipped. `/api/ask` already streams with tool traces, drop
recovery and a persisted propose → confirm → execute loop; `ai_conversations` / `ai_messages`
already hold threads; `user_agents` already holds the roster and its instructions. **The work is
scoping an existing conversation to a board and giving it an optional persona**, not building a
chat platform.

## Scope

This spec covers **one** of the five subsystems the Phase 1 spec designated "Phase 2".

**In scope**

- The board dock: layout, collapse, resize, thread list, agent switcher.
- Board-scoped conversations, private by default and shareable to the board.
- Attribution of a reply to the agent that produced it.
- Scheduled briefings landing as repliable threads.

**Deferred, each to its own spec**

- **Agents as `@mentionable` participants in `item_updates`.** A different surface with a
  different authorship model; it is the slice that genuinely needs real principals.
- **Agent-initiated proposals during unattended runs.** Human-initiated proposals already work and
  are inherited here; autonomous ones are a separate risk surface.
- **Documents** — agent prose rendered by `renderHtmlToPdf` (`src/lib/reports/pdf.ts`) and
  attached to an item.
- **Full per-agent principals** — a seeded `auth.users` row per agent. See § Identity for why this
  slice does not need them.

Building all five together repeats the Phase 1 shape (12 tasks, 15 subagents), whose own retro
records that six defects originated in the plan rather than the implementations. Smaller specs are
the response to that.

## Decisions taken

| #   | Decision      | Choice                                                    | Rationale                                                                                      |
| --- | ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Scope         | **Dock + board threads**, minimal identity                | Carries the one high-risk change (RLS widening); deserves its own focused spec and review      |
| 2   | Visibility    | **Private by default, shareable to the board**            | Decision 8 of the Phase 1 spec, confirmed; keeps `/ask` habits transferable                    |
| 3   | Engine        | **One switcher; "Ask" is the no-persona entry**           | An optional persona argument, not a second prompt path with its own tests and drift            |
| 4   | Briefings     | **A run posts its briefing as a repliable thread**        | Connects the roster to the dock; makes the email a notification rather than the sole artifact  |
| 5   | Identity      | **Attribution column only — no new principals**           | Threads already imply an author via the owning row; principals belong to the item-thread slice |
| 6   | Storage       | **Extend `ai_conversations`** (resolves open question #1) | A second table duplicates persistence, streaming and proposal resolution, which then drift     |
| 7   | Shared writes | **Shared threads are readable, not co-writable**          | Multi-author threads are `item_updates`' problem, already solved there                         |

### Why extend rather than fork (Decision 6)

The alternative — `board_threads` + `board_thread_messages` — makes private `/ask` history
structurally unreachable, which is a real benefit. It was rejected because the cost is a second
messages table, a second streaming-persistence path, and a second copy of proposal-state
resolution and summarisation, all of which drift the first time one is fixed and the other is not.

The risk it avoids is instead bounded **by column defaults rather than by review diligence**: the
new policy requires `board_id is not null` and `visibility = 'board'`, and every row that exists
today has null and `'private'`. The widened policy is incapable of matching any pre-existing
conversation.

A third option — migrating `/ask` history out so `ai_conversations` becomes purely a board table —
was rejected as a data migration on live user history performed before any feature work, where a
mistake is irreversible.

## Data model

**One migration**, minted via `scripts/new-migration.sh board_threads` — never a hand-invented
version stamp (gotcha-55). Applied to DEV via the `supabase-dev` MCP with the **same version +
name** as the committed file, verified with `pnpm db:ledger-check`, then `pnpm db:types`
regenerated **in the main checkout** (running it in a worktree can empty `database.types.ts`).

Four columns on `public.ai_conversations` (created by `20260716173339_ai_conversations.sql`):

```sql
board_id    uuid references public.boards (id) on delete cascade,
agent_id    uuid references public.user_agents (id) on delete set null,
run_id      uuid references public.user_agent_runs (id) on delete set null,
visibility  text not null default 'private'
              check (visibility in ('private', 'board'))
```

Two indexes, both partial so the existing `/ask` rows stay out of them entirely:

```sql
create index ai_conversations_board_updated_idx
  on public.ai_conversations (board_id, updated_at desc)
  where board_id is not null;

create unique index ai_conversations_run_id_key
  on public.ai_conversations (run_id)
  where run_id is not null;
```

`run_id` is the **idempotency key for briefing threads**: one thread per run, enforced by the
database, so a retried sweep re-entering the same fire slot inserts nothing. This deliberately
mirrors the existing `(agent, date, hour)` fire ledger rather than introducing a second
idempotency scheme that can disagree with the first.

## Security

RLS is widened **additively and on SELECT only**. No existing policy is altered or dropped.

```sql
create policy "ai_conversations_select_board_shared" on public.ai_conversations
  for select using (
    board_id is not null
    and visibility = 'board'
    and public.can_read_board(board_id)
  );

create policy "ai_messages_select_board_shared" on public.ai_messages
  for select using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id
      and c.board_id is not null
      and c.visibility = 'board'
      and public.can_read_board(c.board_id)
  ));
```

Three properties make this safe by construction:

1. **Defaults bound the blast radius.** `visibility` defaults `'private'` and `board_id` defaults
   null, so every row that exists at migration time fails both conjuncts. The new policy cannot
   match any pre-existing `/ask` conversation regardless of how the rest of the feature behaves.
2. **`can_read_board` already carries the full predicate** — active org membership _and_
   creator-or-member (`20260621000000_board_access_require_membership_and_returning.sql`). It is
   `security definer` reading only `boards` / `board_members`, so there is no recursion and no
   separate cross-tenant check to forget.
3. **INSERT / UPDATE / DELETE are untouched.** Only the owner adds turns; only the owner flips
   `visibility`, which the existing `ai_conversations_update_own` policy already permits. Sharing
   grants reading, never authorship.

**Consequence for `/ask`, accepted:** its rail filters on `user_id` only, so board threads you own
will now also appear there. That is deliberate — a thread is your conversation regardless of where
you started it, and filtering board threads out would make one vanish the moment you navigated
away from its board. `listConversations` is left unchanged and the behaviour is pinned by a test.

**Disclosure accepted and stated:** a shared thread exposes its agent's **name** to board members
who do not own that agent. Names are user-authored ("Morning Brief"), not secret, and
`instructions` never leaves the server. Recorded here so it is a decision rather than a review
finding.

**Prompt injection.** A persona is owner-authored text, injected as clearly delimited data and
never in the instruction position — the containment stance Phase 1 established. Board item text
remains untrusted, and writes remain gated by the confirm card, so a persona changes no boundary.

## Identity (Decision 5)

Dock threads live in `ai_conversations` / `ai_messages`, where the author is already implied by
the owning row. Attribution therefore needs **one nullable `agent_id` and a name lookup**, not a
seeded `auth.users` row per agent: a reply renders from `user_agents.name` joined with the owner's
profile — "Dani's Morning Brief".

`on delete set null` means deleting an agent degrades its threads to plain Ask rather than
orphaning them.

The shared platform bot (`pulse-autopilot@pulse.internal`, seeded by
`20260720120517_board_agents.sql`) is **not touched**. The invariant pinned by
`src/test/agent-identity.test.ts` — that the lookup email never changes — is unaffected by this
slice.

Real principals are built by the slice that needs them: agents authoring into `item_updates`,
where authorship is a column on a shared table and cannot be derived from ownership.

## The dock

### Placement

The board page (`src/app/(app)/boards/[boardId]/page.tsx`) becomes a flex row: `BoardViews` as
`flex-1 min-w-0`, the dock a fixed-width sibling. The board **narrows and is never overlaid**.
`ItemPanel` is unchanged — a shadcn `Sheet` that now slides over the dock; the plan verifies its
z-index sits above the dock rather than assuming it.

The `min-w-0` is load-bearing. Board tables carry a min-width wider than the narrowed column, and
without it the flex child refuses to shrink and pushes the **page** into horizontal scroll; the
board's own scroll container must absorb it. This is the same class of bug as the
`overflow: hidden` that silently defeated the landing nav's `position: sticky`.

Below the `md` breakpoint the dock is a full-height `Sheet` rather than a column.

### Structure

Three components, each with one job:

- **`BoardDock`** — the shell: open/collapsed, width, drag-to-resize. Client, holds no data.
- **`DockThreadList`** — two groups: **This board** (threads with this `board_id`, yours plus any
  shared) and **From your agents** (cross-board agent threads, capped at the 5 most recent; the
  full set stays reachable from `/ask`'s existing rail, which needs no change because these are
  owner-scoped rows like any other).
- **`DockThread`** — the conversation: `MessageList` and the composer **reused** from `/ask`, so
  proposal confirm cards, tool traces and drop recovery work on day one because they are the same
  components.

The **agent switcher** sits in the dock header. "Ask" is the first entry, with `agent_id = null`.
One control, one prompt path.

### UI conventions

Governed by `pulse-ui` and `frontend-design` (working agreement #3): Keystone tokens only, no raw
colours, hairlines brighten rather than thicken, `shadow-card` is `none`.

## Streaming and the route

**The request body is unchanged — still `{ conversationId }`.** The board and the agent are read
**off the conversation row**, not accepted from the client. Nothing forks: one `askPulseStream`
serves all combinations.

> **Refined during planning.** An earlier revision of this section had the route accept `boardId`
> and `agentId` as body fields and verify ownership per turn. Reading them off the row is strictly
> safer — the ownership check happens **once**, when the thread is created (`createConversation`
> resolves the agent through the owner-scoped `user_agents` RLS, so a foreign id reads back null
> and fails closed) — and it leaves no client-supplied id for the streaming path to validate at
> all.

- **The route rejects a turn on a conversation the caller does not own (403).** A shared board
  thread is readable by every member of that board, so "the row came back" no longer implies "it is
  mine". A turn appends to the thread and spends the **owner's** budget; without this gate, read
  access to a shared thread would be a licence to bill its owner.
- The agent's `instructions` are injected as delimited data in the system prompt, with a closing
  delimiter smuggled into the text stripped so the block cannot be closed early. The text is
  already length-capped at write time by Phase 1, and **never reaches the client**: the switcher
  sends an id and renders a name.
- An `agent_id` that reads back null — a deletion racing a turn — **degrades to plain Ask** rather
  than failing a turn whose history is still worth continuing.
- With `board_id` set, the board is seeded into context up front, so the model skips the
  `list_boards` → `get_board_overview` round-trip it otherwise needs to resolve "which board".
  This is the dock's substantive advantage over `/ask`.

**Metering.** Dock turns are interactive Ask usage against the org pool or the caller's BYO key —
**not** against `max_agent_runs_per_user_per_day`. That cap bounds _unattended_ spend; charging
conversation against it would let an afternoon of chat silently cancel tomorrow's briefing.

## Briefing threads

A briefing reads across every board its owner can see, so it is **cross-board by construction** and
cannot honestly be a board thread. It lands as an **agent thread**: `board_id` null, `agent_id`
set, `run_id` set, `visibility` `'private'`.

Write order inside a run: **thread (idempotent) → email → notification.** The thread is written
first so the email can deep-link to it. If the insert fails the run **continues** and the email
omits the link — a briefing that arrives without a link beats no briefing. Email-before-
notification is preserved from Phase 1, so a retry still cannot duplicate the notification.

The insert executes through the existing **owner client** (`src/lib/agents/owner-client.ts`), not
the service client. The agent remains a non-privileged principal whose reads and writes are both
bounded by its owner's RLS.

## Performance & data-fetching budget (working agreement #5)

**First paint: zero.** The dock renders collapsed and fetches nothing. The board page already runs
`getBoardPayload`, a `board_members` read and `listOrgMembersCached`; most loads will never open
the dock, and taxing all of them for a minority interaction is exactly what this agreement exists
to prevent.

**Opening the dock:** one Server Action, `listBoardThreads(boardId)`, bounded at 50 over the
partial `(board_id, updated_at desc)` index. This is a first fetch of data not yet loaded, not a
refetch. It **must not re-run the board query**, which rules out `<Link>` and `router.push`
(gotcha-09).

**Selecting a thread:** `getMessages`, already bounded at 200 (`MESSAGES_LIMIT`) over
`(conversation_id, created_at)`.

**Zero round-trips:** switching persona, collapsing, resizing, and the deep link `?thread=<id>`,
written with `window.history.replaceState` and read back through `useSearchParams()` **inside the
dock** — a client component, so no new server-level `searchParams` read is added to the page.

**Dock state** (open, width) persists in `localStorage`, keyed per board. It is read **after
mount, never during render**: seeding initial state from `localStorage` renders differently on the
server than the client and produces a hydration mismatch, the failure shape of gotcha-50. A
remembered-open dock therefore expands one frame late; that is the correct trade.

**Bounded reads throughout.** No `select *` on a growing table; every read is capped over an
indexed column.

## Testing (working agreement #4 — written and executed)

**RLS integration** — extend `src/lib/ai/ask/ai-conversations.rls.integration.test.ts`
bidirectionally, proving both what the new policy allows and what it still forbids:

1. A private conversation remains owner-only **after** the migration. This is the regression test
   for the entire slice.
2. A `visibility = 'board'` thread is readable by a board member.
3. A same-org **non-member of that board** cannot read it.
4. A cross-org user cannot read it.
5. A shared thread is **not writable** by a non-owner — insert, update and delete each denied.
6. Revoking board membership removes read access with no cleanup step.
7. `ai_messages` mirrors every case above.

**Unit** — persona injection keeps `instructions` in the data position (asserted against the built
prompt, not a comment) and survives a smuggled closing delimiter; a foreign `agentId` fails closed
at thread creation; a turn on someone else's thread is refused with 403; a dock turn meters as
`ask_pulse`, never against `max_agent_runs_per_user_per_day`; thread-list grouping and the
5-thread cap; dock state read after mount.

**Idempotency** — two runs of one fire slot produce exactly one conversation and one email.

**Component** — a collapsed dock issues zero fetches; the narrowed board does not push the page
into horizontal scroll (extends `src/app/scroll-containers.test.ts`).

**Gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green before merge.

## Execution DAG (working agreement #6)

| Unit  | Work                                                                                              | Consumes |
| ----- | ------------------------------------------------------------------------------------------------- | -------- |
| **A** | Migration: 4 columns, 2 partial indexes, 2 additive SELECT policies; regenerated types            | —        |
| **B** | Server layer: `listBoardThreads`, thread create, share/unshare Server Actions, `conversations.ts` | A        |
| **C** | `/api/ask`: `boardId` / `agentId`, ownership check, persona injection, board pre-seed             | A        |
| **D** | Dock UI: shell, resize, thread list, switcher, `DockThread` reusing `MessageList`                 | B        |
| **E** | Briefing → thread in `/api/ai/personal-agent`, email deep link                                    | A        |
| **F** | RLS integration suite                                                                             | A        |

**Dependency graph:** A → {B, C, E, F}; B → D.

| Batch | Units               | Notes                                    |
| ----- | ------------------- | ---------------------------------------- |
| 1     | **A**               | Wall-clock floor; everything waits on it |
| 2     | **B, C, E, F**      | Four concurrent agents                   |
| 3     | **D**               | Consumes B                               |
| 4     | Integration + gates | Single serialising step                  |

**Critical path:** A → B → D → gates.

**F is a numbered task with its own agent, not a bullet on a checklist.** In Phase 1 the
spec-mandated RLS suites were announced in the ledger and never dispatched, and eleven scoped
reviews could not see the gap because each saw only its own diff. This slice's entire risk is RLS;
that failure must not repeat.

Units that mutate files in parallel get isolated worktrees per working agreement #1.

## Risks

| Risk                                                      | Severity | Mitigation                                                                                                                         |
| --------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Widened policy exposes private `/ask` history             | **High** | Additive SELECT only; `visibility` defaults `'private'` and `board_id` null, so no existing row can match; bidirectional RLS suite |
| Prompt injection via a persona                            | Medium   | Owner-authored, delimited data position; writes still gated by the confirm card                                                    |
| Dock taxes every board load                               | Medium   | Collapsed by default, zero first-paint fetches; asserted by test                                                                   |
| Duplicate briefing threads on retry                       | Medium   | `run_id` unique index; thread write precedes email and never gates it                                                              |
| Board narrowing pushes the page into horizontal scroll    | Medium   | `min-w-0` on the board column; extends `scroll-containers.test.ts`                                                                 |
| Agent name disclosed to board members via a shared thread | Low      | Accepted and stated; names are user-authored, `instructions` never leave the server                                                |

## ADR owed

This slice **reverses decision-27** ("Ask becomes a standalone surface", on the stance that _AI
ships at the seams, not as chrome_). A permanent board dock is chrome. The reversal is defensible —
a board-scoped conversation is a seam that a standalone destination cannot occupy — but it must be
written as an explicit new ADR before merge, not left as silent drift.

## How to test (manual acceptance, post-merge)

1. Pull `develop`. Open any board. The dock is **collapsed** — confirm the board renders exactly as
   it does today.
2. Open the dock. A thread list appears; the board narrows rather than being covered, and the page
   does **not** scroll sideways.
3. Send a message with the switcher on **Ask**. Confirm it streams, and that the board did not
   reload — switching views still works without re-fetching.
4. Switch the header control to one of your agents and ask something. The reply is labelled with
   that agent's name.
5. Ask it to change something ("move X to next Friday"). Confirm you get a **confirm card**, that
   nothing changes until you accept, and that reloading the page leaves the card intact and still
   actionable.
6. Open an item while the dock is open. The item panel slides **over** the dock; closing it leaves
   the thread where it was.
7. Share a thread to the board. Sign in as another board member: they can **read** it and cannot
   post into it. Sign in as someone not on that board: they cannot see it at all.
8. Open `/ask`. Confirm your private conversations are unchanged and that no board thread from
   someone else appears there.
9. Collapse the dock, reload — it stays collapsed. Open it, reload — it reopens.
10. After a scheduled run fires, open the dock: the briefing appears under **From your agents**.
    Reply to it and confirm the follow-up continues in the same thread.
11. Re-fire the same slot. Confirm **no second thread and no second email**.
