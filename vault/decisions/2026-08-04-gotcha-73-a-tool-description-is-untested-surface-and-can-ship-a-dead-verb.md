---
type: decision
date: 2026-08-04
tags: [decision, gotcha, ai, testing]
related:
  - "[[2026-08-04-1443-board-dock-and-ai-move-verb]]"
---

# Gotcha 73 — a tool description is untested surface, and can ship a verb that cannot be called

## What happened

`propose_move_item` — a new AI write verb letting the assistant move an item to another group —
was built across three tasks, each individually reviewed and approved, with all four gates green
(typecheck, lint, 4205 unit tests, build).

It could never have been invoked once.

Its tool description told the model:

> "Resolve item_id and group_id via `get_board_overview` before calling."

`get_board_overview` returns `buildBoardSnapshot(...)`, whose shape is
`{ board, rowCount, columns, columnStats, meta }`. **No groups. Anywhere.** And no other read tool
in the loop emitted a group id either — `query_items` returns a group's *name*, not its id.

So every real attempt would either never propose, or propose a hallucinated uuid and get back
_"That group isn't on this board. Moving an item between boards isn't supported."_ — a refusal
that misdescribes the actual problem and sends the user chasing a boundary that was never the
issue.

The pre-existing `propose_create_item` carried the same false claim, and the `/api/ask` system
prompt still does.

## Why no test could catch it

Every layer was correct in isolation, and every layer was tested:

- the resolver refuses correctly, with pinned strings;
- the tool records the proposal and never writes, traced call-graph deep;
- the executor delegates to the canonical action and surfaces its error verbatim.

The defect lived **between the code and the English sentence that tells a model how to reach it**.
Unit tests call the executor with ids already in hand. Nothing in the suite ever asks the question
a model has to ask: *where do I get a group id?*

A tool description is a load-bearing interface with no type checker and no test harness pointed at
it. It is the one part of an AI feature that only fails in production.

## The rule

**A plan that adds a verb requiring ids must VERIFY a read tool emits those ids — not assert it.**
The assertion ships verbatim into the model's prompt, where it becomes an instruction the model
cannot disobey and cannot satisfy.

Concretely, when specifying an AI tool:

1. For each required argument, name the tool that produces it and **read that tool's return shape**.
2. If nothing produces it, the read-tool change is part of the feature — not a follow-up.
3. Re-read sibling tool descriptions while you are there; a false claim propagates by copy-paste
   (this one had already spread to `propose_create_item`).

## What it cost / what closed it

Caught by the whole-branch review, which stepped outside the four `src/lib/ai/write/` files the
plan had treated as a closed system. Fixed by adding `groups: {id,name}[]` to `BoardSnapshot`
(zero new queries — `payload.groups` was already fetched in `getBoardPayload`'s existing
`Promise.all`) and correcting all three descriptions.

**Residual, still open:** `semantic_search_items` is now the *sole* source of item ids. It is
entitlement-gated on `semantic_query` and returns `[]` on any error, so it depends on the embedding
sweep having indexed the item. That is a single point of failure for any verb needing an
`item_id` — including the long-shipped `propose_set_item_fields`. Adding ids to `query_items`
would close it.

## Related

The same shape as [[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]]
and the decorative lint guards before it: **a green suite is evidence about the code, not about the
thing the code is supposed to reach.** The durable defence is the same — prove the mechanism works
end to end, from the position of whoever actually has to use it.
