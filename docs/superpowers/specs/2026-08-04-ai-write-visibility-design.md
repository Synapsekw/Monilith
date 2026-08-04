# Making an Approved AI Write Visible Without a Reload

**Date:** 2026-08-04
**Status:** Written 2026-08-04 — awaiting review
**Author:** Dani (with Claude)
**Resolves:** open thread #1 of `vault/sessions/2026-08-04-1443-board-dock-and-ai-move-verb.md`
("An approved AI write is invisible until you reload")
**Related:** `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`,
`vault/decisions/2026-06-17-gotcha-13-realtime-only-insert-needs-optimistic-echo.md`,
`vault/decisions/2026-08-04-decision-33-a-board-dock-reverses-ask-as-a-standalone-surface.md`

## Summary

When a user approves an AI-proposed board write, the write lands in the database and the thread says
"Done" — but the board behind the dock does not move. The user must reload to see their own approved
change. This is systemic across all four write verbs (`create_item`, `set_item_fields`,
`create_group`, `move_item`), and it undercuts every write verb the assistant has: an assistant whose
work you cannot see is an assistant you cannot trust.

The fix is **not** to revalidate a path and **not** to re-enable `router.refresh()`. Both are already
ruled out by decisions this repo has made and paid for. Instead, the shared execute seam returns the
**authoritative rows it just wrote**, and one client hook folds them into the board's existing
`["board", boardId]` React Query cache using the id-idempotent mutators that drag-and-drop already
uses. Cost: **zero new server round-trips** — the rows ride back on the approve response the client
was already awaiting.

This is not a new pattern. It is the pattern `vault/decisions/2026-06-17-gotcha-13-realtime-only-insert-needs-optimistic-echo.md`
prescribed a year ago and that `addItem` / `addColumn` already follow. The AI write path is the one
caller that never adopted it.

## The problem, precisely

Three facts combine into the bug.

**1. The board client never refetches the RSC.** `useBoardCache` (`src/lib/boards/use-board-cache.ts`)
hydrates once from the server payload via `initialData` with `staleTime: Infinity` / `gcTime: Infinity`.
Thereafter the mounted board reads only from the `["board", boardId]` React Query cache. Its `queryFn`
exists solely so an explicit `invalidateQueries` can resync after a dropped Realtime socket.

**2. `revalidatePath` on a board route was deliberately removed.** `src/lib/boards/actions/group.ts:19-29`
carries the rule in full: revalidating `/boards/<id>` after a within-board mutation invalidates a
payload the mounted client discards — "dead weight (9 queries, up to ~25k rows) on the hot path
(every cell edit, rename, drag)". It was dropped from all within-board hot-path mutations. That is
why no action in `src/lib/boards/actions/item.ts` calls it. **This is not an oversight to correct.**

**3. The dock suppresses `router.refresh()` on purpose.** `BoardDock`'s header comment names
gotcha-09: a router navigation re-runs the board page top to bottom — `getBoardPayload` (6 reads)
plus the `board_members` and `user_agents` reads and `listOrgMembersCached` — and remounts the view
tree, costing the Realtime resubscribe, dnd-kit re-init, and the user's scroll and edit state.

So the board's only live-update channels are (a) optimistic cache patches from
`useBoardMutations`, and (b) the Supabase Realtime echo. The AI write path uses neither. It writes
through the Server Actions and then tells the client nothing the client can render.

### A note on Realtime

`items`, `groups`, `cell_values`, `columns` and `boards` are all in the `supabase_realtime`
publication (verified against the DEV project, which is the database the live deployment runs —
see `vault/decisions/2026-08-02-decision-32-production-runs-the-dev-database.md`). In principle
the echo should already reach the acting client, and it is worth a diagnostic pass to learn why it
does not.

**But that question must not decide this design, and gotcha-13 already says why:**

> Treat the echo as **reconciliation for peers**, never as the local actor's source of truth. The
> acting client already has the authoritative result from the Server Action; render it immediately,
> idempotently.

Supabase Realtime is best-effort: an event can land before the channel settles, the socket can drop,
and only `pnpm e2e` — the one layer running a real channel — can observe any of it. A design that
renders from the Server Action's own result is correct whether or not the echo arrives, and the echo
de-dupes against it harmlessly. So the Realtime investigation is scheduled as a **non-blocking
diagnostic**, not as a prerequisite.

## Decision

**One shared "board effect" channel, returned by the single seam all four verbs already pass
through, folded into the board cache by one pure function and one hook.**

### Where the shared seam is

Both approve surfaces already converge on **one function**:

| Surface                    | Server action                                             | Converges on    |
| -------------------------- | --------------------------------------------------------- | --------------- |
| Board dock + `/ask` thread | `applyAskProposal` (`src/lib/ai/ask/proposal-actions.ts`) | `executeAction` |
| ⌘K quick action            | `executeActions` (`src/lib/ai/write/actions.ts`)          | `executeAction` |

`executeAction` in `src/lib/ai/write/execute.ts` is the chokepoint. It already ends with
`const _exhaustive: never = action` — a fifth verb fails to **compile** rather than silently falling
through. Hanging the effect off this function's return type puts the same compiler guarantee behind
visibility: **a new verb cannot ship without deciding what the board should show.** That is the answer
to "per-verb or shared" — shared, with the type checker enforcing it, because a per-verb fix is
precisely how the next verb ships broken.

### The effect type

A discriminated union of the authoritative rows the write produced:

- `item_created` — the created `items` row, plus any `cell_values` rows its `fields` wrote
- `item_moved` — the moved `items` row, plus the ids of subitems dragged along
- `item_fields_set` — the written `cell_values` rows
- `group_created` — the created `groups` row

Each carries `boardId`. It lives in a **new plain module** `src/lib/ai/write/effects.ts` — not in
`execute.ts` (which is `import "server-only"`) and not in either `"use server"` module, because a
non-async export from a `"use server"` file passes typecheck, lint and test and fails only
`pnpm build`. Both server and client import from the plain module.

### It must NOT ride inside `ExecutionResult`

`ExecutionResult` is a Zod schema precisely because it is **persisted into `ai_messages.tool_trace`**
and read back from untyped jsonb. Putting rows in it would bloat every thread row and — worse — replay
**stale** rows into the board cache whenever an old thread is reopened. The effect is transient: it
exists only for the lifetime of the approve response. So `executeAction` returns
`{ result, effect }`, `ExecutionResult` is unchanged, and `tool_trace` is unchanged.

### Getting the rows back

Three actions must return what they wrote. This is additive (`ActionResult<T>` gaining a payload;
existing callers that read only `.ok` are unaffected) and costs **no extra round-trip** — PostgREST
returns the row in the same request:

| Action                          | Today                             | Change                                                |
| ------------------------------- | --------------------------------- | ----------------------------------------------------- |
| `createItem`, `createGroup`     | already return the full row       | none                                                  |
| `moveItem`                      | `.select("id")` for the RLS guard | widen to `.select("*")`, return the row + subitem ids |
| `upsertCellCore` / `upsertCell` | upsert with no `.select()`        | `.select("*").single()`, return the cell              |

`upsertCellCore` is shared with the MCP tool layer (gotcha-60) — widening its success payload is
backward-compatible, and the MCP caller keeps working untouched.

This also brings `moveItem` and `upsertCell` into line with `createItem` / `addSubitem` /
`createColumn`, which already return their row for exactly this reason. It is the gotcha-13 pattern
finishing its rollout, not an AI-specific special case.

### Applying it on the client

- **`src/lib/boards/ai-effects.ts`** — `applyBoardEffect(cache, effect): BoardCache`. Pure, no React,
  no query client; composed entirely from the mutators already in `src/lib/boards/cache.ts`:
  `insertItem`, `replaceItem`, `moveItemToGroup`, `insertGroup`, `upsertCellValue`. Every one of them
  is already id-idempotent, which is what makes a later Realtime echo a no-op. Pure means exhaustively
  unit-testable, exactly like `foldBoardEvents` in `realtime-buffer.ts`.
- **`src/lib/boards/use-ai-effects.ts`** — a hook returning `(effects) => void`, which calls
  `patchBoardCache(qc, effect.boardId, c => applyBoardEffect(c, effect))`.

**The property that makes one hook serve every surface:** `patchBoardCache` is already written as
`prev ? patch(prev) : prev`. When no board cache exists — on `/ask` as a full page, or when the AI
wrote to a _different_ board than the one on screen — the call is a silent no-op. No conditional
wiring, no prop-drilling of "is a board mounted", no per-surface branching. `QueryClientProvider`
sits at the app root (`src/components/providers.tsx`), and the board page renders `BoardViews` and
`BoardDock` as siblings beneath it, so the dock reaches the board's cache with no new plumbing.

The two call sites are `AskChat.resolve()` and `QuickAction.approve()` — each gains one line inside
the success branch it already has.

### Security

The effect rows are produced **server-side by the write itself**, under the user's own RLS-scoped
client. Nothing client-supplied is trusted, and the client only folds rows into a cache scoped to a
board it already holds. `applyAskProposal`'s existing model is untouched: the client still sends two
ids and never the actions.

## Alternatives considered

**A. `revalidatePath('/boards/<id>')` in the item actions.** Rejected — and worth stating plainly:
**it would not even work.** The mounted board never refetches the RSC, so the revalidated payload is
discarded. It would reintroduce the exact 9-query / ~25k-row cost that `group.ts:19-29` documents
removing, and still leave the screen stale. This is the trap the naive fix falls into.

**B. Re-enable `router.refresh()` after an approve.** Works visually, and is the one option that
trades a real problem for the problem the codebase already decided against. Re-runs every query in
the board page, remounts the view tree, drops scroll/edit state and resubscribes Realtime — gotcha-09
by name. Rejected.

**C. `invalidateQueries(['board', boardId])` after an approve.** No RSC navigation, but one full
`fetchBoardPayload` round-trip per approve for data the server just wrote and already holds in hand.
**Kept as the sanctioned escape hatch**, not the default: the codebase already uses exactly this for
cascade mutations whose inverse is too intertwined to patch by hand (`resyncOnError` in
`src/lib/boards/mutations/shared.ts`). A future verb with a genuinely tangled effect should reach for
it deliberately, and the effect union's shape makes that a visible, per-verb choice.

**D. Rely on the Realtime echo alone.** This is today's behaviour and a gotcha-13 violation by name.
Rejected as the primary path; retained as peer reconciliation.

## Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.**

- _First paint:_ unchanged. The board RSC issues its existing reads; `BoardCache` is seeded via
  `initialData`; the dock renders collapsed with **zero** requests.
- _On approve:_ **exactly one server round-trip — the one already being made.** `applyAskProposal` /
  `executeActions` is a Server Action the client already awaits; the effect rides back on that same
  response. **Net new round-trips: 0.**
- _Rendering the change:_ a `setQueryData` on `["board", boardId]` — one client re-render of the
  subscribed views. No navigation, no `router.refresh`, no `revalidatePath`, no `invalidateQueries`.

**An approve does not re-run a single query in the board page.** This holds by construction, not by
care: there is no code path from the approve to the RSC.

**(b) Does the interaction change server data?** **Yes** — so per #5 the answer is "Server Action +
targeted revalidation", and it must be said explicitly what "targeted revalidation" means _on this
surface_: a **client-cache patch**, not `revalidatePath`. A literal reading of #5 points at
`revalidatePath`, but #5's own rationale (gotcha-09) and the standing rule in `group.ts` both forbid
it here, because the board's server payload is not what the mounted client reads. This spec is the
place that reconciliation is written down.

**(c) Bounded hot-path reads.** The change adds **no new query**. The widened `.select("*")` calls
return **at most one row per write**, in the request that was already being made, over primary-key
lookups. `moveItem`'s subitem ids come from a read it already performs. Both approve entry points are
already capped at **≤10 actions**, so the effect array is bounded at ≤10 and cannot grow with board
size. Nothing here scans a growing table, and no `select *` becomes unbounded.

## Testing strategy

- **Unit (pure, exhaustive):** `applyBoardEffect` over every effect kind — including the idempotency
  cases that matter: applying the same effect twice, and applying an effect for an item already in
  the cache. This is where the Realtime-echo interaction is actually proven.
- **Unit (server):** `execute.test.ts` gains, per verb, an assertion that the returned effect carries
  the row the underlying action wrote. The `never` exhaustiveness check is the compile-time half.
- **Unit (client):** the hook no-ops when no board cache exists, and patches the right board when one
  does.
- **e2e:** the gate that unit tests structurally cannot be. Gotcha-13's closing consequence is
  explicit — "`pnpm e2e` is the gate that catches Realtime-render gaps; unit/typecheck/lint/build
  cannot." Approve a move in the dock and assert the row appears in the target group **without a
  reload**.

## Independent units (working agreement #6)

Named here so the plan can schedule them concurrently; the plan carries the full DAG.

1. The `BoardEffect` type + schema module — the root everything else consumes.
2. Row-returning widening of `moveItem` and `upsertCellCore`/`upsertCell` — touches only
   `src/lib/boards/actions/`, independent of unit 1.
3. The pure `applyBoardEffect` fold — depends on 1 only, not on any server work.
4. `executeAction` returning effects — depends on 1 and 2.
5. The client hook — depends on 3.
6. Server-action plumbing on both approve surfaces — depends on 4.
7. Client wiring at both approve call sites — depends on 5 and 6.
8. e2e proof — depends on 7.

## Concurrency note: the sibling `task/ai-item-ids` branch

A sibling task on branch `task/ai-item-ids` is concurrently adding item ids to `query_items` in
`src/lib/ai/ask/tools.ts` (closing the second open thread from the same session note —
`semantic_search_items` being the sole source of item ids for the write path).

**This design has no dependency on it and must not edit that file.** The two branches are disjoint:
that one changes what the AI can _read_ on the propose side; this one changes what the client renders
after a write has already been _approved_. The ids in a `BoardEffect` come from the write's own result
rows, never from a tool read. There is no expected merge conflict — the file sets do not intersect.
Either branch may merge first.

## Out of scope

- **Realtime root-cause fix.** The diagnostic pass is scheduled; any fix it implies is a separate
  task. This design is correct with or without it.
- **Reusing the returned `moveItem` row to correct drag-and-drop's optimistic position.**
  `moveItemToGroup` currently guesses `maxPos + 1` and lets the echo reconcile. Once `moveItem`
  returns the row, `moveItemToGroupMutation` could patch-on-success with the server's real position —
  a genuine correctness win, and deliberately deferred so this change stays reviewable.
- **`clearCell`, `deleteItem`, `archiveItem` and the bulk actions.** No AI verb reaches them today.
  When one does, the `never` check in `executeAction` will stop it at compile time — which is the
  point.

## Open questions

None blocking. The Realtime diagnostic may produce a follow-up ADR; it does not gate this work.
