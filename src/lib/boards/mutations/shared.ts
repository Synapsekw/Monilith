"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { RelationLink } from "@/lib/boards/relations";
import {
  moveItemToGroup,
  removeCellValue,
  replaceBoard,
  replaceColumn,
  replaceGroup,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheBoard,
  type CacheCellValue,
  type CacheColumn,
  type CacheGroup,
  type CacheItem,
} from "@/lib/boards/cache";
import { boardKey, patchBoardCache } from "@/lib/boards/use-board-cache";

export type SetCellVars = { itemId: string; columnId: string; value: unknown };
export type ClearCellVars = { itemId: string; columnId: string };
export type AddItemVars = { groupId: string; name: string };
export type RenameItemVars = { itemId: string; name: string };
export type RenameGroupVars = { groupId: string; name: string };
export type RenameBoardVars = { name: string };
export type ResizeNameColumnVars = { width: number | null };
export type AddDependencyVars = { predecessorId: string; successorId: string };
export type RemoveDependencyVars = { dependencyId: string };
export type SetRelationVars = {
  itemId: string;
  columnId: string;
  links: RelationLink[];
};
/**
 * Optimistic-mutation context. Instead of snapshotting the WHOLE BoardCache and
 * restoring it wholesale on error (which resurrects the pre-peer snapshot and
 * silently discards any collaborator realtime update that landed while the
 * mutation was in flight — stability-audit finding), each mutation captures a
 * TARGETED inverse patch: a function that reverts only the specific
 * cell/field/entity it touched, applied over the CURRENT cache so concurrent
 * peer changes to other entities survive the rollback.
 */
export type Ctx = { rollback?: (cache: BoardCache) => BoardCache };

/**
 * Strip a removed option id from a single status/dropdown cell value. Returns
 * the updated cell, or `null` when the cell becomes empty (status cell that
 * referenced the option, or a dropdown left with no ids) and should be dropped.
 * Pure — mirrors the server's `delete_column_option` clearing behavior.
 */
export function stripOption(
  cv: CacheCellValue,
  optionId: string,
): CacheCellValue | null {
  const v = cv.value as { optionId?: string | null; optionIds?: string[] };
  if (v?.optionId !== undefined) return v.optionId === optionId ? null : cv;
  if (v?.optionIds) {
    const left = v.optionIds.filter((id) => id !== optionId);
    return left.length
      ? { ...cv, value: { optionIds: left } as CacheCellValue["value"] }
      : null;
  }
  return cv;
}

/**
 * Snapshot the prior values of exactly the keys a `change` patch touches, so a
 * rollback can revert those fields (and only those) on the current row. Keeps
 * field-level rollbacks from clobbering a peer's concurrent edit to a different
 * field of the same entity.
 */
export function pickFields<T extends object>(
  source: T,
  change: Partial<T>,
): Partial<T> {
  const prior: Partial<T> = {};
  for (const k of Object.keys(change) as (keyof T)[]) prior[k] = source[k];
  return prior;
}

/**
 * Per-render context shared by the domain sub-hooks that
 * `useBoardMutations` composes. Built fresh on every render of the facade
 * (mirroring the pre-split behavior where these helpers were plain functions
 * declared inside the hook body) — nothing here is memoized, and nothing here
 * calls React hooks.
 */
export type BoardMutationCtx = {
  qc: QueryClient;
  boardId: string;
  key: ReturnType<typeof boardKey>;
  rollback: (ctx: Ctx | undefined) => void;
  resyncOnError: () => void;
  cellRollback: (
    prior: CacheCellValue | undefined,
    itemId: string,
    columnId: string,
  ) => (c: BoardCache) => BoardCache;
  optimisticColumn: (columnId: string, change: Partial<CacheColumn>) => Ctx;
  optimisticItemField: (itemId: string, change: Partial<CacheItem>) => Ctx;
  optimisticMoveItem: (
    itemId: string,
    groupId: string,
    position?: number,
  ) => Ctx;
  optimisticGroupField: (groupId: string, change: Partial<CacheGroup>) => Ctx;
  optimisticBoardField: (change: Partial<CacheBoard>) => Ctx;
};

export function createBoardMutationCtx(
  qc: QueryClient,
  boardId: string,
): BoardMutationCtx {
  const key = boardKey(boardId);

  // Apply a mutation's targeted inverse patch over the CURRENT cache (never a
  // stale whole-cache snapshot), so a peer's realtime update that landed during
  // the failed mutation is preserved.
  function rollback(ctx: Ctx | undefined) {
    if (ctx?.rollback) patchBoardCache(qc, boardId, ctx.rollback);
  }

  // Full-board resync used as the rollback for destructive cascade mutations
  // (delete item/group/column, remove option) whose inverse is too intertwined
  // to reconstruct safely by hand. Cheap because it only runs on the rare error
  // path; the queryFn re-reads the same bounded payload and reconciles peers.
  function resyncOnError() {
    void qc.invalidateQueries({ queryKey: key });
  }

  // Inverse of a single-cell optimistic write: restore the prior cell, or drop
  // it if the cell didn't exist before. Shared by setCell/clearCell/setEstimate.
  function cellRollback(
    prior: CacheCellValue | undefined,
    itemId: string,
    columnId: string,
  ): (c: BoardCache) => BoardCache {
    return (c) =>
      prior ? upsertCellValue(c, prior) : removeCellValue(c, itemId, columnId);
  }

  // Field-precise optimistic patch for a column: writes `change` now and returns
  // a rollback that reverts ONLY those fields on the current column row (so a
  // peer's concurrent edit to a different field/column survives).
  function optimisticColumn(
    columnId: string,
    change: Partial<CacheColumn>,
  ): Ctx {
    const previous = qc.getQueryData<BoardCache>(key);
    const current = previous?.columns.find((c) => c.id === columnId);
    if (!previous || !current) return {};
    qc.setQueryData<BoardCache>(
      key,
      replaceColumn(previous, { ...current, ...change }),
    );
    const prior = pickFields(current, change);
    return {
      rollback: (c) => {
        const cur = c.columns.find((x) => x.id === columnId);
        return cur ? replaceColumn(c, { ...cur, ...prior }) : c;
      },
    };
  }

  // Field-precise optimistic patch for an item (rename/reorder).
  function optimisticItemField(
    itemId: string,
    change: Partial<CacheItem>,
  ): Ctx {
    const previous = qc.getQueryData<BoardCache>(key);
    const current = previous?.items.find((i) => i.id === itemId);
    if (!previous || !current) return {};
    qc.setQueryData<BoardCache>(
      key,
      replaceItem(previous, { ...current, ...change }),
    );
    const prior = pickFields(current, change);
    return {
      rollback: (c) => {
        const cur = c.items.find((i) => i.id === itemId);
        return cur ? replaceItem(c, { ...cur, ...prior }) : c;
      },
    };
  }

  // Optimistic cross-group move: apply the cache transform, capture a targeted
  // inverse that restores the moved item's group_id/position and each subitem's
  // group_id (so a concurrent peer update to other entities survives rollback).
  function optimisticMoveItem(
    itemId: string,
    groupId: string,
    position?: number,
  ): Ctx {
    const previous = qc.getQueryData<BoardCache>(key);
    const item = previous?.items.find((i) => i.id === itemId);
    if (!previous || !item) return {};
    const prior = { group_id: item.group_id, position: item.position };
    const subGroups = new Map(
      previous.items
        .filter((i) => i.parent_id === itemId)
        .map((i) => [i.id, i.group_id] as const),
    );
    qc.setQueryData<BoardCache>(
      key,
      moveItemToGroup(previous, itemId, groupId, position),
    );
    return {
      rollback: (c) => ({
        ...c,
        items: c.items.map((i) => {
          if (i.id === itemId) return { ...i, ...prior };
          if (subGroups.has(i.id))
            return { ...i, group_id: subGroups.get(i.id)! };
          return i;
        }),
      }),
    };
  }

  // Field-precise optimistic patch for a group (rename/reorder/color).
  function optimisticGroupField(
    groupId: string,
    change: Partial<CacheGroup>,
  ): Ctx {
    const previous = qc.getQueryData<BoardCache>(key);
    const current = previous?.groups.find((g) => g.id === groupId);
    if (!previous || !current) return {};
    qc.setQueryData<BoardCache>(
      key,
      replaceGroup(previous, { ...current, ...change }),
    );
    const prior = pickFields(current, change);
    return {
      rollback: (c) => {
        const cur = c.groups.find((g) => g.id === groupId);
        return cur ? replaceGroup(c, { ...cur, ...prior }) : c;
      },
    };
  }

  // Field-precise optimistic patch for the (singleton) board row.
  function optimisticBoardField(change: Partial<CacheBoard>): Ctx {
    const previous = qc.getQueryData<BoardCache>(key);
    if (!previous) return {};
    qc.setQueryData<BoardCache>(
      key,
      replaceBoard(previous, { ...previous.board, ...change }),
    );
    const prior = pickFields(previous.board, change);
    return { rollback: (c) => replaceBoard(c, { ...c.board, ...prior }) };
  }

  return {
    qc,
    boardId,
    key,
    rollback,
    resyncOnError,
    cellRollback,
    optimisticColumn,
    optimisticItemField,
    optimisticMoveItem,
    optimisticGroupField,
    optimisticBoardField,
  };
}
