"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { CacheItem } from "@/lib/boards/cache";
import type { ColumnKind } from "@/lib/validations/boards";
import {
  createBoardMutationCtx,
  type AddDependencyVars,
  type AddItemVars,
  type ClearCellVars,
  type RemoveDependencyVars,
  type RenameItemVars,
  type SetCellVars,
  type SetRelationVars,
} from "./mutations/shared";
import { useBoardRowMutations } from "./mutations/board";
import { useCellMutations } from "./mutations/cells";
import { useColumnMutations } from "./mutations/columns";
import { useColumnFileMutations } from "./mutations/files";
import { useGroupMutations } from "./mutations/groups";
import { useItemMutations } from "./mutations/items";
import { useRelationMutations } from "./mutations/relations";
import { useTimeMutations } from "./mutations/time";

// Pure helpers historically exported from this module (unit-tested directly).
export { pickFields, stripOption } from "./mutations/shared";

// Failed board mutations surface via the shared `showMutationError` toast helper
// (@/lib/ui/mutation-toast). Rollback restores the cache; the toast is the
// user-visible half (spec F2). Mutations whose callers surface errors inline via
// `onError` callbacks (addItem, addSubitem, addGroup, addColumn, addDependency)
// deliberately skip this — no double feedback.

/**
 * Facade over the per-domain mutation sub-hooks in `./mutations/`. The public
 * API (name, import path, returned object shape) is unchanged from the
 * pre-split single-file hook. Every sub-hook is called unconditionally in a
 * fixed order, so React's hook-order invariant holds; like before the split,
 * the returned wrappers are fresh per render (no memoization was ever added
 * here — the referentially-stable layer lives in the consumers).
 */
export function useBoardMutations(boardId: string) {
  const qc = useQueryClient();
  // Per-render shared context (query key + targeted-rollback helpers) — the
  // exact functions that used to be declared inline in this hook's body.
  const ctx = createBoardMutationCtx(qc, boardId);

  const { setCellMutation, clearCellMutation } = useCellMutations(ctx);
  const {
    addColumnMutation,
    renameColumnMutation,
    updateColumnSettingsMutation,
    removeColumnOptionMutation,
    resizeColumnMutation,
    reorderColumnMutation,
    deleteColumnMutation,
  } = useColumnMutations(ctx);
  const {
    addItemMutation,
    addSubitemMutation,
    restoreItemMutation,
    archiveItemMutation,
    reorderItemMutation,
    moveItemToGroupMutation,
    renameItemMutation,
  } = useItemMutations(ctx);
  const {
    addGroupMutation,
    renameGroupMutation,
    reorderGroupMutation,
    setGroupColorMutation,
    restoreGroupMutation,
    archiveGroupMutation,
  } = useGroupMutations(ctx);
  const { renameBoardMutation, resizeNameColumnMutation } =
    useBoardRowMutations(ctx);
  const {
    addDependencyMutation,
    removeDependencyMutation,
    setRelationLinksMutation,
  } = useRelationMutations(ctx);
  const { uploadColumnFileMutation, deleteColumnFileMutation } =
    useColumnFileMutations(ctx);
  const {
    startTimerMutation,
    stopTimerMutation,
    addManualEntryMutation,
    editEntryMutation,
    deleteEntryMutation,
    setEstimateMutation,
  } = useTimeMutations(ctx);

  return {
    setCell: (vars: SetCellVars) => setCellMutation.mutate(vars),
    setRelationLinks: (vars: SetRelationVars) =>
      setRelationLinksMutation.mutate(vars),
    clearCellValue: (vars: ClearCellVars) => clearCellMutation.mutate(vars),
    addItem: (
      vars: AddItemVars,
      callbacks?: {
        onSuccess?: (item: CacheItem) => void;
        onError?: (err: Error) => void;
      },
    ) =>
      addItemMutation.mutate(vars, {
        onSuccess: (data) => callbacks?.onSuccess?.(data.item),
        onError: (err) => callbacks?.onError?.(err),
      }),
    addSubitem: (
      parentId: string,
      name: string,
      callbacks?: {
        onSuccess?: (item: CacheItem) => void;
        onError?: (err: Error) => void;
      },
    ) =>
      addSubitemMutation.mutate(
        { parentId, name },
        {
          onSuccess: (data) => callbacks?.onSuccess?.(data.item),
          onError: (err) => callbacks?.onError?.(err),
        },
      ),
    archiveItem: (itemId: string) => archiveItemMutation.mutate({ itemId }),
    restoreItem: (itemId: string) => restoreItemMutation.mutate({ itemId }),
    // `deleteItem` is kept as an alias onto the archive (soft-delete) mutation so
    // existing callers keep working and gain Undo; a later task renames callers.
    deleteItem: (itemId: string) => archiveItemMutation.mutate({ itemId }),
    reorderItem: (itemId: string, position: number) =>
      reorderItemMutation.mutate({ itemId, position }),
    moveItemToGroup: (itemId: string, groupId: string, position?: number) =>
      moveItemToGroupMutation.mutate({ itemId, groupId, position }),
    renameItem: (vars: RenameItemVars) => renameItemMutation.mutate(vars),
    renameGroup: (groupId: string, name: string) =>
      renameGroupMutation.mutate({ groupId, name }),
    reorderGroup: (groupId: string, position: number) =>
      reorderGroupMutation.mutate({ groupId, position }),
    setGroupColor: (groupId: string, color: string) =>
      setGroupColorMutation.mutate({ groupId, color }),
    archiveGroup: (groupId: string) => archiveGroupMutation.mutate({ groupId }),
    restoreGroup: (groupId: string) => restoreGroupMutation.mutate({ groupId }),
    // `deleteGroup` is kept as an alias onto the archive (soft-delete) mutation
    // so existing callers keep working and gain Undo; callers renamed in Task 5.
    deleteGroup: (groupId: string) => archiveGroupMutation.mutate({ groupId }),
    addGroup: (
      name: string,
      callbacks?: {
        onSuccess?: (groupId: string) => void;
        onError?: (err: Error) => void;
      },
    ) =>
      addGroupMutation.mutate(
        { name },
        {
          onSuccess: (data) => callbacks?.onSuccess?.(data.group.id),
          onError: (err) => callbacks?.onError?.(err),
        },
      ),
    renameBoard: (name: string, callbacks?: { onSuccess?: () => void }) =>
      renameBoardMutation.mutate(
        { name },
        { onSuccess: () => callbacks?.onSuccess?.() },
      ),
    resizeNameColumn: (width: number | null) =>
      resizeNameColumnMutation.mutate({ width }),
    addDependency: (
      vars: AddDependencyVars,
      callbacks?: { onError?: (err: Error) => void },
    ) =>
      addDependencyMutation.mutate(vars, {
        onError: (e) => callbacks?.onError?.(e),
      }),
    removeDependency: (vars: RemoveDependencyVars) =>
      removeDependencyMutation.mutate(vars),
    addColumn: (
      kind: ColumnKind,
      settings?: Record<string, unknown>,
      callbacks?: { onError?: (err: Error) => void },
    ) =>
      addColumnMutation.mutate(
        { kind, settings },
        { onError: (err) => callbacks?.onError?.(err) },
      ),
    renameColumn: (columnId: string, name: string) =>
      renameColumnMutation.mutate({ columnId, name }),
    resizeColumn: (columnId: string, width: number) =>
      resizeColumnMutation.mutate({ columnId, width }),
    reorderColumn: (columnId: string, position: number) =>
      reorderColumnMutation.mutate({ columnId, position }),
    deleteColumn: (columnId: string) =>
      deleteColumnMutation.mutate({ columnId }),
    updateColumnSettings: (
      columnId: string,
      settings: Record<string, unknown>,
    ) => updateColumnSettingsMutation.mutate({ columnId, settings }),
    removeColumnOption: (columnId: string, optionId: string) =>
      removeColumnOptionMutation.mutate({ columnId, optionId }),
    uploadColumnFile: (itemId: string, columnId: string, file: File) =>
      uploadColumnFileMutation.mutate({ itemId, columnId, file }),
    deleteColumnFile: (attachmentId: string) =>
      deleteColumnFileMutation.mutate({ attachmentId }),
    startTimer: (itemId: string, columnId: string) =>
      startTimerMutation.mutate({ itemId, columnId }),
    stopTimer: (entryId: string) => stopTimerMutation.mutate({ entryId }),
    addManualEntry: (
      itemId: string,
      columnId: string,
      date: string,
      durationSecs: number,
    ) =>
      addManualEntryMutation.mutate({ itemId, columnId, date, durationSecs }),
    editEntry: (entryId: string, date: string, durationSecs: number) =>
      editEntryMutation.mutate({ entryId, date, durationSecs }),
    deleteEntry: (entryId: string) => deleteEntryMutation.mutate({ entryId }),
    setEstimate: (
      itemId: string,
      columnId: string,
      estimateSeconds: number | null,
    ) => setEstimateMutation.mutate({ itemId, columnId, estimateSeconds }),
  };
}
