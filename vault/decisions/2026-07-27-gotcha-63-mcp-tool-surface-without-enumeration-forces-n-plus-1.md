---
type: adr
status: accepted
date: 2026-07-27
tags: [project/monolith, adr, gotcha, mcp, performance, api-design]
related:
  - "[[2026-07-27-1734-group-1-closeout-monolith-rename-promote]]"
  - "[[2026-07-24-1950-mcp-server-oauth]]"
  - "[[2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp]]"
---

# Gotcha 63 — A tool surface with no enumeration turns one question into N network round trips

## Context

The first real end-to-end use of the production MCP server was Claude Desktop being asked
_"what's on the QCC board"_. It ran for **five minutes**.

The instinct is to look at the database. That instinct is wrong here: QCC is **163 items, 562 cell
values, 5 columns, 2 groups**. The entire board is one small query.

The cause was the **shape of the tool surface**, not the data. Six tools shipped
(`list_boards`, `get_board`, `search_items`, `get_item`, `create_item`, `update_item`), and none of
them could enumerate a board:

- `get_board` returned metadata, columns and groups — **no items at all**.
- `search_items` required a non-empty query (`z.string().trim().min(1)`), matched `ilike %q%`, capped
  at 50, returned only `id, name, group_id` — **no cell values**, and **no signal it had truncated**.
- `get_item` returned cell values for exactly **one** item.

So the only path to the answer was: guess substrings, receive at most 50 of 163 names that looked
like a complete result, then call `get_item` once per item — up to **~164 sequential HTTPS round
trips**. Each one charges the per-token rate limit (`MCP_LIMIT = 120` per 60s) and rotates the OAuth
bridge secret, which is a DB write. The client hit the ceiling and began backing off.

Two failure modes, not one. The latency was visible; the **silent truncation was worse** — a client
reading 50 items off a 163-item board had no way to know it was wrong, so the model could answer
confidently and incompletely.

## Decision

A remote tool surface must offer **bounded enumeration with explicit truncation** for every
collection it exposes. Concretely, shipped as `list_items`:

- returns items **with their cell values** in one call, with `columns`/`groups` riding along so the
  response is self-describing and needs no second `get_board`;
- `limit` (default 100, max 200) plus an opaque `cursor`;
- `hasMore` + `nextCursor`, implemented by over-fetching one row so a page that exactly fills the
  limit is never misreported as truncated;
- `search_items` changed from a bare array to `{ items, truncated, note? }`.

The cursor is a keyset over **`(position, id)`**, not `position` alone: `position` is
`double precision` and reorders produce ties, so a single-column cursor silently skips or repeats
rows at page boundaries. Both halves are interpolated into a PostgREST `or=` predicate, making
`decodeCursor` a trust boundary — only a finite number and a regex-validated uuid may reach the
filter string.

Result: 163 items in **2 calls** (1 with `limit: 200`), against the existing partial index
`items_board_position_live_idx (board_id, position) where archived_at is null`. No migration, no new
index.

## Consequences

- `search_items`' response shape changed; any client parsing the old bare array must adapt.
- MCP clients cache the tool list at connect time, so an existing connection must be removed and
  re-added before it can see a newly added tool.
- The per-call cost of this protocol (rate limit + bridge-secret rotation) means **round-trip count
  is the dominant performance variable**, far more than query cost.

## Lesson

When work reaches a model through a tool protocol, "the app is slow" is usually a **missing
affordance**, not a slow query. Count the round trips the tool surface forces before profiling
anything — and treat a cap without a truncation flag as a correctness bug, not a performance one.
