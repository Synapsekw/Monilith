---
type: session
date: 2026-11-14-1459
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-13-decision-44-mono-identity-session]]"
---

# Mono live run, board guard, PR #151 promoted

## What changed

- `928532da` fix(mono): the My Mono thread header names the Mono and takes its tint (`ThreadHeader` `speaker` prop).
- `5c848155` spec: an owner-visible Mono Inbox in the My Mono tab (20 newest `mono_inbox` rows, read-only, owner-only RLS; first paint loads only the unhandled count).
- `4eed0826` (task/mono-board-guard) fix(mono): a Mono is refused a board create before staging (`MONO_NO_BOARDS_ERROR`, `actingAsMono` in `buildAssistantTools`). A board create without `workspaceId` is refused by `unsupportedReason`. `list_boards` and `get_board` now return `workspaceId`.
- Plan 2A live run in Chrome on DEV. Aria created an item and set its status, and activity recorded Aria as the actor. The test item was trashed and Aria removed from Personal Tasks afterwards.
- **PR #151 promoted** (101 commits: personal Monos, cross-board dependencies + folder Timeline, theme variety, edge pills, Leave board, board total tint, settings loading). The owner merged it as `e260a700`. Main CI green, Vercel production `success`. Heal `f3b1e864` pushed (it also pushed 2e's vault commit `5c620a38`).
- /updates: nothing new announced. Every ship date already has an entry.

## Why

Plan 2A needed a real run before release ([[ai-features-need-a-live-run-before-merge]]). The run found two defects that would have hit users on day one: a board create that failed at Apply, and a Mono offering to create boards.

## How to test (for the user)

1. On www.monolith.works, open a board, open the rail, then My Mono. The header shows your Mono's name with its colour dot.
2. Ask your Mono to "create a new board". It answers that it cannot, and no confirm card appears.
3. In the Ask tab (the org assistant), ask it to create a board. The confirm card applies without a workspaceId error.
4. Ask your Mono to add an item and set its status on a board it was added to. The item's activity names the Mono.

## Open threads

- Monos and the org assistant have no comment tool. Plan 2B needs comments as an `auto` write.
- Mono writes are logged in `item_activities` with `source: "user"`.
- Links someone else adds appear only after a reload, because `item_dependencies` is not in the realtime publication.
- Plan 2B is unwritten. Separately, the managed-org guards are owed: 0-credit metering, skip `ask_pulse` for Mono turns, exclude agents from seats.
- Four stale local branches, `task/monos-p1-t1` to `task/monos-p1-t4`. The basis-layer spec is untracked.
- Security: the owner's password reached a URL query string earlier in this session. Rotate it and clear Chrome history.

## Next session entry point

Write Plan 2B from `docs/superpowers/specs/2026-11-13-personal-monos-design.md`: inbox and wake-ups, `mono_runs`, `auto` writes with a comment tool, the owner Inbox UI, and MCP "Drive my Mono".
