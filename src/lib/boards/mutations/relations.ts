"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createDependency,
  deleteDependency,
} from "@/lib/boards/dependency-actions";
import { setRelationLinks } from "@/lib/boards/relation-actions";
import {
  addDependency,
  removeDependency,
  setRelationLinksForCell,
  type BoardCache,
} from "@/lib/boards/cache";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type {
  AddDependencyVars,
  BoardMutationCtx,
  Ctx,
  RemoveDependencyVars,
  SetRelationVars,
} from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

/** Dependency + relation-link mutations. */
export function useRelationMutations(ctx: BoardMutationCtx) {
  const { qc, key, rollback } = ctx;

  /**
   * Add a dependency. Non-optimistic: we do NOT insert into the cache here.
   * The Realtime INSERT echo will arrive in ms and `addDependency` is idempotent,
   * so we let realtime own the cache update. This avoids needing to reconstruct
   * the full CacheDependency row client-side (the server assigns id/org_id/etc).
   */
  const addDependencyMutation = useMutation<void, Error, AddDependencyVars>({
    mutationFn: async (vars) => {
      assertOnline();
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
      assertOnline();
      const res = await deleteDependency(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return {};
      const prior = previous.dependencies.find(
        (d) => d.id === vars.dependencyId,
      );
      qc.setQueryData<BoardCache>(
        key,
        removeDependency(previous, vars.dependencyId),
      );
      return { rollback: (c) => (prior ? addDependency(c, prior) : c) };
    },
    onError: (err, _vars, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't remove the dependency — it was restored.",
        err,
      );
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
      assertOnline();
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
      if (!previous) return {};
      const prior = previous.relationLinks.filter(
        (l) => l.itemId === vars.itemId && l.columnId === vars.columnId,
      );
      qc.setQueryData<BoardCache>(
        key,
        setRelationLinksForCell(
          previous,
          vars.itemId,
          vars.columnId,
          vars.links,
        ),
      );
      return {
        rollback: (c) =>
          setRelationLinksForCell(c, vars.itemId, vars.columnId, prior),
      };
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't update the connection — your change was undone.",
        err,
      );
    },
  });

  return {
    addDependencyMutation,
    removeDependencyMutation,
    setRelationLinksMutation,
  };
}
