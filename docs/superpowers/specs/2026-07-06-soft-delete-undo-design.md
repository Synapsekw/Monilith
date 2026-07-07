---
type: spec
status: awaiting-review
date: 2026-07-06
topic: soft-delete-undo
tags: [project/pulse, spec, boards, data-safety]
related:
  - "[[2026-07-06-soft-delete-undo]]"
  - "[[00-north-star]]"
---

# Soft-delete / Undo via `archived_at` — Design Spec

> Migration-gated deferral from the north-star "Owed" list. Replaces the app's
> destructive hard-deletes of **boards, groups, and items** with a reversible
> archive, an immediate **Undo toast**, and a **Trash** recovery surface with an
> explicit permanent-purge.

## 1. Problem & intent

Every board-data delete today is an irreversible hard `.delete()`:

- `deleteBoard` / `deleteGroup` / `deleteItem` in `src/lib/boards/actions.ts`
  cascade rows out of Postgres via `on delete cascade` FKs and (for boards/items)
  eagerly free their Storage objects via `removeAttachmentObjects`.
- `bulkDeleteItems` (`src/lib/boards/bulk-actions.ts`) loops the same hard delete;
  its own comment already flags that soft-delete "needs an `archived_at` migration
  this environment can't apply."

A mis-click on a group or a board destroys real work with no recovery. The intent
is a **standard soft-delete lifecycle**: delete → archived (hidden but recoverable)
→ (undo | restore) or (permanent purge). This is a data-safety feature; correctness
(no cross-tenant leak, no orphaned counts, no resurrected data) outranks polish.

### Goals

1. A delete of a board / group / item **archives** it (sets `archived_at`) instead
   of destroying it. It disappears from every normal surface immediately.
2. An **Undo toast** with a short time window (~8s) reverses the archive with one
   click, restoring the exact set that was archived.
3. A **Trash** surface recovers items beyond the toast window (per-board trash for
   groups/items; a workspace-level trash for archived boards).
4. **Permanent purge** is explicit and manual (Trash → "Delete permanently" /
   "Empty trash"); only purge frees Storage objects and hard-deletes rows.
5. **Zero archived-row leakage**: no archived item is ever counted, aggregated,
   searched, mirrored, rolled-up, or rendered on a normal surface.

### Non-goals (explicitly deferred)

- **Automated retention cron** (auto-purge after N days). SQL `pg_cron` cannot call
  the Node service-role Storage cleanup, so unattended purge would orphan attachment
  objects. Documented as a follow-up; v1 purge is manual only.
- Soft-delete for **columns, cell values, dependencies, attachments, board views,
  time entries, automations**. Columns/cells/attachments already have targeted undo
  affordances or are low-regret; they stay hard-delete in v1.
- Archive of **workspaces / organizations**.
- A cross-org / admin "recently deleted" console.

## 2. Chosen approach

### 2.1 Undo UX — **both** (toast is primary, Trash is the safety net)

- **Undo toast** is the immediate, in-context affordance on every delete surface
  (row menu, group menu, board menu, bulk bar). Greenfield: sonner is mounted but
  only ever used for errors today — we add a `showUndoToast(message, onUndo)` helper.
- **Trash** is the durable recovery path once the toast is gone. Two surfaces:
  - **Per-board Trash** (dialog opened from the board): archived groups + items of
    that board, each with Restore / Delete-permanently, plus "Empty trash".
  - **Workspace Trash** (archived boards): a section/route listing the current
    user's archived boards with Restore / Delete-permanently.

Rationale: the toast covers the 95% "oops" case at zero navigation cost; Trash
covers the "I need it back tomorrow" case and is where purge lives. Both reuse the
same `restore*` / `purge*` server actions, so there is one authorization path.

### 2.2 Data model — additive, nullable

Add to `boards`, `groups`, `items`:

```
archived_at  timestamptz null   -- null = live; non-null = archived at this instant
archived_by  uuid null references auth.users(id)  -- who archived (audit + Trash "by")
```

- **Partial indexes** so the hot "live rows" reads stay index-served and add zero
  latency, plus a partial index for the (cold) Trash reads:
  - `items  (board_id, position)      where archived_at is null` (replaces the hot path served today by `items_board_position_idx`)
  - `groups (board_id)                where archived_at is null`
  - `boards (created_by)              where archived_at is null`
  - `items  (board_id)               where archived_at is not null` (Trash)
  - `groups (board_id)               where archived_at is not null` (Trash)

### 2.3 Where archived rows are filtered — **application + RPC layer, NOT RLS**

This is the load-bearing architectural decision.

- **RLS stays untouched.** Adding `archived_at is null` into the SELECT policies or
  `readable_board_ids()` would hide archived rows from _everything_ — including the
  restore/undo/Trash code that must read them. It would also risk regressing the
  security layer that the 2026-07-05 audit-fix sweep just hardened. Archived rows
  are still the org's own data; hiding them is a **visibility** concern, not a
  **security** boundary.
- **Normal reads add an explicit `archived_at is null` filter** at the query. There
  are two classes:
  - **TS reads** (RLS-scoped): `getBoardPayload` (items + groups), `listMyBoards`,
    `listSharedBoards` + their `-cached` service-client twins, my-work, time,
    global search, relation candidates, dashboard page/board pickers.
  - **SECURITY DEFINER aggregation RPCs** (they bypass RLS, so they _must_ filter
    themselves): `dashboard_aggregate`, `dashboard_list_rows`, `dashboard_series`,
    `dashboard_completion`, `_board_health_flags` / `_board_health_counts`,
    `portfolio_rollup`, `workload_rollup`, `workload_actuals_rollup`, `goals_rollup`,
    and `create_item`'s `max(position)` seed read.
- **Trash reads** do the inverse (`archived_at is not null`), bounded + indexed.
- **`can_read_board` / `readable_board_ids()` do NOT gain an archived check.** An
  archived board stays "readable" so restore can load it; it is hidden purely by the
  app-level `listMyBoards`/`listSharedBoards` filter and a board-page guard.

Trade-off accepted: ~14 TS read sites + ~10 RPCs must each add the predicate, and a
missed site leaks archived rows. This is mitigated by (a) a shared, greppable
constant/comment convention, and (b) an integration "no archived leakage" test sweep
(§7). The alternative (RLS filtering) is fewer sites but breaks restore and is
riskier for security — rejected.

### 2.4 Cascade & restore semantics — timestamp-batch

- **Archive item**: set `archived_at = ts, archived_by = me` on the item **and** its
  live subitems (same `ts`). Restore clears `archived_at` on the item and the
  subitems whose `archived_at = ts` (so a subitem archived independently earlier
  stays archived).
- **Archive group**: set the same `ts` on the group **and** its live top-level items
  - their subitems. Restore clears the group and the items whose `archived_at = ts`.
- **Archive board**: set `archived_at` on the **board row only**. Its groups/items
  are _not_ cascade-archived — they are already invisible because the board is hidden
  from every list and its page is guarded. Restore just clears `board.archived_at`
  and everything reappears exactly as it was. (This keeps board archive O(1) and
  sidesteps re-archiving a 5000-item board.)
- Atomicity: group/item cascade archive+restore run as **`SECURITY INVOKER` RPCs**
  (respect RLS, one transaction, return affected counts) authored in the migration.
  Board archive/restore are plain RLS-scoped TS updates (no cascade).

### 2.5 Purge (permanent)

- `purgeItem` / `purgeGroup` / `purgeBoard` (and bulk) hard-`.delete()` the archived
  entity (FK `on delete cascade` removes children/cells) and then call
  `removeAttachmentObjects` for the freed Storage paths — i.e. the _current_
  `deleteItem`/`deleteBoard` bodies become the purge path. Guarded: purge requires
  the same authorization as delete (board owner/admin for a board; org member for
  groups/items), plus the row must already be archived.
- Only reachable from Trash. No time-based auto-purge in v1.

### 2.6 Realtime — archive is an UPDATE, must fold as a removal

The board client is TanStack Query + a realtime channel. `realtime-buffer.ts`
folds `postgres_changes`: today an item/group DELETE removes it from cache and an
UPDATE replaces/keeps it. An **archive is an UPDATE** (`archived_at` set non-null),
so remote clients would keep the archived row visible until refetch. Fix in
`applyItem` / `applyGroup`:

- incoming row with `archived_at != null` → **remove** from cache (reuse
  `removeItem`/`removeGroup`, matching the DB cascade).
- incoming row with `archived_at == null` that isn't present → **insert** (a peer's
  undo/restore reappears live).

## 3. Components & data flow

```
Delete click (row/group/board/bulk)
  → archive Server Action (RPC for cascade)         [server data change]
  → optimistic remove from BoardCache (existing removeItem/removeGroup)
  → showUndoToast("Deleted X", onUndo)               [~8s]
        onUndo → restore Server Action → optimistic re-insert / targeted resync
  → realtime UPDATE(archived_at set) echoes to peers → folded as removal

Trash (dialog / route)
  → bounded read of archived rows (archived_at is not null, indexed)
  → Restore → restore Server Action → row leaves Trash, reappears on board
  → Delete permanently → purge Server Action (hard delete + storage cleanup)
```

### Units (each independently testable)

1. **Migration** (`supabase/migrations/…`): DDL + partial indexes + cascade
   archive/restore RPCs + archived-filter patches to the 10 aggregation RPCs.
2. **Server mutations** (`actions.ts`, `bulk-actions.ts`, `validations/board-actions.ts`):
   `archive*` / `restore*` / `purge*` + bulk variants + Zod schemas.
3. **Read filters** (the ~14 TS reader files): add `archived_at is null`.
4. **Realtime + cache** (`realtime-buffer.ts`, `cache.ts`): archive⇒remove,
   unarchive⇒insert.
5. **Optimistic + toast** (`use-board-mutations.ts`, `use-bulk-mutations.ts`,
   `lib/ui/mutation-toast.ts`): archive mutations + `showUndoToast` + restore wiring.
6. **Delete-surface UI** (`BoardItemMenu`, `BoardTable` row/group menus,
   `BoardBulkBar`): re-label copy ("Archive"/"Move to Trash"), fire archive + undo.
7. **Trash UI** (new per-board dialog + workspace archived-boards surface).
8. **Board-list / sidebar filtering** (`sidebar-nav-data`, `command-palette-data`,
   `home`, `boards` page): archived boards drop out.

## 4. Error handling & edge cases

- **Archive fails**: optimistic remove rolls back (existing `resyncOnError`), error
  toast — no undo toast shown.
- **Undo fails** (window expired server-side, or restore errors): error toast; the
  row stays archived and is still recoverable from Trash. Undo is best-effort UI;
  Trash is the source of truth.
- **Restore of a group whose board was since archived**: restore the group; it is
  visible again once its board is restored. Restore does not auto-restore ancestors.
- **Restore of an item whose group was purged**: block with a clear message ("its
  group no longer exists") — the FK would be dangling. (Group purge cascades items
  in Postgres, so this only arises if the item was archived independently _before_
  the group was purged; the purge path must also purge already-archived descendants.)
- **Purge authorization**: board purge requires owner/admin (mirror `deleteBoard`'s
  explicit `getBoardAccess` check — an RLS-filtered delete affecting 0 rows is a lying
  success; keep the explicit guard).
- **Concurrent peer edits during archive**: rollback uses the existing targeted-patch
  model so a peer's realtime update to another entity survives.
- **Idempotency**: archiving an already-archived row is a no-op (`where archived_at is
null`); restoring a live row is a no-op.
- **Attachments on archived rows**: their Storage objects are **retained** while
  archived (recoverable) and freed **only on purge**.

## 5. Security

- Archive/restore are RLS-scoped writes (org member; board owner/admin for board
  archive, matching today's delete authorization). Purge keeps the explicit
  `getBoardAccess` owner/admin guard for boards.
- No new cross-tenant surface: Trash reads are the same org/board-scoped reads with
  the archived predicate inverted; `readable_board_ids()` is unchanged.
- `SUPABASE_SERVICE_ROLE_KEY` stays server-only (purge's `removeAttachmentObjects`
  already uses it server-side).

## 6. Performance & data-fetching budget

(Mandated by working-agreement #5.)

- **First paint (board):** `getBoardPayload`'s items + groups reads gain
  `.is('archived_at', null)`, served by the new partial indexes — **0 extra
  round-trips**, no added latency vs today. Board-list reads gain the boards partial
  index. Items read stays bounded (`limit 5000`).
- **Interactions (archive / restore / undo):** these **change server data** → Server
  Action (+ RPC) with **optimistic cache patch + realtime fold**, **0 refetch on the
  happy path** (same as today's delete). Undo = one restore Server Action; success
  re-inserts optimistically (or a rare targeted `invalidateQueries` for a
  large-group restore).
- **Trash:** off the board hot path. Opened on demand as a **dialog** (no RSC nav,
  no `<Link>`/router) → a single bounded read (`archived_at is not null`, `limit
200`) over the Trash partial index. First paint pays nothing for Trash.
- **Aggregation RPCs:** unchanged query plans + one `archived_at is null` predicate
  served by the partial index — no new round-trips, no N+1.
- **No unbounded reads introduced.** All new reads are bounded + indexed.

## 7. Testing strategy (TDD — tests written and run per task)

- **Unit (server actions, mocked Supabase):** archive sets `archived_at`/`archived_by`
  and does NOT hard-delete; restore clears only the matching-timestamp set; purge
  hard-deletes + calls `removeAttachmentObjects`; purge board keeps the owner/admin
  guard. Extend `actions.test.ts` / `bulk-actions.test.ts` patterns.
- **Unit (pure):** `realtime-buffer` folds an UPDATE-with-`archived_at` as a removal
  and an unarchive as an insert; `cache.ts` helpers unchanged behavior.
- **Hook:** `use-board-mutations` archive mutation removes optimistically and fires
  the **undo toast** (extend the existing `vi.mock("sonner")` to assert the `action`
  fires the restore).
- **Integration (real DB, RLS):** archive → row hidden from `getBoardPayload`,
  present in Trash read; restore → reappears; purge → gone + storage cleaned; **no
  archived leakage** into dashboard/health/rollup counts (seed archived items, assert
  counts exclude them); cross-tenant archived rows never visible.
- **Component:** delete menus show archive copy + fire undo; Trash dialog lists,
  restores, purges.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green;
  Supabase advisors clean after the migration.

## 8. Parallelization (independent units — full DAG in the plan)

Independent after the migration: **read-path filters**, **realtime/cache fold**, and
**server mutations** touch disjoint files and can run concurrently. The undo/optimistic
layer depends on the server mutations; the delete-surface UI depends on the optimistic
layer; Trash depends on the mutations + read filters. The migration (Task 0) is the
root everything depends on and is **user-applied** (the agent cannot push migrations).

## 9. Open questions (for reviewer)

1. **Undo window length** — 8s proposed (sonner default is ~4s; 8–10s is friendlier
   for a destructive action). OK?
2. **Board Trash location** — a section on the existing `/boards` page vs. a dedicated
   `/boards/trash` route vs. a dialog. Proposal: dialog for per-board group/item trash;
   a lightweight section on `/boards` for archived boards. Preference?
3. **Group/item cascade archive as RPC vs. two TS updates** — RPC chosen for atomicity;
   confirm that's worth the extra migration surface.
4. **Do we want `archived_by` surfaced** in Trash ("archived by Dani, 2h ago") in v1,
   or is that polish for later?
   </content>
   </invoke>
