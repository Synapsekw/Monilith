"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addUpdate,
  editUpdate,
  deleteUpdate,
  type AddUpdateResult,
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
import { assertOnline } from "@/lib/offline/online-status";
import type { MentionTargetInput } from "@/lib/validations/collaboration-actions";

type Ctx = { previous?: UpdatesCache; optimisticId?: string };

export function useUpdateMutations(
  itemId: string,
  authorId: string,
  ctx: { orgId: string; boardId: string },
) {
  const qc = useQueryClient();
  const key = itemUpdatesKey(itemId);

  const add = useMutation<
    AddUpdateResult,
    Error,
    { text: string; mentions: MentionTargetInput[] },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await addUpdate({
        itemId,
        text: vars.text,
        mentions: vars.mentions,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<UpdatesCache>(key);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimistic: ItemUpdate = {
        id: optimisticId,
        org_id: ctx.orgId,
        board_id: ctx.boardId,
        item_id: itemId,
        author_id: authorId,
        body: { text: vars.text, mentions: vars.mentions },
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
    onSuccess: (data) => {
      // A summons that was refused — rate-limited, on cooldown, over the org's
      // daily cap, switched off, or not the author's agent — must SAY so. The
      // comment posted either way; without this the person is left waiting for
      // an answer that is never coming. No refetch is involved: this is the
      // action's own return value (working agreement #5).
      if (data.reason) toast.error(data.reason);
      else if (data.agentRun === "started")
        toast.success(
          data.agentHandle
            ? `@${data.agentHandle} is working on it…`
            : "Working on it…",
        );
      // Refetch the authoritative lists rather than hand-reconciling the
      // optimistic temp against the Realtime INSERT echo — the echo can arrive
      // before this callback and prepend a second real-id row that the id-swap
      // would then duplicate (and `staleTime: Infinity` would never heal). The
      // `update_added` activity is written by a trigger in the same transaction,
      // so it is present on refetch too. Realtime keeps both lists live after.
      qc.invalidateQueries({ queryKey: key });
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
      assertOnline();
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
      assertOnline();
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
    addUpdate: (text: string, mentions: MentionTargetInput[]) =>
      add.mutate({ text, mentions }),
    editUpdate: (update: ItemUpdate, text: string) =>
      edit.mutate({ update, text }),
    deleteUpdate: (updateId: string) => remove.mutate({ updateId }),
    isAdding: add.isPending,
  };
}
