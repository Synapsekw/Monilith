"use client";

import { useMutation } from "@tanstack/react-query";
import {
  archiveGroup,
  createGroup,
  renameGroup,
  reorderGroup,
  restoreGroup,
  updateGroupColor,
} from "@/lib/boards/actions";
import {
  insertGroup,
  removeGroup,
  type BoardCache,
  type CacheGroup,
} from "@/lib/boards/cache";
import { showMutationError, showUndoToast } from "@/lib/ui/mutation-toast";
import type { BoardMutationCtx, Ctx, RenameGroupVars } from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

/** Group mutations: add/rename/reorder/color/archive/restore. */
export function useGroupMutations(ctx: BoardMutationCtx) {
  const { qc, key, boardId, rollback, resyncOnError, optimisticGroupField } =
    ctx;

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
      assertOnline();
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

  const renameGroupMutation = useMutation<unknown, Error, RenameGroupVars, Ctx>(
    {
      mutationFn: async (vars) => {
        assertOnline();
        const res = await renameGroup(vars);
        if (!res.ok) throw new Error(res.error);
        return res;
      },
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        return optimisticGroupField(vars.groupId, { name: vars.name });
      },
      onError: (err, _vars, ctx) => {
        rollback(ctx);
        showMutationError(
          "Couldn't rename the group — your change was undone.",
          err,
        );
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
      assertOnline();
      const res = await reorderGroup(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticGroupField(vars.groupId, { position: vars.position });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't reorder the group — your change was undone.",
        err,
      );
    },
  });

  const setGroupColorMutation = useMutation<
    unknown,
    Error,
    { groupId: string; color: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await updateGroupColor(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticGroupField(vars.groupId, { color: vars.color });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't change the group color — your change was undone.",
        err,
      );
    },
  });

  /**
   * Restore an archived group (+ its same-batch items). Non-optimistic: resync
   * on success to rehydrate the restored subtree. Undo handler for archiveGroup.
   */
  const restoreGroupMutation = useMutation<unknown, Error, { groupId: string }>(
    {
      mutationFn: async (vars) => {
        assertOnline();
        const res = await restoreGroup(vars);
        if (!res.ok) throw new Error(res.error);
        return res;
      },
      onSuccess: () => resyncOnError(),
      onError: (err) => {
        showMutationError("Couldn't restore the group.", err);
      },
    },
  );

  /**
   * Archive a group (soft-delete → Trash; cascades to its live items + their
   * subitems). Optimistic remove; resync on failure. On success fire an Undo
   * toast whose action restores the group via restoreGroupMutation.
   */
  const archiveGroupMutation = useMutation<
    unknown,
    Error,
    { groupId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await archiveGroup(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    // Cascade archive (group + its items + their cells): resync from the server
    // on failure rather than reconstruct the removed subtree by hand.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeGroup(previous, vars.groupId));
      return {};
    },
    onError: (err) => {
      resyncOnError();
      showMutationError("Couldn't delete the group — it was restored.", err);
    },
    onSuccess: (_d, vars) =>
      showUndoToast("Group moved to Trash", () =>
        restoreGroupMutation.mutate(vars),
      ),
  });

  return {
    addGroupMutation,
    renameGroupMutation,
    reorderGroupMutation,
    setGroupColorMutation,
    restoreGroupMutation,
    archiveGroupMutation,
  };
}
