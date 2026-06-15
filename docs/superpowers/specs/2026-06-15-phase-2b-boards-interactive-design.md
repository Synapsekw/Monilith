---
type: spec
status: approved
date: 2026-06-15
tags: [project/pulse, spec, phase-2]
related:
  [
    "[[00-north-star]]",
    "[[2026-06-15-phase-2-boards-core-design]]",
    "[[2026-06-15-1053-phase2a-boards-core]]",
  ]
---

# Pulse — Phase 2b: Boards Interactive — Design Spec

> Slice 2b of Phase 2. Builds on the merged 2a data layer + read-only Table
> ([[2026-06-15-phase-2-boards-core-design]], PR #9). Makes the Table interactive:
> inline cell editing, optimistic updates, and realtime sync.

## 1. Goal & scope

Turn the read-only board Table into a live editing surface:

- **Inline cell editing** for all six column kinds (Text, Numbers, Status, Dropdown, People, Date).
- **Optimistic updates** via TanStack Query — edits feel instant, roll back on error.
- **Realtime** — other users' changes appear live; the editing user sees no echo flicker.

**Prerequisite (Task 0):** squash the three 2a boards migrations into one canonical migration and
`supabase db reset --linked`, and seed default Status options so status editing is usable immediately.

**Out of scope (deferred):**

- **Drag-to-reorder** items/groups/columns (dnd-kit) — its own later slice; the `midpoint` helper
  stays unused until then.
- **Column options management UI** (add/rename/recolor Status & Dropdown labels) and `addColumn`/
  `removeColumn` — later slice. 2b seeds default Status options and edits cells against existing
  options only; Dropdown columns start empty (no options to pick until the options UI lands).
- Subitems, non-Table views, formula/mirror columns, comments, automations.

## 2. Task 0 — migration squash + reseed (prerequisite)

The 2a schema landed as three migrations (`_boards_core`, `_boards_core_fix_vgroup`,
`_boards_core_harden_fk`). While the dev project still holds no real data, consolidate them:

- Replace the three files with **one** canonical `<timestamp>_boards_core.sql` reproducing the exact
  final schema: tables + indexes, RLS (default-deny + parent-org `WITH CHECK` hardening via
  `board_in_org`/`group_in_org`/`item_in_org`/`column_in_org`), `set_updated_at` triggers,
  `create_board`/`create_item` RPCs, grants, and the `supabase_realtime` publication. Keep the
  Phase-1 migration untouched.
- In `create_board`, **seed the Status column with default options**:
  `Working on it` (`#fdab3d`), `Stuck` (`#e2445c`), `Done` (`#00c875`). Dropdown stays `{options: []}`.
- Apply with `supabase db reset --linked` (**destructive** — wipes dev data; authorized for this
  dev-only project), regenerate types, run advisors (clean).

This is the only schema change in 2b; cell editing uses the existing `cell_values` table.

## 3. Editing model

A cell enters edit mode on **click** or **Enter**; **Esc** cancels; **Tab** commits and moves to the
next editable cell. Each editor is a focused component under `src/components/boards/cells/editors/`,
swapped in by the cell when active (display renderers from 2a stay for the resting state).

| Kind     | Editor                                                                               | Value written                             |
| -------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| Text     | inline `<input>`, commit on Enter/blur                                               | `{ text }`                                |
| Numbers  | inline numeric `<input>`                                                             | `{ n }`                                   |
| Status   | Popover of colored option pills, single select                                       | `{ optionId }` (or cleared → row deleted) |
| Dropdown | Popover, multi-toggle of options                                                     | `{ optionIds: [] }`                       |
| People   | Popover with member search (profiles ⋈ org_members of the board's org), multi-select | `{ userIds: [] }`                         |
| Date     | Popover date picker                                                                  | `{ date }` ISO (clearable)                |

- All editors built with the `pulse-ui` + `frontend-design` skills, reusing existing primitives
  (Popover/Command/Input/Calendar). Keyboard-accessible, focus-trapped popovers, SR labels.
- The **Name** primary column inline-edits via the existing `renameItem` action.
- People editor needs the org's members: a server query `listOrgMembers(orgId)` returning
  `{ userId, fullName, avatarUrl }[]` (RLS-scoped via `is_org_member`).

## 4. Server actions (new in 2b)

In `src/lib/boards/actions.ts`:

- **`upsertCell({ itemId, columnId, kind, value })`** — Zod-validates `value` with
  `cellValueSchema(kind)`, derives `org_id`/`board_id` from the item server-side, upserts
  `cell_values` (conflict target `(item_id, column_id)`). RLS + parent-org `WITH CHECK` enforce
  tenancy; the action never trusts client-supplied `org_id`.
- **`clearCell({ itemId, columnId })`** — deletes the `cell_values` row (empty cell).

`renameItem`/`createItem`/`createGroup` from 2a are reused (now wired to optimistic mutations).

## 5. Optimistic updates (TanStack Query)

- The board view hydrates a Query cache keyed `["board", boardId]` from the 2a server payload
  (the `QueryClientProvider` already exists in `providers.tsx`).
- Mutations run through `useMutation`:
  - **`onMutate`** — snapshot the cached board, patch the target cell/row in place (instant UI).
  - **`onError`** — roll back to the snapshot; surface the error (reuse the `role="alert"` pattern).
  - **`onSettled`** — leave as-is; realtime (or a light invalidate) reconciles server truth.
- Cache patch logic lives in pure, unit-testable helpers in `src/lib/boards/cache.ts`
  (`upsertCellValue`, `removeCellValue`, `replaceItem`, `insertItem`, …) — no React inside.

## 6. Realtime reconciliation

- On mount the board view subscribes to **one** Supabase Realtime channel, `postgres_changes` on
  `cell_values`, `items`, `groups`, `columns` filtered `board_id=eq.<id>` (RLS-secured; tables were
  added to the publication in 2a). Torn down on unmount.
- Each event patches the same Query cache via the §5 pure helpers (upsert on INSERT/UPDATE, remove
  on DELETE).
- **Echo de-dupe:** the editing user's optimistic write already set the same value, so re-applying
  the server row is a no-op (no flicker); other users' edits patch in live. We do not add version
  tracking unless a real echo flicker appears, in which case a short-lived pending-keys set is the
  fallback.

## 7. Testing (mandatory — `pnpm typecheck`/`lint`/`test`/`build`/`e2e` all green)

- **Unit:** `upsertCell` value validation per kind; the `cache.ts` patch helpers (upsert/replace/
  remove/insert); optimistic rollback reducer.
- **Component:** each cell editor — open / edit / commit / Esc-cancel / Tab-advance; an optimistic
  test with a forced action failure asserting rollback + surfaced error.
- **RLS integration** (extends the 2a suite): `upsertCell` cannot write a cell into another org's
  board/item/column (cross-org rejected); auto-seed now includes the three default Status options.
- **e2e (Playwright):** on a seeded board, edit a Status, a Date, and a Text cell → values persist
  across reload. Realtime is impractical to assert single-browser; a two-context realtime test is
  **optional** (flagged, not required).

## 8. Execution

`writing-plans` produces the 2b plan; execution is subagent-driven (one subagent per task: squash+
reseed, server actions + validation, cache helpers, query-cache wiring, the editors, realtime, tests),
with two-stage review per task. Branch `feat/phase-2b-boards-interactive` → PR → green CI → merge.

After the phase: regenerate types, advisors, `/wrapup` (bump north-star: Phase 2 → Done), and commit
the vault updates promptly (SSOT).
