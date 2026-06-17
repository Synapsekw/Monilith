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
import { itemUpdatesKey } from "@/lib/collaboration/use-item-collab";

type Ctx = { previous?: UpdatesCache };

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
      if (previous) {
        const optimistic: ItemUpdate = {
          id: `optimistic-${Date.now()}`,
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
        qc.setQueryData<UpdatesCache>(key, prependUpdate(previous, optimistic));
      }
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
    onSettled: () => {
      // Realtime INSERT echo carries the real row; drop the optimistic temp.
      qc.setQueryData<UpdatesCache>(key, (prev) =>
        prev
          ? {
              updates: prev.updates.filter(
                (u) => !u.id.startsWith("optimistic-"),
              ),
            }
          : prev,
      );
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
