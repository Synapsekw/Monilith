---
type: session
date: 2026-11-13-1702
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-11-13-1538-signup-approval]]"]
---

# Collapsed rail cleanup, shipped in PR #150

## What changed

- `BoardsNav.tsx`: when the left sidebar is collapsed, it shows one **Boards** tile linking to `/boards`. The tile is active on any board and on `/boards`. This replaces a dead "Boards" icon plus one letter tile per owned and shared board. The tile icon changed to `LayoutGrid` because Folders already used `FolderKanban`.
- `DockTiles.tsx` gained a `compact` prop, and the collapsed `BoardDock` rail uses it. The rail shows only Intelligence and one chat tile. That tile shows the active agent's initial and name and is selected whenever the chat tab is open. It shows the running dot while any agent is working.
- In `BoardDock.tsx`, clicking the rail's chat tile calls `changeTab("chat")` and does not call `selectTile(ask)`. Reopening the dock therefore keeps the active agent and its thread. The old path would have reset to plain Ask and started a new thread.
- Tests rewritten in `BoardsNav.test.tsx` and `BoardDock.test.tsx`. Full gates passed: 11,429 tests.
- Merged as `29500391`, then promoted on PR #150 together with signup approval. The PR's first Lighthouse run failed because the build couldn't fetch Google Fonts; a re-run passed. Main CI passed and Vercel reported success. Heal commit: `cb14f344`.
- Announced on `/updates` as an "improved" entry for 2026-11-13.

## Why

The owner found the collapsed rails cluttered. The left rail grew one tile per board and the dock grew one tile per agent. The owner chose to keep the nav sections, drop the board tiles, and cut the dock to Intelligence plus Ask.

## How to test (for the user)

1. Open www.monolith.works and press ⌘\ to collapse the sidebar. There are no board letter tiles, just one Boards tile, which takes you to `/boards` and is highlighted there.
2. Open any board. The Boards tile stays highlighted.
3. On the board, open the agent dock, choose an agent, and collapse the dock. The rail shows two tiles, and the second one shows the agent's initial with its name as the tooltip.
4. Click that tile. The dock reopens on the same conversation, and no new thread starts.
5. Send a message and collapse the dock while the agent replies. A pulsing dot appears on the chat tile.

## Open threads

- The change was never checked in a browser: Chrome MCP screenshots failed on both the live site and localhost. The walkthrough above is owed.

## Next session entry point

Run the walkthrough above on production. Otherwise, follow the north-star §3 Next list.
