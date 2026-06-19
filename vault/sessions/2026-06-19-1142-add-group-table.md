---
type: session
date: 2026-06-19-1142
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-19-1018-name-column-resize-autofit]]"
---

# Add Group — board groups creatable from the Table view

## What changed

- **Wired the dormant `createGroup` action to the UI.** Boards seeded exactly one group ("Group 1") with no way to add more; the `createGroup` Server Action existed but had zero runtime callers. Now there's a `+ Add group` button at the bottom of the Table.
- `createGroup` (`actions.ts`) now returns the full created row (`.select("*")` → `{ group }`) instead of `{ groupId }`, mirroring `createColumn`/`createItem` so the cache can patch-on-success without a refetch.
- New `insertGroup` cache helper (`cache.ts`, mirror of `insertItem`) + `addGroup` optimistic mutation (`use-board-mutations.ts`, mirror of `addColumnMutation`) exposing `addGroup(name, { onSuccess(groupId), onError })`.
- `BoardTable.tsx`: `AddGroupRow` button → `addGroup(\`Group ${groups.length + 1}\`)`(auto-increment) +`renameGroupId`state;`GroupSection`gains`autoFocusRename`/`onRenameSettled` so the new group mounts straight into its existing inline rename input.
- 6 commits `b1c5a95..03b1aea` (TDD per task, subagent-driven + two-stage review). Gate green: typecheck/lint/**590 tests**/build. **User-verified live ("working, i can create a new group no issues").**

## Why

A board with a single immovable group isn't usable for real work — the user hit this immediately. The backend already supported N groups (no per-board uniqueness constraint, `midpoint` positions, idempotent realtime handler); only the UI + mutation wiring was missing. This was a gap-fill, not a roadmap phase.

## Open threads

- **Not pushed** — sits on top of the unpushed 5c-1 + name-column work on `develop`.
- Deferred (YAGNI, noted in spec): group **delete**, **reorder/drag**, **color picker**. Likely fast-follows.
- Default name is count-based (`Group N`) — cosmetic collision possible after manual renames; intentionally naive since the user lands in rename mode. Code review flagged as Minor.

## Next session entry point

Push `develop` (carries 5c-1, name-column, and now add-group) once ready, or continue Phase 5c-2 (webhook actions via `pg_net`, plan already on `develop`). Group delete/reorder are the obvious next board-groups follow-ups if prioritized.
