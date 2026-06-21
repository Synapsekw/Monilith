# Free attachment files on delete

**Date:** 2026-06-21
**Status:** Approved — ready for implementation plan

## Problem

When an item or board is deleted, the `attachments` metadata rows cascade away
(FKs: `attachments.item_id`/`board_id` both `on delete cascade`,
`supabase/migrations/20260617110000_attachments.sql:11-12`), but the underlying
files in the private `attachments` Storage bucket are **never removed**. The
delete actions (`deleteItem` at `src/lib/boards/actions.ts:354`, `deleteBoard`
at `:116`) only delete the DB row and rely on the cascade — they never call
`storage.remove()`. Result: orphaned objects accumulate in the bucket, billable
storage with no corresponding row and no cleanup job to reclaim it.

The single-attachment path (`deleteAttachment`,
`src/lib/collaboration/actions.ts:317`) already does this correctly
(object-first, then row), but the bulk cascade paths do not.

## Goal

When an item or a board is deleted, the underlying storage objects are removed,
not just the metadata rows.

## Decisions (from brainstorming)

- **Scope:** item delete + board delete. Organization delete has **no code path
  in the app today** (only `updateOrgTimezone` exists in `src/lib/org/actions.ts`),
  so there is nothing to wire for orgs — the cleanup helper is built path-agnostic
  so a future org-delete plugs in with one call.
- **Approach:** synchronous, service-role cleanup. No new infra (a service-role
  client already exists). Historical orphans (files orphaned by _past_ deletes)
  are explicitly out of scope — that would require a one-off sweep, which was
  declined.

## Design

### Why service-role

The storage object delete RLS is uploader-or-admin **per object**
(`20260617110000_attachments.sql:72-78`). A regular member deleting an item or
board that holds files uploaded by _other_ people cannot remove those objects
through the normal user-scoped client. The privileged removal therefore uses the
existing `createServiceClient()` (`src/lib/supabase/service.ts:6`, already used
by `src/lib/platform/actions.ts`), which bypasses RLS.

Authorization is **not** weakened: the privileged removal runs only _after_ the
user's own RLS-guarded row delete succeeds. If the user is not allowed to delete
the item/board, the action returns `fail` before any object is touched.

### 1. Shared cleanup helper — `src/lib/collaboration/attachment-cleanup.ts`

Server-only module:

```ts
import "server-only";

/**
 * Best-effort removal of attachment storage objects via the service-role
 * client (bypasses the per-object uploader/admin RLS so a member can clear
 * files other people uploaded). Chunks into batches; an empty list is a no-op;
 * logs — does not throw — on storage errors, because the authoritative DB
 * delete has already happened and a failed object removal is at worst a rare
 * orphan (today's status quo), never a dangling row.
 */
export async function removeAttachmentObjects(
  storagePaths: string[],
): Promise<void>;
```

- Returns immediately when `storagePaths` is empty.
- Chunks paths into batches of **100** and calls
  `createServiceClient().storage.from("attachments").remove(batch)` per batch.
- On a batch error: `console.error` and continue; never throws.

### 2. `deleteItem` (`src/lib/boards/actions.ts:354`)

Order: **gather → delete → remove.**

1. Select `storage_path` from `attachments` for the item **and its subitems**:
   `item_id = X OR item_id IN (select id from items where parent_id = X)`.
   Matches the one-level subitem data model; reads the
   `attachments_item_id_idx` index. (If deeper nesting is ever added, revisit.)
2. Delete the item — unchanged, RLS-guarded; this is the authorization gate.
3. On success, `await removeAttachmentObjects(paths)` (best-effort).

### 3. `deleteBoard` (`src/lib/boards/actions.ts:116`)

Same shape, simpler gather:
`select storage_path from attachments where board_id = X` — every attachment row
carries a denormalized `board_id` (indexed by `attachments_board_id_idx`), so one
query covers all items/subitems on the board.

### Failure semantics

The DB delete is authoritative. If storage removal fails afterward, log and
still return `{ ok: true }`. Worst case is a rare orphaned file (today's status
quo), never a dangling row pointing at deleted bytes.

### Out of scope

- **Org delete** — no code path exists; helper is ready when it lands.
- **`deleteAttachment`** — already object-first; left unchanged.
- **Historical orphans** — sync-only was chosen; past orphans are not reclaimed.

## Performance & data-fetching budget

Both paths are Server Actions (mutations), not in-page view toggles — no
RSC-refetch concern. Each adds exactly **one** bounded `select storage_path`
read over an indexed filter column (`attachments_item_id_idx` /
`attachments_board_id_idx`), plus N/100 storage `remove` calls. No unbounded
`select *`.

## Testing (Vitest)

Mock both `createClient` (`@/lib/supabase/server`) and `createServiceClient`
(`@/lib/supabase/service`), mirroring the existing pattern in
`src/lib/collaboration/attachments-actions.test.ts`.

- **`deleteItem`**: gathers item+subitem paths → deletes item → calls
  `remove` with exactly those paths; item with no attachments → `remove` not
  called; storage `remove` failure → action still returns `{ ok: true }`.
- **`deleteBoard`**: gathers by `board_id` → deletes → removes those paths.
- **helper**: >100 paths split into batches; empty list is a no-op (no client
  constructed / no `remove` call).

## Parallelization plan (execution DAG)

Independent units:

- **T1** — `attachment-cleanup.ts` helper + its tests.
- **T2** — wire `deleteItem` + tests. Depends on T1 (imports the helper).
- **T3** — wire `deleteBoard` + tests. Depends on T1.

DAG: `T1 → {T2, T3}`. After T1, **T2 ∥ T3** (different functions, same file
`src/lib/boards/actions.ts` — so if dispatched in parallel they need isolated
worktrees to avoid clobbering; given the small size they may simply run in one
pass). Critical path: T1 → T2 (or T3).

## Verification

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; the new
tests above pass.
