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
  /**
   * Is a write in flight for this board?
   *
   * A guard, not a spinner's bookkeeping: a double-click on Apply used to send
   * two `applySuggestion` calls, and the SECOND one captured its `before`
   * values AFTER the first write had already landed — so its undo restored the
   * value the first write had just written, and the change became un-undoable.
   * The disabled button is the visible half; this is the half that holds when
   * the click beats the render.
   *
   * It is per BOARD and lives in the store, not per suggestion in this hook:
   * component state dies with the panel (switch to Chat, close the dock) and
   * takes the guard with it, and `applied`/`dismissed` are one jsonb array per
   * run — two suggestions written at once read-modify-write the same list, so
   * one of the two marks is lost. Serialising every write on the board is what
   * makes both of those impossible.
   */
  const busy = useBoardIntelligenceStore((s) => s.busy[boardId] ?? false);
  const setBusy = useBoardIntelligenceStore((s) => s.setBusy);
  /** Read the CURRENT flag, not the value this render closed over — a second
   *  click in the same tick must see the first one's mark. */
  const claim = useCallback(() => {
    if (useBoardIntelligenceStore.getState().busy[boardId]) return false;
    setBusy(boardId, true);
    return true;
  }, [boardId, setBusy]);

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
      if (!run || !claim()) return;
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
      } finally {
        setBusy(boardId, false);
      }
    },
    [boardId, claim, run, setBusy, setRun],
  );

  const apply = useCallback(
    async (suggestionId: string, actionIndex: number) => {
      if (!run) return;
      const action = run.payload.suggestions.find((s) => s.id === suggestionId)
        ?.actions[actionIndex];
      if (!action) return;
      if (action.type === "filter") {
        // `subject` is what makes an `overloaded` chip select anything — it is
        // one signal PER PERSON, so the kind alone matches nothing.
        requestFilter(boardId, {
          kind: action.signalKind,
          ...(action.subject ? { subject: action.subject } : {}),
        });
        return;
      }
      // Second guard, not the first: the button is never rendered for a viewer.
      if (!opts.canApply) return;
      if (!claim()) return;
      const runId = run.id;
      setError(null);
      try {
        const res = await applySuggestion({
          runId,
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
              runId,
              suggestionId,
              before,
              updateIds,
            });
            if (!undo.ok) {
              showMutationError("Couldn't undo.", new Error(undo.error));
              return;
            }
            applyBoardEffects(undo.data.effects);
            // The board cells are reverted either way — but the BRIEF this undo
            // belongs to may no longer be the one on screen. Eight seconds is
            // long enough for a Refresh to land, and writing the old run back
            // over a newer one would silently replace the brief the user is
            // reading with a stale one.
            if (
              useBoardIntelligenceStore.getState().runs[boardId]?.id === runId
            ) {
              setRun(boardId, undo.data.run);
            }
          })();
        });
      } catch {
        setError("Couldn't apply the suggestion.");
      } finally {
        setBusy(boardId, false);
      }
    },
    [
      applyBoardEffects,
      boardId,
      claim,
      opts.canApply,
      requestFilter,
      run,
      setBusy,
      setRun,
    ],
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
    /** A write is in flight on this board — every card's buttons are inert. */
    pending: busy,
    visible,
    catchMeUp,
    refresh,
    dismiss,
    apply,
  };
}

export type IntelligenceRunState = ReturnType<typeof useIntelligenceRun>;
export type { BoardIntelligenceRun };
