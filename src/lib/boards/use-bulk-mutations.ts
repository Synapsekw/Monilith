"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bulkDeleteItems,
  bulkMoveItems,
  bulkSetCell,
  type BulkOutcome,
} from "@/lib/boards/bulk-actions";
import {
  moveItemToGroup,
  removeItem,
  upsertCellValue,
  removeCellValue,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import { showMutationError } from "@/lib/ui/mutation-toast";

/**
 * Bulk (multi-item) board mutations for the Table view's floating action bar.
 * Kept in a dedicated hook (not folded into useBoardMutations) so the single-item
 * hot path stays untouched.
 *
 * Optimism + reconciliation model (consistent with useBoardMutations' cascade
 * mutations): apply the change to the whole selection optimistically, then —
 * because a bulk op's precise per-item inverse is intertwined and a PARTIAL
 * failure leaves the cache half-applied — reconcile by resyncing the board from
 * the server whenever the network throws OR the server reports any failed item.
 * On a clean all-succeeded result we hold the optimistic cache (Realtime keeps it
 * fresh), so the happy path stays 0 refetches. Every failure path shows the
 * shared error toast naming HOW MANY failed — never a silent drop.
 */
export function useBulkMutations(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);

  function resync() {
    void qc.invalidateQueries({ queryKey: key });
  }

  /** Surface the outcome: resync + toast on partial failure; nothing on success. */
  function reconcile(outcome: BulkOutcome, verb: string) {
    if (outcome.failed.length === 0) return;
    resync();
    const n = outcome.failed.length;
    showMutationError(
      `Couldn't ${verb} ${n} of ${outcome.succeeded.length + n} items — they were restored.`,
      new Error(outcome.failed[0]?.error ?? "Some items failed."),
    );
  }

  const deleteMutation = useMutation<BulkOutcome, Error, { itemIds: string[] }>(
    {
      mutationFn: async ({ itemIds }) => {
        const res = await bulkDeleteItems({ itemIds });
        if (!res.ok) throw new Error(res.error);
        return res.data;
      },
      onMutate: async ({ itemIds }) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<BoardCache>(key);
        if (previous) {
          qc.setQueryData<BoardCache>(
            key,
            itemIds.reduce((c, id) => removeItem(c, id), previous),
          );
        }
      },
      onSuccess: (outcome) => reconcile(outcome, "delete"),
      onError: (err) => {
        resync();
        showMutationError(
          "Couldn't delete the items — they were restored.",
          err,
        );
      },
    },
  );

  const moveMutation = useMutation<
    BulkOutcome,
    Error,
    { itemIds: string[]; groupId: string }
  >({
    mutationFn: async ({ itemIds, groupId }) => {
      const res = await bulkMoveItems({ itemIds, groupId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: async ({ itemIds, groupId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          itemIds.reduce((c, id) => moveItemToGroup(c, id, groupId), previous),
        );
      }
    },
    onSuccess: (outcome) => reconcile(outcome, "move"),
    onError: (err) => {
      resync();
      showMutationError("Couldn't move the items — they were restored.", err);
    },
  });

  const setCellMutation = useMutation<
    BulkOutcome,
    Error,
    {
      itemIds: string[];
      columnId: string;
      value: Record<string, unknown> | null;
    }
  >({
    mutationFn: async ({ itemIds, columnId, value }) => {
      const res = await bulkSetCell({ itemIds, columnId, value });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: async ({ itemIds, columnId, value }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return;
      const next = itemIds.reduce((c, itemId) => {
        if (value === null) return removeCellValue(c, itemId, columnId);
        const cell: CacheCellValue = {
          org_id: previous.board.org_id,
          board_id: previous.board.id,
          item_id: itemId,
          column_id: columnId,
          value: value as CacheCellValue["value"],
          updated_at: new Date().toISOString(),
        };
        return upsertCellValue(c, cell);
      }, previous);
      qc.setQueryData<BoardCache>(key, next);
    },
    onSuccess: (outcome) => reconcile(outcome, "update"),
    onError: (err) => {
      resync();
      showMutationError(
        "Couldn't update the items — your change was undone.",
        err,
      );
    },
  });

  return {
    bulkDelete: (itemIds: string[]) => deleteMutation.mutate({ itemIds }),
    bulkMove: (itemIds: string[], groupId: string) =>
      moveMutation.mutate({ itemIds, groupId }),
    bulkSetCell: (
      itemIds: string[],
      columnId: string,
      value: Record<string, unknown> | null,
    ) => setCellMutation.mutate({ itemIds, columnId, value }),
  };
}
