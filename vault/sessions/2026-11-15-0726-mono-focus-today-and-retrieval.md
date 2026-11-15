---
type: session
date: 2026-11-15-0726
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Mono focus today and retrieval foundation

## What changed

- Merged `task/mono-focus` into `develop` as `2fdb6419` (30 commits, 12 plan tasks, subagent-driven;
  spec `docs/superpowers/specs/2026-11-14-mono-focus-and-retrieval-design.md`, plan
  `docs/superpowers/plans/2026-11-14-mono-focus-and-retrieval.md`). Gates green at merge: 14,137 tests.
- Eleven migrations live on DEV (ledger check in sync: 202 committed files): per-board work settings (`boards.work_*`), the
  `item_facts` view (+ hardening, + stale-done-list fix), `match_items` org/board scope,
  `query_items` / `count_items` / `get_my_open_work`, and `get_focus_today` (three perf follow-ups;
  60 s+ down to 72–83 ms on the largest org by materialising one CTE).
- Assistant tools: `get_item_thread`, `query_items` (filters, counts, assignee by name),
  `get_focus_today`, org/folder-scoped `search_items`, dependencies on `get_item`; prompt lines route
  "my day", counts and "why" questions; a Mono thread is told its work tools describe the Mono.
- UI: a deterministic **Today** block on My Work (treatment A, ranked rail), an **Ask about my day**
  button (one-shot token, no re-send on Back), and a **Work tracking** dialog in the board menu.
- The live run in the owner's Chrome found two defects after every review and gate was green: the
  OpenAI model invented a `folderId` and the tool answered "Nothing urgent" over 205 overdue items;
  and the auto-sent answer never rendered (a `replaceState` plus `revalidatePath("/ask")` swapped
  the page under the streaming chat). Both fixed and re-confirmed live.
- Announced on `/updates` for 2026-11-15 (Today block, assistant questions, Work tracking).
- Follow-up the same day, merged as `4e1ab69a` (`task/work-guess-defaults`): better default guesses.
  The due column is picked by name (due/deadline/end/finish/target first, baseline names such as
  "Original due" after, start-like last, then position) and "Cancelled" counts as done, with
  negated labels ("Incomplete", "Not done") staying open. Rules live in `src/lib/boards/work-guess.ts`
  with a parity test against the SQL; migrations `20261115073021` and `20261115075029`. On live data
  12 boards moved from Start to Due/Finish, open overdue fell from 725 to 516, and 16 cancelled items
  became done. Announced on `/updates` by a trailer on the feature commit.

## Why

On large projects the assistant could not answer per-member questions ("what should I do today",
"what is Ana working on", "why is this still open") because it had no filtered read, no thread read
and no shared notion of done/due. This slice builds that read layer once (a view over live tables)
and puts the same ranking in both the assistant and My Work.

## How to test (for the user)

Setup: pull `develop`, `pnpm build && pnpm start -p 3001`, sign in at `http://localhost:3001`.

1. Open **My Work**. A **Today** block sits on top: up to 7 ranked rows with a tier word and a
   reason ("146 days overdue"), and a count line ("205 overdue").
2. Click **Show all**. The list grows to 20 with no page reload.
3. Click a row. The item opens.
4. Click **Ask about my day**. The chat opens, the question is sent once, and the answer streams in
   listing the same items in the same order. Press browser Back: nothing is sent again.
5. In `/ask`, try: "How many open items does each person have?", "What is <first name> working on
   that is due in the next two weeks?", "Why is <item name> still open?", "Find items about <topic>
   across all boards". Each should answer from data, not ask for ids.
6. Open a board that has both "Start" and "Due" columns, **⋯ → Work tracking**: it should read
   "Due date column: Automatic (Due)" and list Cancelled under "Currently treated as done". Then: Pick the status column, the options that mean done, and the
   due-date column; Save. Today and the assistant now follow that board's settings.

## Open threads

- Not browser-checked: a Personal Mono thread asking about "my day", dark theme, phone width, a
  second-org board through the external MCP connector.
- `scripts/sql/verify-item-facts.sql` (stale-done-list case) never ran: the approval prompt expired.
  The view change returned identical rows to the old view over 2,500 items before it was applied.
- `scripts/sql/verify-item-facts.sql` also covers the new guess rules and is still unrun (approval
  prompt expired twice). The board overdue chip, health flags, goals and dashboards keep the old
  done rule, so cancelled items still read as open there.
- 10 of 13 members in the largest org have no profile name and appear as "Unnamed member".
- Unconfirmed why the OpenAI model treated optional tool fields as required; `tool({ strict: false })`
  in `buildAssistantTools` is the untested switch. The assistant lists all 20 items, not the top 5–7.
- Pre-existing, outside this work: trigger `gate_notification_by_pref` drops a notification when any
  in-app preference row exists, ignoring `enabled`. Not verified.
- `get_focus_today` runs at 72–83 ms against a 50 ms budget; the floor is `item_facts` (~55 ms).
  Old `get_my_work_items` is left in place until after the next promotion.
- Six `_draft-2026-11-1*.md` files were left in place: they could not be attributed to this session.

## Next session entry point

Run `scripts/sql/verify-item-facts.sql` with the owner present to approve it, do the owed browser
checks (Mono thread, dark theme, phone width), then promote `develop`.
