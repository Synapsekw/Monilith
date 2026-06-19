# Add Group — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)
**Area:** Boards (Table view)

## Problem

A board is seeded with exactly one default group ("Group 1") by the `create_board`
RPC. Users can rename that group inline but cannot create additional groups — there
is no "Add group" affordance anywhere in the board UI.

The backend already supports multiple groups: the `groups` table has no per-board
uniqueness constraint, positions use the same `midpoint()` ordering as items, and a
`createGroup` server action exists (`src/lib/boards/actions.ts:145`). The action is
**not wired to any UI** and has no runtime callers. The realtime handler already
reconciles group INSERT/UPDATE/DELETE idempotently
(`src/lib/boards/use-board-realtime.ts:121-126`).

This is a missing UI + mutation wiring, **not** a roadmap feature deferred to a later
phase.

## Goal

Let a user add a new group to a board from the Table view, landing directly in rename
mode with an auto-incremented default name.

## Non-goals (YAGNI)

- Group **delete** — fast-follow, not requested.
- Group **reorder / drag** — explicitly deferred earlier; out of scope.
- Group **color picker** — new groups use the existing default color (`#0073ea`).

## Approach

Mirror the established `addColumn` / `addItem` **patch-on-success** pattern: the server
action returns the real created row, the mutation inserts it into the React Query
`["board", boardId]` cache, and the realtime echo is idempotent so no double-add occurs.
No new architecture.

### 1. Server action (`src/lib/boards/actions.ts`)

Change `createGroup` to return the **full created row** instead of just `{ groupId }`:

- `.select("*").single()` (currently `.select("id").single()`).
- Return `{ ok: true, data: { group: data } }` where `data: Tables<"groups">`.

This mirrors `createColumn` returning `{ column }`. Safe because the action has no
runtime callers (verified via grep — only schema/tests/docs reference it). The
`revalidatePath` call stays as-is.

### 2. Cache helper (`src/lib/boards/cache.ts`)

Add `insertGroup(cache, group)` — a direct mirror of `insertItem`:

```ts
/** Append a group; idempotent on id. Immutable. */
export function insertGroup(cache: BoardCache, group: CacheGroup): BoardCache {
  if (cache.groups.some((g) => g.id === group.id)) return cache;
  return { ...cache, groups: [...cache.groups, group] };
}
```

Appending to the end matches position order for a newly created group (its position
is `midpoint(last, null)`, i.e. greater than all existing) and is consistent with how
the realtime handler appends.

### 3. Mutation (`src/lib/boards/use-board-mutations.ts`)

Add `addGroupMutation` — a patch-on-success mirror of `addColumnMutation`:

- `mutationFn`: call `createGroup({ boardId, name })`; throw on `!res.ok`; return
  `res.data` (`{ group }`).
- `onSuccess({ group })`: `qc.setQueryData(key, (prev) => prev ? insertGroup(prev, group) : prev)`.
- Expose `addGroup(name, callbacks?: { onSuccess?: (groupId: string) => void })` from
  the hook, forwarding the new group's `id` so the UI can trigger auto-rename.

### 4. UI (`src/components/boards/BoardTable.tsx`)

**Add-group button.** New `AddGroupRow` component rendered after the `groups.map(...)`
block, styled like the existing `AddItemRow` — a subtle `+ Add group` button
(`Plus` icon + label, muted, hover affordance).

**BoardTable wiring.**

- Pull `addGroup` from `useBoardMutations`.
- Hold `const [renameGroupId, setRenameGroupId] = useState<string | null>(null)`.
- On add click: compute default name `Group ${groups.length + 1}`, call
  `addGroup(name, { onSuccess: (id) => setRenameGroupId(id) })`.
- Pass `autoFocusRename={group.id === renameGroupId}` to each `GroupSection`.

**GroupSection auto-rename.**

- Accept `autoFocusRename: boolean` and an `onRenameSettled: () => void` callback.
- Initialize the existing `renaming` state from `autoFocusRename`
  (`useState(autoFocusRename)`). The section is keyed by `group.id`, so the new group
  is a fresh mount — the initializer fires once with `true`.
- The existing rename `<Input>` already `autoFocus`es; pre-fill it with the default
  name (already the case via `useState(group.name)` since the cache row carries the
  auto-incremented name).
- On commit/blur/Esc, call `onRenameSettled()` so BoardTable clears `renameGroupId`
  (prevents re-trigger on any future remount).

No new editing UI — this reuses the inline rename input that already exists.

## Data-fetching budget

Per the working agreement (`AGENTS.md` rule 5):

- **First paint:** unchanged — no new server reads.
- **Interaction (add group):** changes **server data** → Server Action +
  optimistic cache patch. **0 RSC navigations**, no refetch (realtime +
  `revalidatePath` keep the cache fresh).
- **Bounded:** one INSERT + one returned row; no list re-read, no `select *` over a
  growing table.

## Testing (TDD)

- `src/lib/boards/cache.test.ts`: `insertGroup` — appends a group, is idempotent on a
  duplicate id, and does not mutate the input cache.
- `src/components/boards/BoardTable` test: clicking "Add group" creates a group named
  `Group N` (auto-incremented) and lands it in rename mode. Match the existing
  board-table test infra and mocking (mock the mutation hook / server action as the
  existing tests do).
- Run the full gate before claiming done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Risks / edge cases

- **Default-name collision** if a user renamed groups (e.g. count is 1 but the group
  isn't "Group 1"). Acceptable — it's only a pre-filled default the user immediately
  edits.
- **Realtime double-add** — prevented by `insertGroup` idempotency and the existing
  idempotent realtime handler.
- **Empty/whitespace rename commit** — the existing `commitRename` already reverts to
  the current (default) name on empty input; the group keeps its `Group N` name.
