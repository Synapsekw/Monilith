"use client";

import { useMutation } from "@tanstack/react-query";
import {
  addManualEntry,
  deleteEntry,
  editEntry,
  setEstimate,
  startTimer,
  stopTimer,
} from "@/lib/boards/time-actions";
import {
  prependTimeEntry,
  removeCellValue,
  removeTimeEntry,
  upsertCellValue,
  upsertTimeEntry,
  type BoardCache,
  type CacheCellValue,
  type CacheTimeEntry,
} from "@/lib/boards/cache";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { BoardMutationCtx, Ctx } from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

// ─── Time-tracking mutations ────────────────────────────────────────────────

/** Time-tracking mutations: timers, manual entries, and the per-item estimate. */
export function useTimeMutations(ctx: BoardMutationCtx) {
  const { qc, key, rollback, cellRollback } = ctx;

  /** Start a timer: stops any running timer + starts a new one (atomic RPC).
   *  Upserts ALL returned entries (stopped row(s) + new running row). */
  const startTimerMutation = useMutation<
    { entries: CacheTimeEntry[] },
    Error,
    { itemId: string; columnId: string }
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await startTimer(vars);
      if (!res.ok) throw new Error(res.error);
      return { entries: res.data.entries as CacheTimeEntry[] };
    },
    onSuccess: ({ entries }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? entries.reduce((c, e) => upsertTimeEntry(c, e), prev) : prev,
      );
    },
    onError: (err) => {
      showMutationError("Couldn't start the timer.", err);
    },
  });

  /** Stop a running entry: server computes duration → upsert the returned row. */
  const stopTimerMutation = useMutation<
    { entry: CacheTimeEntry },
    Error,
    { entryId: string }
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await stopTimer(vars);
      if (!res.ok) throw new Error(res.error);
      return { entry: res.data.entry as CacheTimeEntry };
    },
    onSuccess: ({ entry }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? upsertTimeEntry(prev, entry) : prev,
      );
    },
    onError: (err) => {
      showMutationError("Couldn't stop the timer.", err);
    },
  });

  /** Add a completed entry retroactively → prepend into cache on success. */
  const addManualEntryMutation = useMutation<
    { entry: CacheTimeEntry },
    Error,
    { itemId: string; columnId: string; date: string; durationSecs: number }
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await addManualEntry(vars);
      if (!res.ok) throw new Error(res.error);
      return { entry: res.data.entry as CacheTimeEntry };
    },
    onSuccess: ({ entry }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? prependTimeEntry(prev, entry) : prev,
      );
    },
    onError: (err) => {
      showMutationError("Couldn't add the time entry.", err);
    },
  });

  /** Edit a completed entry's date + duration → upsert returned row. */
  const editEntryMutation = useMutation<
    { entry: CacheTimeEntry },
    Error,
    { entryId: string; date: string; durationSecs: number }
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await editEntry(vars);
      if (!res.ok) throw new Error(res.error);
      return { entry: res.data.entry as CacheTimeEntry };
    },
    onSuccess: ({ entry }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? upsertTimeEntry(prev, entry) : prev,
      );
    },
    onError: (err) => {
      showMutationError("Couldn't save the time entry.", err);
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
      assertOnline();
      const res = await deleteEntry(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return {};
      const prior = previous.timeEntries.find((t) => t.id === vars.entryId);
      qc.setQueryData<BoardCache>(key, removeTimeEntry(previous, vars.entryId));
      return { rollback: (c) => (prior ? upsertTimeEntry(c, prior) : c) };
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't delete the time entry — it was restored.",
        err,
      );
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
      assertOnline();
      const res = await setEstimate(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return {};
      const prior = previous.cellValues.find(
        (c) => c.item_id === vars.itemId && c.column_id === vars.columnId,
      );
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
      return { rollback: cellRollback(prior, vars.itemId, vars.columnId) };
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't save the estimate — your change was undone.",
        err,
      );
    },
  });

  return {
    startTimerMutation,
    stopTimerMutation,
    addManualEntryMutation,
    editEntryMutation,
    deleteEntryMutation,
    setEstimateMutation,
  };
}

// ─── End time-tracking mutations ────────────────────────────────────────────
