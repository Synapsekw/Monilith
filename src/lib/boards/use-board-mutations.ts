"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addSubitem,
  clearCell,
  createColumn,
  createGroup,
  createItem,
  deleteColumn,
  deleteGroup,
  deleteItem,
  renameBoard,
  removeColumnOption,
  renameColumn,
  renameGroup,
  renameItem,
  reorderGroup,
  reorderItem,
  resizeColumn,
  resizeNameColumn,
  updateColumnSettings,
  updateGroupColor,
  upsertCell,
} from "@/lib/boards/actions";
import {
  createDependency,
  deleteDependency,
} from "@/lib/boards/dependency-actions";
import {
  startTimer,
  stopTimer,
  addManualEntry,
  editEntry,
  deleteEntry,
  setEstimate,
} from "@/lib/boards/time-actions";
import {
  createAttachment,
  deleteAttachment,
} from "@/lib/collaboration/actions";
import { setRelationLinks } from "@/lib/boards/relation-actions";
import type { RelationLink } from "@/lib/boards/relations";
import { createClient } from "@/lib/supabase/client";
import { buildColumnFilePath } from "@/lib/collaboration/attachments-path";
import { MAX_FILE_BYTES } from "@/lib/collaboration/use-attachment-mutations";
import {
  insertColumn,
  insertGroup,
  insertItem,
  prependColumnFile,
  prependTimeEntry,
  removeCellValue,
  removeColumn,
  removeColumnFile,
  removeDependency,
  removeGroup,
  removeItem,
  removeTimeEntry,
  setRelationLinksForCell,
  replaceBoard,
  replaceColumn,
  replaceGroup,
  replaceItem,
  upsertCellValue,
  upsertTimeEntry,
  type BoardCache,
  type CacheAttachment,
  type CacheCellValue,
  type CacheColumn,
  type CacheGroup,
  type CacheItem,
  type CacheTimeEntry,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import type { ColumnKind } from "@/lib/validations/boards";

type SetCellVars = { itemId: string; columnId: string; value: unknown };
type ClearCellVars = { itemId: string; columnId: string };
type AddItemVars = { groupId: string; name: string };
type RenameItemVars = { itemId: string; name: string };
type RenameGroupVars = { groupId: string; name: string };
type RenameBoardVars = { name: string };
type ResizeNameColumnVars = { width: number | null };
type AddDependencyVars = { predecessorId: string; successorId: string };
type RemoveDependencyVars = { dependencyId: string };
type SetRelationVars = {
  itemId: string;
  columnId: string;
  links: RelationLink[];
};
type Ctx = { previous?: BoardCache };

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

export function useBoardMutations(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);

  const setCellMutation = useMutation<unknown, Error, SetCellVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await upsertCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const cell: CacheCellValue = {
          org_id: previous.board.org_id,
          board_id: previous.board.id,
          item_id: vars.itemId,
          column_id: vars.columnId,
          value: vars.value as CacheCellValue["value"],
          updated_at: new Date().toISOString(),
        };
        qc.setQueryData<BoardCache>(key, upsertCellValue(previous, cell));
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      // No refetch: Realtime + revalidatePath keep the cache fresh.
    },
  });

  const addColumnMutation = useMutation<
    { column: CacheColumn },
    Error,
    { kind: ColumnKind; settings?: Record<string, unknown> },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await createColumn({
        boardId,
        kind: vars.kind,
        settings: vars.settings,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    // Insert the returned column immediately (mirrors addItem). The Realtime
    // INSERT echo is idempotent via `insertColumn`, so this client and peers
    // don't double-add — and the column appears even if Realtime lags or drops.
    onSuccess: ({ column }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertColumn(prev, column) : prev,
      );
    },
  });

  /**
   * Add a new group. Patch-on-success (mirrors addColumn): wait for the server
   * to return the real group row, then insert it into the cache. The Realtime
   * INSERT echo is idempotent via `insertGroup`.
   */
  const addGroupMutation = useMutation<
    { group: CacheGroup },
    Error,
    { name: string },
    void
  >({
    mutationFn: async (vars) => {
      const res = await createGroup({ boardId, name: vars.name });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: ({ group }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertGroup(prev, group) : prev,
      );
    },
  });

  function optimisticColumn(
    columnId: string,
    change: Partial<CacheColumn>,
  ): { previous?: BoardCache } {
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      const current = previous.columns.find((c) => c.id === columnId);
      if (current)
        qc.setQueryData<BoardCache>(
          key,
          replaceColumn(previous, { ...current, ...change }),
        );
    }
    return { previous };
  }

  const renameColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string; name: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await renameColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, { name: vars.name });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const updateColumnSettingsMutation = useMutation<
    unknown,
    Error,
    { columnId: string; settings: Record<string, unknown> },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await updateColumnSettings(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, {
        settings: vars.settings as CacheColumn["settings"],
      });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const removeColumnOptionMutation = useMutation<
    unknown,
    Error,
    { columnId: string; optionId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await removeColumnOption(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const col = previous.columns.find((c) => c.id === vars.columnId);
        const opts = (
          (col?.settings as { options?: { id: string }[] })?.options ?? []
        ).filter((o) => o.id !== vars.optionId);
        let next = col
          ? replaceColumn(previous, {
              ...col,
              settings: {
                ...(col.settings as object),
                options: opts,
              } as CacheColumn["settings"],
            })
          : previous;
        next = {
          ...next,
          cellValues: next.cellValues
            .map((cv) =>
              cv.column_id === vars.columnId
                ? stripOption(cv, vars.optionId)
                : cv,
            )
            .filter((cv): cv is CacheCellValue => cv !== null),
        };
        qc.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const resizeColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string; width: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await resizeColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, { width: vars.width });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const deleteColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeColumn(previous, vars.columnId));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const clearCellMutation = useMutation<unknown, Error, ClearCellVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await clearCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          removeCellValue(previous, vars.itemId, vars.columnId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /**
   * Add a new item. Patch-on-success: we wait for the server to return the
   * real item row (with server-assigned id/position), then insert it into the
   * cache. The Realtime INSERT echo is idempotent via `insertItem`.
   */
  const addItemMutation = useMutation<
    { item: CacheItem },
    Error,
    AddItemVars,
    void
  >({
    mutationFn: async (vars) => {
      const res = await createItem(vars);
      if (!res.ok) throw new Error(res.error);
      return { item: res.data.item as CacheItem };
    },
    onSuccess: ({ item }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertItem(prev, item) : prev,
      );
    },
  });

  /** Add a subitem. Patch-on-success (mirrors addItem); Realtime echo idempotent. */
  const addSubitemMutation = useMutation<
    { item: CacheItem },
    Error,
    { parentId: string; name: string },
    void
  >({
    mutationFn: async (vars) => {
      const res = await addSubitem(vars);
      if (!res.ok) throw new Error(res.error);
      return { item: res.data.item as CacheItem };
    },
    onSuccess: ({ item }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertItem(prev, item) : prev,
      );
    },
  });

  /** Delete an item/subitem. Optimistic remove (cascades subitems in cache); rollback on error. */
  const deleteItemMutation = useMutation<
    unknown,
    Error,
    { itemId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeItem(previous, vars.itemId));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /** Reorder an item (subitem within its parent). Optimistic position patch; rollback on error. */
  const reorderItemMutation = useMutation<
    unknown,
    Error,
    { itemId: string; position: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await reorderItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const existing = previous.items.find((i) => i.id === vars.itemId);
        if (existing) {
          qc.setQueryData<BoardCache>(
            key,
            replaceItem(previous, { ...existing, position: vars.position }),
          );
        }
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /**
   * Rename an item. Optimistic: patch the cache immediately with the new name,
   * roll back on error. The Realtime UPDATE echo is idempotent (same id/name).
   */
  const renameItemMutation = useMutation<unknown, Error, RenameItemVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await renameItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const existing = previous.items.find((i) => i.id === vars.itemId);
        if (existing) {
          qc.setQueryData<BoardCache>(
            key,
            replaceItem(previous, { ...existing, name: vars.name }),
          );
        }
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const renameGroupMutation = useMutation<unknown, Error, RenameGroupVars, Ctx>(
    {
      mutationFn: async (vars) => {
        const res = await renameGroup(vars);
        if (!res.ok) throw new Error(res.error);
        return res;
      },
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<BoardCache>(key);
        if (previous) {
          const existing = previous.groups.find((g) => g.id === vars.groupId);
          if (existing) {
            qc.setQueryData<BoardCache>(
              key,
              replaceGroup(previous, { ...existing, name: vars.name }),
            );
          }
        }
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      },
    },
  );

  const reorderGroupMutation = useMutation<
    unknown,
    Error,
    { groupId: string; position: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await reorderGroup(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const existing = previous.groups.find((g) => g.id === vars.groupId);
        if (existing) {
          qc.setQueryData<BoardCache>(
            key,
            replaceGroup(previous, { ...existing, position: vars.position }),
          );
        }
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const setGroupColorMutation = useMutation<
    unknown,
    Error,
    { groupId: string; color: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await updateGroupColor(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const existing = previous.groups.find((g) => g.id === vars.groupId);
        if (existing) {
          qc.setQueryData<BoardCache>(
            key,
            replaceGroup(previous, { ...existing, color: vars.color }),
          );
        }
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const deleteGroupMutation = useMutation<
    unknown,
    Error,
    { groupId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteGroup(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeGroup(previous, vars.groupId));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  const renameBoardMutation = useMutation<unknown, Error, RenameBoardVars, Ctx>(
    {
      mutationFn: async (vars) => {
        const res = await renameBoard({ boardId, name: vars.name });
        if (!res.ok) throw new Error(res.error);
        return res;
      },
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<BoardCache>(key);
        if (previous) {
          qc.setQueryData<BoardCache>(
            key,
            replaceBoard(previous, { ...previous.board, name: vars.name }),
          );
        }
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      },
    },
  );

  const resizeNameColumnMutation = useMutation<
    unknown,
    Error,
    ResizeNameColumnVars,
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await resizeNameColumn({ boardId, width: vars.width });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          replaceBoard(previous, {
            ...previous.board,
            name_column_width: vars.width,
          }),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /**
   * Add a dependency. Non-optimistic: we do NOT insert into the cache here.
   * The Realtime INSERT echo will arrive in ms and `addDependency` is idempotent,
   * so we let realtime own the cache update. This avoids needing to reconstruct
   * the full CacheDependency row client-side (the server assigns id/org_id/etc).
   */
  const addDependencyMutation = useMutation<void, Error, AddDependencyVars>({
    mutationFn: async (vars) => {
      const res = await createDependency(vars);
      if (!res.ok) throw new Error(res.error);
    },
  });

  /**
   * Remove a dependency. Optimistic: remove from cache immediately, roll back
   * on error. Mirror of clearCellMutation.
   */
  const removeDependencyMutation = useMutation<
    unknown,
    Error,
    RemoveDependencyVars,
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteDependency(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          removeDependency(previous, vars.dependencyId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /**
   * Upload a file into a Files-column cell. Client-direct upload to the
   * `attachments` bucket (mirrors `useAttachmentMutations`), then registers the
   * metadata row via `createAttachment` with the column id. On success the real
   * row is constructed from known fields + the returned id and prepended into
   * the board cache; the Realtime INSERT echo is idempotent via
   * `prependColumnFile`. Non-optimistic insert (we wait for the server id), but
   * a failed register cleans up the orphaned object.
   */
  const uploadColumnFileMutation = useMutation<
    { attachment: CacheAttachment },
    Error,
    { itemId: string; columnId: string; file: File }
  >({
    mutationFn: async ({ itemId, columnId, file }) => {
      if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 50 MB.");
      if (file.size === 0) throw new Error("File is empty.");

      const cache = qc.getQueryData<BoardCache>(key);
      if (!cache) throw new Error("Board not loaded.");
      const orgId = cache.board.org_id;
      const path = buildColumnFilePath({
        orgId,
        boardId,
        itemId,
        columnId,
        fileName: file.name,
      });
      const mimeType = file.type || "application/octet-stream";

      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, file, { contentType: mimeType });
      if (upErr) throw new Error(upErr.message);

      const res = await createAttachment({
        itemId,
        columnId,
        storagePath: path,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
      if (!res.ok) {
        // Best-effort orphan cleanup if the register failed.
        await supabase.storage.from("attachments").remove([path]);
        throw new Error(res.error);
      }

      // Resolve the uploader for the cache row (create returns only the id).
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const attachment: CacheAttachment = {
        id: res.data.attachmentId,
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: columnId,
        update_id: null,
        uploaded_by: user?.id ?? "",
        storage_path: path,
        file_name: file.name,
        mime_type: mimeType,
        size_bytes: file.size,
        created_at: new Date().toISOString(),
      } as CacheAttachment;
      return { attachment };
    },
    onSuccess: ({ attachment }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? prependColumnFile(prev, attachment) : prev,
      );
    },
  });

  // ─── Time-tracking mutations ────────────────────────────────────────────────

  /** Start a timer: stops any running timer + starts a new one (atomic RPC).
   *  Upserts ALL returned entries (stopped row(s) + new running row). */
  const startTimerMutation = useMutation<
    { entries: CacheTimeEntry[] },
    Error,
    { itemId: string; columnId: string }
  >({
    mutationFn: async (vars) => {
      const res = await startTimer(vars);
      if (!res.ok) throw new Error(res.error);
      return { entries: res.data.entries as CacheTimeEntry[] };
    },
    onSuccess: ({ entries }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? entries.reduce((c, e) => upsertTimeEntry(c, e), prev) : prev,
      );
    },
  });

  /** Stop a running entry: server computes duration → upsert the returned row. */
  const stopTimerMutation = useMutation<
    { entry: CacheTimeEntry },
    Error,
    { entryId: string }
  >({
    mutationFn: async (vars) => {
      const res = await stopTimer(vars);
      if (!res.ok) throw new Error(res.error);
      return { entry: res.data.entry as CacheTimeEntry };
    },
    onSuccess: ({ entry }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? upsertTimeEntry(prev, entry) : prev,
      );
    },
  });

  /** Add a completed entry retroactively → prepend into cache on success. */
  const addManualEntryMutation = useMutation<
    { entry: CacheTimeEntry },
    Error,
    { itemId: string; columnId: string; date: string; durationSecs: number }
  >({
    mutationFn: async (vars) => {
      const res = await addManualEntry(vars);
      if (!res.ok) throw new Error(res.error);
      return { entry: res.data.entry as CacheTimeEntry };
    },
    onSuccess: ({ entry }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? prependTimeEntry(prev, entry) : prev,
      );
    },
  });

  /** Edit a completed entry's date + duration → upsert returned row. */
  const editEntryMutation = useMutation<
    { entry: CacheTimeEntry },
    Error,
    { entryId: string; date: string; durationSecs: number }
  >({
    mutationFn: async (vars) => {
      const res = await editEntry(vars);
      if (!res.ok) throw new Error(res.error);
      return { entry: res.data.entry as CacheTimeEntry };
    },
    onSuccess: ({ entry }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? upsertTimeEntry(prev, entry) : prev,
      );
    },
  });

  /** Delete an entry: optimistic remove with rollback on error. */
  const deleteEntryMutation = useMutation<
    unknown,
    Error,
    { entryId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteEntry(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(
          key,
          removeTimeEntry(previous, vars.entryId),
        );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /** Set or clear the per-item estimate: optimistic cell write (mirrors setCell/clearCellMutation). */
  const setEstimateMutation = useMutation<
    unknown,
    Error,
    { itemId: string; columnId: string; estimateSeconds: number | null },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await setEstimate(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const next =
          vars.estimateSeconds == null
            ? removeCellValue(previous, vars.itemId, vars.columnId)
            : upsertCellValue(previous, {
                org_id: previous.board.org_id,
                board_id: previous.board.id,
                item_id: vars.itemId,
                column_id: vars.columnId,
                value: {
                  estimateSeconds: vars.estimateSeconds,
                } as CacheCellValue["value"],
                updated_at: new Date().toISOString(),
              } as CacheCellValue);
        qc.setQueryData<BoardCache>(key, next);
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  // ─── End time-tracking mutations ────────────────────────────────────────────

  /** Delete a Files-column attachment. Optimistic remove; rollback on error. */
  const deleteColumnFileMutation = useMutation<
    unknown,
    Error,
    { attachmentId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteAttachment(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(
          key,
          removeColumnFile(previous, vars.attachmentId),
        );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /** Replace a relation cell's links. Optimistic; rollback on error. */
  const setRelationLinksMutation = useMutation<
    unknown,
    Error,
    SetRelationVars,
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await setRelationLinks({
        itemId: vars.itemId,
        columnId: vars.columnId,
        linkedItemIds: vars.links.map((l) => l.linkedItemId),
      });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(
          key,
          setRelationLinksForCell(
            previous,
            vars.itemId,
            vars.columnId,
            vars.links,
          ),
        );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

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
    deleteItem: (itemId: string) => deleteItemMutation.mutate({ itemId }),
    reorderItem: (itemId: string, position: number) =>
      reorderItemMutation.mutate({ itemId, position }),
    renameItem: (vars: RenameItemVars) => renameItemMutation.mutate(vars),
    renameGroup: (groupId: string, name: string) =>
      renameGroupMutation.mutate({ groupId, name }),
    reorderGroup: (groupId: string, position: number) =>
      reorderGroupMutation.mutate({ groupId, position }),
    setGroupColor: (groupId: string, color: string) =>
      setGroupColorMutation.mutate({ groupId, color }),
    deleteGroup: (groupId: string) => deleteGroupMutation.mutate({ groupId }),
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
    addColumn: (kind: ColumnKind, settings?: Record<string, unknown>) =>
      addColumnMutation.mutate({ kind, settings }),
    renameColumn: (columnId: string, name: string) =>
      renameColumnMutation.mutate({ columnId, name }),
    resizeColumn: (columnId: string, width: number) =>
      resizeColumnMutation.mutate({ columnId, width }),
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
