# Personal Monos: one agent per person

**Date:** 2026-11-13
**Status:** Design approved in brainstorming; awaiting owner review of this document
**Replaces:** sub-projects 3 ("saved agents") and 4 ("retire list") of the programme in
`docs/superpowers/specs/2026-11-13-unified-assistant-runtime-design.md`. Sub-projects 0, 1+2 and 5
of that programme are unchanged.
**Prototypes:** Mono look and states, https://claude.ai/artifact/MuTXP9zQh82z7Du9jPgc3q. Right rail,
https://claude.ai/artifact/5k1uvBxFfapQqWHzCuwtMr.

## Why

The old agent system is large and unused. Evidence from the live database (DEV, which serves
production) on 2026-11-13:

- `user_agents`: 32 rows. 26 are seeded built-in orchestrators that have never run, 2 are
  integration-test leftovers, and 1 is real ("Aria", a morning brief).
- Aria has failed every scheduled run since 2026-09-15 with `Invalid Refresh Token: Refresh Token
Not Found` (60 errors). Nobody noticed.
- `board_agents` 0 rows, `user_agent_proposals` 0, `agent_memory` 0, delegation child runs 0,
  agent documents 2.
- External agents use the MCP server more than all built-in agent products together: Claude (3
  users), Hermes Agent (1), Cursor (1). Today they connect as the user, so their writes look like the
  person's own.

Owner direction from brainstorming: no agent builder and no agent types. Every person gets one
agent of their own, it looks and behaves like Mono from the landing page, and it can be put to work
on boards. The org-wide assistant that shipped in PR #149 stays exactly as it is.

## Decisions made in brainstorming

| Question                      | Decision                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent builder and agent types | Removed. One agent per person per org: their Mono.                                                                                                                                                                                                                                                                  |
| The org assistant             | Unchanged. It lives in the right rail, is named by the org (the existing `assistantName` setting), everyone can chat with it, and it cannot be assigned work.                                                                                                                                                       |
| Right rail                    | Three tabs: Intelligence (unchanged), the org assistant (unchanged), and My Mono (new).                                                                                                                                                                                                                             |
| What a Mono does              | Doer and coordinator. Sole owner of an item: plans, does the work, moves it to Review. Co-assigned with people: plans the steps, does its share, writes summaries, chases due dates.                                                                                                                                |
| Who can direct a Mono         | Its owner only. Only the owner can chat with it, assign it, or @mention it. Teammates see its updates on items it works on. Monos never talk to, mention, or hand work to each other. A Mono ignores comments from anyone except its owner.                                                                         |
| What powers a Mono            | The owner must give it a brain. Either an API key (Anthropic or OpenAI), in which case it runs on Monolith's assistant runtime and works unattended, or a Claude or ChatGPT subscription connected over MCP, in which case it acts when the owner's client runs. With neither, it is asleep and cannot be assigned. |
| What it can do without asking | Additive, easily undone writes on items it is assigned: post updates and comments, create subitems, attach files, change status to any non-final value. Everything else goes to its owner as an approval card: other people's items, reassigning, deleting, marking Done.                                           |
| What wakes it                 | Being assigned, an @mention or reply from its owner on an item it is on, and (key-powered only) one daily check of its open items.                                                                                                                                                                                  |
| Look                          | Mono's pebble body for every agent. The owner picks a name and a light colour (seven presets or any colour). Mono's existing moods are the work states. People keep round avatars.                                                                                                                                  |
| Order                         | Disable Aria and stop orchestrator seeding now. Then retire the old system and build Monos in parallel.                                                                                                                                                                                                             |

## Not in this spec

- Changes to the org assistant, its dock behaviour, or the Intelligence tab.
- Agent-to-agent work of any kind.
- Monos acting for anyone other than their owner, or teammates requesting a Mono.
- A platform-paid model for Monos. Managed mode (sub-project 5) may later become a third brain
  option; it is not designed here.
- Marking non-Mono assistant writes as "via assistant". Still a separate follow-up.

## Design

### 1. Identity

- **One Mono per person per org.** It is a real `auth.users` row with no password and no session,
  plus a `profiles` row with `is_agent = true`, created idempotently by a SECURITY DEFINER function
  when the person first opens the My Mono tab. Seeding does not happen at signup, so the 26
  never-used orchestrators are not repeated.
- **New table `monos`**:
  `user_id` (the agent's user id, primary key), `org_id`, `owner_id`, `name`, `color` (hex),
  `brain` (`none` | `key` | `connected`), `oauth_client_id` (nullable, set when connected),
  `last_seen_at`, `created_at`, `updated_at`. Unique on `(org_id, owner_id)`.
- **RLS.** The owner can read their whole row and update `name` and `color`. RLS cannot hide single
  columns, so org members read other Monos through a security-invoker view `org_monos`
  (`user_id`, `name`, `color`, `owner_id`) and have no select grant on `brain` or
  `oauth_client_id` in `monos` itself. Inserts and deletes go only through definer functions.
- **Org membership.** The Mono is an org member with a dedicated role value `agent`, so existing
  `is_member_of` checks keep working for reads while admin-only paths stay closed to it.
- **Board membership.** The Mono is added to a board only by its owner, and only to boards the
  owner can access. A trigger on the owner's board access removes the Mono from any board the owner
  loses. Leaving the org or deleting the account removes the Mono.

### 2. Brain

- **`key`.** The owner has an Anthropic or OpenAI credential in `user_ai_credentials` (existing).
  Unattended runs use `runAssistant` (from sub-project 1+2) in `unattended` mode, with the owner's
  credential, metered into `ai_usage` against the owner.
- **`connected`.** The owner authorised an MCP client with "Drive my Mono" on the consent screen
  (new choice beside "Connect as me"). That client's token is bound to the Mono identity. Monolith
  does not run a model for it; it calls MCP tools when the owner's client runs.
- **`none`.** The Mono is asleep. It renders in the `dozing` mood, does not appear in assign or
  mention pickers, and the My Mono tab shows a "Wake up" card with two actions: add an API key, or
  connect Claude or ChatGPT.
- If a key-powered run fails for a credential or allowance reason, `brain` stays as is, the run is
  recorded as failed, the Mono switches to the `needsyou` mood, and the owner gets one notification
  per day at most. Silent failure (the Aria problem) must not be possible.

### 3. Acting as the Mono

- Every Mono action, whichever brain, runs under the Mono's own identity so RLS judges it by its own
  board memberships and activity shows the Mono as the author.
- **Key brain.** The job runner obtains a short-lived access token for the Mono's user id,
  server-side. No refresh tokens are stored. How to mint that token with this project's Supabase
  JWT signing setup is the first spike in the plan; if minting is not possible, the fallback is a
  service-role client paired with explicit board-membership checks in a definer applier, and the
  plan must say which was chosen.
- **Connected brain.** The MCP route resolves a Mono-bound OAuth token to the Mono identity and
  builds the Supabase client the same way.

### 4. Owner-only direction

- **Assign.** People pickers list the viewer's own Mono only (when awake). Other people's Monos are
  never listed. A trigger on People-column writes rejects any write that adds a Mono whose
  `owner_id` is not the writer.
- **Mention.** The mention picker lists only the viewer's own Mono. Mention dispatch ignores a
  mention of a Mono by anyone other than its owner.
- **Chat.** The My Mono tab's thread is readable and writable only by the owner.
- **Agent to agent.** A Mono's own comments never wake another Mono, and a Mono cannot assign or
  mention a Mono. Enforced in the same trigger and dispatch checks, not only in prompts.

### 5. Inbox and wake-ups

- **New table `mono_inbox`**: `id`, `mono_id`, `org_id`, `item_id`, `board_id`, `kind`
  (`assigned` | `mention` | `reply` | `approval_resolved` | `daily`), `actor_id`, `created_at`,
  `handled_at`. Index on `(mono_id, handled_at, created_at)`.
- Rows are written by triggers: assignment of the Mono in a People column, an owner @mention, an
  owner reply on an item the Mono is on, and resolution of one of its approval cards. A daily cron
  adds one `daily` row per open assigned item for key-powered Monos, deduplicated by a unique key
  on `(mono_id, item_id, kind, day)`.
- **Key brain.** An inbox insert queues a job through the existing pg_net + HMAC-signed route
  pattern (`/api/ai/mono-job`). The route runs one `runAssistant` turn with item focus and marks the
  row handled.
- **Connected brain.** MCP tools `get_my_assignments` (open items with overdue and stuck flags, the
  board playbook if present, and unhandled inbox rows) and `ack_inbox`. Monolith does not push to
  these clients.
- **Run records.** New table `mono_runs` (job id, mono, inbox row, status, tokens, error, steps,
  timestamps) replaces `user_agent_runs` and `user_agent_fires`.

### 6. What a Mono may do

- The catalog gets one more classification on top of read and write: `auto`. A write is `auto` only
  when all of these hold:
  - the tool is one of: post an update or comment, create a subitem, attach a file, set status;
  - the target item is assigned to the Mono (or is a subitem of one that is);
  - for status, the new value is not the board's final (Done) value.
- **`auto` writes apply directly** under the Mono identity.
- **Any other write is staged** into a new `mono_approvals` row
  (`id`, `mono_id`, `owner_id`, `item_id`, `batch` jsonb, `status`, `resolved_at`, `outcomes` jsonb)
  and the tool returns `{ staged: true, approval_id }`. The owner sees it in the My Mono tab and gets
  a notification. Approving reuses the confirm card and `applyBatch` logic from sub-project 1+2,
  applied under the Mono identity. The outcome is written to the Mono's inbox.
- **Conformance test.** One test walks the catalog and fails if any write tool, called with a Mono
  identity, can apply outside the `auto` rules without a staged approval.

### 7. Behaviour

- **Key brain.** The unattended turn's system prompt tells the Mono: on assignment, post a short
  plan as an update, then work; as sole owner, finish at Review and stage Done for approval; when
  co-assigned with people, name who does what, take its own steps, and summarise; on the daily
  check, post at most one nudge per item, @mentioning the human owner, only when the item is
  overdue, stuck, or quiet for 3 days.
- **Connected brain.** The same guidance ships in the MCP server instructions and in the
  `get_my_assignments` response.
- **Board playbook.** New nullable column `boards.assistant_playbook` (max 2,000 characters), edited
  by board admins in board settings, injected into item and board focus for both the org assistant
  and Monos.

### 8. Look

- One shared renderer ported from `src/components/landing/assembly-mono/avatar.js`, with the light
  colour as a parameter (belt, glow pool, side shade and eye bloom derive from it). Shell, face and
  eyes stay Mono's.
- **Moods as states:** `hello` (joined a board), `listening` (just assigned), `thinking` (working),
  `needsyou` (approval waiting or brain failing), `done` (moved to Review), `dozing` (asleep or
  connected client not seen today), `idle`.
- **Performance.** One shared animation clock per page. Small avatars (pickers, table cells, under
  40px) render a static frame and animate only for `thinking` and `needsyou`. Respect
  `prefers-reduced-motion`. Off-screen canvases do not draw.
- **Labelling.** An "Agent" chip and "Danijel's Mono" wherever a Mono appears; the Mono's colour
  tints its name and chips. Copy never says "Pulse".

### 9. Right rail

- Tabs: Intelligence, the org assistant (its configured name), and My Mono (the Mono's face at tab
  size plus an amber dot when an approval waits).
- **My Mono tab:** the Mono and its mood; its brain status in plain words ("Runs on your Anthropic
  key, works on its own" / "Connected to your Claude subscription, works when you ask in Claude" /
  "Asleep"); pending approvals; items it is working on; its inbox; the owner-only chat thread;
  "Only you can chat with, assign or @mention it".
- **Inbox (owner-visible).** The owner can see the Mono's inbox in the My Mono tab: the 20 newest
  `mono_inbox` rows, each showing what woke it (assigned, @mention, reply, approval resolved,
  daily check), who caused it, the item (linked), when, and its state ("Waiting" or "Done"). A
  handled row shows the outcome from its `mono_runs` record in one line ("Posted an update",
  "Asked for approval", or the error). Read-only in v1: no dismiss or re-run; the owner acts through
  chat or approvals. `mono_inbox` and `mono_runs` are SELECT-able only by the Mono's owner (RLS via
  `monos.owner_id = auth.uid()`); no client role can insert, update or delete them.
- **First open:** name and colour picker (as in the prototype), then the Wake up card if there is
  no brain.
- **Settings → My Mono** replaces `/settings/agents`: rename, recolour, brain (key or connected
  client, disconnect), boards it is on.

### 10. Retire

- **Now (small fix on `develop`):** disable Aria (`enabled = false`) and stop seeding built-in
  orchestrators for new memberships.
- **Removed code:** the `/settings/agents` page, `AgentEditor`, `TemplateGallery`,
  `CapabilityToggles`, `DocumentLibrary`, `DocumentPicker`, `MemoryPanel`, `ProposalCard`,
  `AgentRoster`, `AgentRunHistory`; in `src/lib/agents`: templates, capabilities and grants, org
  ceiling, delegation, orchestrator, memory, documents, proposals, briefing, the old run loop and
  claim; the Autopilot route and `board_agents` paths. `summariseProposal` moves into
  `src/lib/assistant` before its file is removed.
- **Dropped tables (last, after no code reads them):** `user_agents`, `user_agent_runs`,
  `user_agent_fires`, `user_agent_proposals`, `user_agent_documents`, `agent_documents`,
  `agent_memory`, `board_agents`, `board_agent_runs`, `board_agent_fires`, and their functions and
  cron jobs. The Autopilot bot user stays until its authored rows are checked.

## Performance and data-fetching budget

- **First paint.** The rail adds one small read: the viewer's own `monos` row, their pending
  approval count and the count of unhandled inbox rows (badge only). The inbox list itself loads
  when the owner expands it. Other Monos' name, colour and owner come with the existing member payload the
  board already loads.
- **No round-trip:** switching rail tabs, opening the picker, changing mood.
- **Round-trips:** sending a chat message (existing streaming route), approve/decline (Server
  Action, revalidation limited to the touched board via React Query invalidation as in sub-project
  1+2), renaming and recolouring (Server Action).
- **Bounded reads:** `get_my_assignments` is capped at 50 items over indexed columns; `mono_inbox`
  reads use the `(mono_id, handled_at, created_at)` index; the approvals list is capped at 20.

## Tests

- **Identity and RLS:** owner-only reads of `brain`; org members read name, colour and owner; a
  Mono cannot read a board it was not added to; removing the owner's board access removes the Mono.
- **Owner-only direction:** a teammate cannot assign or mention another person's Mono (trigger and
  dispatch), and a Mono cannot assign or wake another Mono.
- **Autonomy conformance:** the catalog walk described in section 6.
- **Inbox:** each trigger writes exactly one row; daily rows deduplicate; HMAC route rejects bad
  signatures.
- **Brain:** a failing credential turns into a `needsyou` mood and one notification, never silence.
- **Renderer:** colour derivation, reduced motion, small-size static frames.
- **Live run before merge:** one key-powered Mono and one Claude-connected Mono work a seeded board
  through assign, plan, work, approval and Review, driven in Chrome.
- **Gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Database behaviour checked in
  a rolled-back transaction on DEV.

## Independent units and order

| Unit | What                                                                         | Depends on |
| ---- | ---------------------------------------------------------------------------- | ---------- |
| Z    | Disable Aria, stop orchestrator seeding                                      | none       |
| X    | Retire old agent code (keep tables)                                          | none       |
| S    | Spike: short-lived token for a Mono identity                                 | none       |
| I    | `monos` table, identity function, RLS, org and board membership triggers     | S          |
| V    | Mono renderer with colour parameter, moods, performance rules                | none       |
| O    | Owner-only triggers and dispatch checks (assign, mention, agent-to-agent)    | I          |
| B    | Inbox, daily cron, `mono_runs`, key-brain job route                          | I          |
| A    | `auto` classification, `mono_approvals`, approve flow, conformance test      | I          |
| C    | MCP consent "Drive my Mono", Mono-bound tokens, `get_my_assignments`, `ack`  | I, A       |
| R    | Right-rail My Mono tab, first-open picker, Settings → My Mono, picker badges | V, I, A    |
| P    | Behaviour prompts and board playbook                                         | B, C       |
| D    | Drop old tables, functions, cron jobs                                        | X, R       |

Parallel batches: (Z, X, S, V), then I, then (O, B, A), then (C, R), then P, then D. The critical
path is S, I, A, C, P. Every batch leaves the app shippable: Monos are invisible until R lands.

## Still open

- The fallback in section 3 if a Mono token cannot be minted. Settled by spike S before unit I is
  planned in detail.
