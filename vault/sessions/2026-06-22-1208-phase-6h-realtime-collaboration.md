---
type: session
date: 2026-06-22-1208
branch: develop
trigger: wrapup
status: complete
tags: [session, phase-6h, realtime, presence, collaboration]
related:
  - "[[2026-06-22-phase-6h-realtime-collaboration-design]]"
  - "[[2026-06-22-gotcha-35-private-realtime-channel-needs-no-public-access-toggle]]"
  - "[[2026-06-22-gotcha-36-realtime-socket-integration-tests-need-native-event-globals-under-jsdom]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Phase 6h — Real-time collaboration (presence + visible last-write-wins)

## What changed

- Shipped **6h** (`task/realtime-collab` → merged `da12607`, 13 commits, pushed; gate green: typecheck · lint · 1118 unit+integration tests · build-in-main). Spec + plan in `docs/superpowers/`.
- **Presence on a private Supabase Realtime channel** `presence:board:${boardId}` — migration `20260622120000_realtime_presence_authorization` adds SELECT+INSERT RLS on `realtime.messages` (gate `extension in ('broadcast','presence')` + topic + `can_read_board`). Applied live + verified.
- Client core (all `src/lib/boards/`): `presence-color`, `presence-types`, `presence-target`, `presence-reducer` (pure), `presence-channel` (private, `setAuth()`), `useBoardPresence` (owned by `BoardViews`, survives view switches), `usePresenceFocus`, `presence-context`, `use-lww-flash` + additive `onRemoteChange` on `use-board-realtime` and `selfFocusTargetId` on the presence hook.
- UI: `BoardPresenceBar` (header avatar stack, all views) + `PresenceRing` + `FlashHighlight` + `PresenceFlashMessage`; indicators wired into Table (edit-focus), Kanban/Calendar/Gantt (drag-focus).
- **Deviations (forced by codebase, documented in spec/plan):** item-panel field indicators dropped (no field editors exist yet); no toast lib → flash + self-rendered ephemeral message; **no project-setting change needed** (research overturned the "disable Allow public access" assumption — would have regressed existing public channels).

## Why

Two people on one board couldn't see each other or who was editing what, and concurrent cell edits silently clobbered (last-write-wins with no signal). Data sync already worked; 6h adds the awareness + collision-visibility layer on top, without new tables and without disturbing the existing `postgres_changes` channel.

## How to test (for the user)

1. Pull `develop`. Open the same board as **two different members** in two browser profiles (normal + incognito).
2. Each session's avatar appears in the board header within ~1s (hover = name; 6+ collapse to `+k`).
3. In A, click a cell to edit → B sees a colored ring "A is editing" on that cell (never on your own).
4. While A has a cell focused, have B change that same cell → A sees a brief accent flash + a bottom-right "B changed this just now" pill (~2.5s); value updates live.
5. Drag a card/chip/bar in Kanban/Calendar/Gantt in A → B sees a ring during the drag. Avatar bar persists across view switches.
6. Open the board as a **non-member** via URL → no presence sent/received (private channel rejects them).

## Open threads

- Item-panel **field-level** indicators: fast-follow once inline field editing lands in the panel.
- Kanban/Calendar/Gantt presence is **drag-only**; a "who's viewing this item" (panel-open) signal would be richer — possible enhancement.
- Flash highlight is **Table-only**; extend to other views if wanted.
- `efb01e9 fix(favicon)` rode along on the shared `develop` push — another session's commit, benign.

## Next session entry point

6h is live on `develop` (not yet promoted). Next roadmap item is **7c Workload/capacity** (unspec'd — needs brainstorm→spec→plan), or promote `develop → main` to ship 6h + the favicon fix to production.
