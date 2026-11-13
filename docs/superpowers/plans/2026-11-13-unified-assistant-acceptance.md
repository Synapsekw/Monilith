# Unified assistant: acceptance run (Plan A)

Branch `task/assistant-runtime`. Run against `pnpm dev -p 3001` from the task
worktree with `.env.local` (the DEV database, which is live data). Use a board
created for this test and delete it afterwards.

Setup: sign in, create a board named "Assistant test" with a Status column, a
People column and a Date column. Add 6 items. Leave 2 with no owner, 1 with no
status, set 1 due date in the past. Open the board and open the dock's chat tab.

## 1. Catch me up

Type: `catch me up`
Expect: an answer that names the board, the overdue item, the 2 items with no
owner and the item with no status, by their real names. No card.
Fail if: it asks which board, or lists boards first.

## 2. Triage this board

Type: `give the two unowned items to me and set the item with no status to Working on it`
Expect: one card, "3 changes waiting", three ticked rows in plain words. Open
"Details" on a row: it shows the tool and the exact values that will be written.
The reply says the changes are lined up, not that they are done.
Untick one row, click "Apply 2 changes".
Expect: the card shows "Applied.", a new turn lists Done / Done / Skipped, and
the board behind the dock shows the two changes within a few seconds, no reload.
Reload the page: the card is still resolved.

## 3. Text to work

Type: `add these: draft launch email (due Friday), book venue, send invites to partners`
Expect: one card with three create rows. Apply all.
Expect: three new items on the board; the first has Friday's date.

## 4. Safety

Type: `archive this board`
Expect: a card whose row is unticked, marked as not undoable, with Details
already open. "Apply" is disabled until the row is ticked. Click Dismiss.
Expect: "Dismissed — nothing was changed." on the card and in the thread. The
board is still there.

## 5. Follow-up after applying

After check 2 or 3, ask: `what did you just change?`
Expect: a normal answer that reflects the applied changes. No provider error.
(This is the first turn whose history contains two assistant messages in a row.)

## 6. Any provider

In Settings → AI set the org default model to a non-Anthropic tool-capable
model for which a key exists. Repeat checks 1, 2 and 5.
Expect: the same behaviour. Before this change the request failed outright.

## 7. Old threads

Open a thread from before this change that has an unresolved single-action
proposal card. Expect: it still renders and still applies.

## 8. Active organisation

Signed in as a person who belongs to two organisations, in the second one,
ask on `/ask`: `list my boards`, then `what goals do we have?`
Expect: goals of the active organisation only.
Then ask it to create a goal. Expect: it declines and points to the Goals page; no card.

## 9. Step limit and empty answers

Ask something that needs many lookups across boards.
Expect: either an answer, or a visible line saying the step limit was reached
and to ask it to continue. Never an empty bubble.

## Known limitations at the time of this run

- The assistant refuses to create goals and portfolios, and refuses a dashboard
  create that names a workspace, until the database functions `create_goal` and
  `create_portfolio` (which ignore the requested organisation) are fixed.
- `list_boards` returns boards from every organisation the person belongs to.
- Cross-board semantic search, which the old chat had, is not offered.
- If recording the result fails after changes ran, the card locks for the
  session but reopens after a reload.

## Result

Not run yet.
