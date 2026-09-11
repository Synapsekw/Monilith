"use client";

import { useCallback, useMemo, useState } from "react";
import {
  applySuggestion,
  revertSuggestion,
} from "@/lib/ai/board-intelligence/apply";
import {
  dismissSuggestion,
  runBoardIntelligence,
} from "@/lib/ai/board-intelligence/run";
import type {
  BoardIntelligenceRun,
  Suggestion,
} from "@/lib/ai/board-intelligence/runs";
import { INTELLIGENCE_STALE_MS } from "@/lib/boards/intelligence/constants";
import { useApplyBoardEffects } from "@/lib/boards/use-ai-effects";
import { showMutationError, showUndoToast } from "@/lib/ui/mutation-toast";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";

/**
 * Everything the Intelligence tab does, minus the markup.
 *
 * Fetching budget (working agreement #5): the run is handed in by the page and
 * lives in the store, so OPENING the tab reads nothing. The only server calls
 * are the four deliberate ones — run, dismiss, apply, revert — and every one of
 * them returns the updated run, so nothing here ever revalidates a path or
 * refreshes the router (gotcha-09).
 *
 * A `filter` action is refused server-side on purpose: it changes what the user
 * is LOOKING at, not what the board says, so it is a store request the strip
 * picks up — no round-trip at all.
 */
export function useIntelligenceRun(
  boardId: string,
  opts: { canApply: boolean },
) {
  const run = useBoardIntelligenceStore((s) => s.runs[boardId] ?? null);
  const setRun = useBoardIntelligenceStore((s) => s.setRun);
  const requestFilter = useBoardIntelligenceStore((s) => s.requestFilter);
  const applyBoardEffects = useApplyBoardEffects();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The clock "how old is this brief" is measured against.
   *
   * Snapshotted rather than read in render, because `Date.now()` in render is
   * impure (react-hooks/purity) — the same idiom as `BoardIntelligenceProvider`
   * uses. It is RE-snapshotted on every completed run, which is not optional:
   * a tab left open for ten minutes and then refreshed would otherwise measure
   * a brand-new brief against a ten-minute-old "now" and report it as "in 10
   * minutes". The server stays the authority on staleness; this only decides
   * whether to offer a Refresh.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const runIt = useCallback(
    async (force: boolean) => {
      setRunning(true);
      setError(null);
      try {
        const res = await runBoardIntelligence({ boardId, force });
        if (res.ok) {
          setNowMs(Date.now());
          setRun(boardId, res.data);
        } else setError(res.error);
      } catch {
        setError("Couldn't read this board. Please try again.");
      } finally {
        setRunning(false);
      }
    },
    [boardId, setRun],
  );

  const catchMeUp = useCallback(() => runIt(false), [runIt]);
  const refresh = useCallback(() => runIt(true), [runIt]);

  const dismiss = useCallback(
    async (suggestionId: string) => {
      if (!run) return;
      const prev = run;
      // Optimistic: the card is the user's own decision, so it goes now and
      // comes back only if the server disagrees.
      setRun(boardId, { ...run, dismissed: [...run.dismissed, suggestionId] });
      setError(null);
      try {
        const res = await dismissSuggestion({ runId: run.id, suggestionId });
        if (res.ok) setRun(boardId, res.data);
        else {
          setRun(boardId, prev);
          setError(res.error);
        }
      } catch {
        setRun(boardId, prev);
        setError("Couldn't dismiss.");
      }
    },
    [boardId, run, setRun],
  );

  const apply = useCallback(
    async (suggestionId: string, actionIndex: number) => {
      if (!run) return;
      const action = run.payload.suggestions.find((s) => s.id === suggestionId)
        ?.actions[actionIndex];
      if (!action) return;
      if (action.type === "filter") {
        requestFilter(boardId, { kind: action.signalKind });
        return;
      }
      // Second guard, not the first: the button is never rendered for a viewer.
      if (!opts.canApply) return;
      setError(null);
      try {
        const res = await applySuggestion({
          runId: run.id,
          suggestionId,
          actionIndex,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        applyBoardEffects(res.data.effects);
        setRun(boardId, res.data.run);
        const { before, updateIds } = res.data;
        showUndoToast("Applied", () => {
          void (async () => {
            const undo = await revertSuggestion({
              runId: run.id,
              suggestionId,
              before,
              updateIds,
            });
            if (!undo.ok) {
              showMutationError("Couldn't undo.", new Error(undo.error));
              return;
            }
            applyBoardEffects(undo.data.effects);
            setRun(boardId, undo.data.run);
          })();
        });
      } catch {
        setError("Couldn't apply the suggestion.");
      }
    },
    [applyBoardEffects, boardId, opts.canApply, requestFilter, run, setRun],
  );

  const visible = useMemo<Suggestion[]>(() => {
    if (!run) return [];
    const gone = new Set([...run.dismissed, ...run.applied]);
    return run.payload.suggestions.filter((s) => !gone.has(s.id));
  }, [run]);

  const staleByAge = run
    ? nowMs - Date.parse(run.generatedAt) >= INTELLIGENCE_STALE_MS
    : false;

  return {
    run,
    running,
    error,
    staleByAge,
    /** The tab's clock, so the timestamp and the staleness agree on "now". */
    nowMs,
    visible,
    catchMeUp,
    refresh,
    dismiss,
    apply,
  };
}

export type IntelligenceRunState = ReturnType<typeof useIntelligenceRun>;
export type { BoardIntelligenceRun };
