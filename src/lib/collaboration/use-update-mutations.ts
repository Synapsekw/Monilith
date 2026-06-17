"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addUpdate,
  editUpdate,
  deleteUpdate,
} from "@/lib/collaboration/actions";
import {
  prependUpdate,
  replaceUpdate,
  removeUpdate,
  type ItemUpdate,
  type UpdatesCache,
} from "@/lib/collaboration/cache";
import {
  itemActivityKey,
  itemUpdatesKey,
} from "@/lib/collaboration/use-item-collab";

type Ctx = { previous?: UpdatesCache; optimisticId?: string };

export function useUpdateMutations(
  itemId: string,
  authorId: string,
  ctx: { orgId: string; boardId: string },
) {
  const qc = useQueryClient();
  const key = itemUpdatesKey(itemId);

  const add = useMutation<{ updateId: string }, Error, { text: string }, Ctx>({
    mutationFn: async (vars) => {
      const res = await addUpdate({ itemId, text: vars.text });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      const optimisticId = `optimistic-${Date.now()}`;
      const optimistic: ItemUpdate = {
        id: optimisticId,
        org_id: ctx.orgId,
        board_id: ctx.boardId,
        item_id: itemId,
        author_id: authorId,
        body: { text: vars.text },
        body_text: vars.text,
        edited_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as ItemUpdate;
      // Seed an empty cache if the fetch hasn't resolved yet so the optimistic
      // row always shows immediately.
      qc.setQueryData<UpdatesCache>(
        key,
        prependUpdate(previous ?? { updates: [] }, optimistic),
      );
      return { previous, optimisticId };
    },
    onError: (_e, _v, c) => {
      qc.setQueryData<UpdatesCache>(key, (prev) =>
        c?.optimisticId && prev ? removeUpdate(prev, c.optimisticId) : prev,
      );
    },
    onSuccess: (data, _v, c) => {
      // Swap the optimistic temp for a real-id row so it survives regardless of
      // Realtime timing; the Realtime INSERT echo dedupes on this id.
      qc.setQueryData<UpdatesCache>(key, (prev) =>
        c?.optimisticId && prev
          ? {
              updates: prev.updates.map((u) =>
                u.id === c.optimisticId ? { ...u, id: data.updateId } : u,
              ),
            }
          : prev,
      );
      // The `update_added` activity is written by a trigger in the same
      // transaction — refetch so it shows deterministically (Realtime dedupes).
      qc.invalidateQueries({ queryKey: itemActivityKey(itemId) });
    },
  });

  const edit = useMutation<
    void,
    Error,
    { update: ItemUpdate; text: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await editUpdate({
        updateId: vars.update.id,
        text: vars.text,
      });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      if (previous) {
        qc.setQueryData<UpdatesCache>(
          key,
          replaceUpdate(previous, {
            ...vars.update,
            body: { text: vars.text },
            body_text: vars.text,
            edited_at: new Date().toISOString(),
          }),
        );
      }
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
  });

  const remove = useMutation<void, Error, { updateId: string }, Ctx>({
    mutationFn: async (vars) => {
      const res = await deleteUpdate({ updateId: vars.updateId });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      if (previous)
        qc.setQueryData<UpdatesCache>(
          key,
          removeUpdate(previous, vars.updateId),
        );
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
  });

  return {
    addUpdate: (text: string) => add.mutate({ text }),
    editUpdate: (update: ItemUpdate, text: string) =>
      edit.mutate({ update, text }),
    deleteUpdate: (updateId: string) => remove.mutate({ updateId }),
    isAdding: add.isPending,
  };
}
