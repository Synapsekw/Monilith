import { create } from "zustand";
import type { IntelSelection } from "@/lib/boards/intelligence/types";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";

/**
 * Ephemeral bridge between the Intelligence strip (inside
 * BoardIntelligenceProvider) and the board dock (its sibling in the page).
 * Pure client UI state: never persisted, never a server round-trip. Requests
 * are nonce-stamped commands — the consumer clears exactly the request it
 * handled, so a request issued while another is in flight is never lost.
 */
export type DockTab = "chat" | "intelligence";
export type OpenRequest = { boardId: string; nonce: number; run: boolean };
export type FilterRequest = {
  boardId: string;
  selection: IntelSelection;
  nonce: number;
};

export interface BoardIntelligenceStoreState {
  runs: Record<string, BoardIntelligenceRun | null>;
  openRequest: OpenRequest | null;
  filterRequest: FilterRequest | null;
  /**
   * A write (apply, undo or dismiss) is in flight for this board.
   *
   * It lives in the STORE rather than in the tab, because the tab unmounts the
   * moment the reader switches to Chat or closes the dock — and a guard that
   * unmounts is not a guard: the second apply would capture its `before` values
   * after the first write had landed, so the undo restored what the first write
   * had just written. One write per board at a time, held somewhere that
   * outlives the panel.
   */
  busy: Record<string, boolean>;
  setRun: (boardId: string, run: BoardIntelligenceRun | null) => void;
  setBusy: (boardId: string, busy: boolean) => void;
  requestOpen: (boardId: string, opts?: { run?: boolean }) => void;
  consumeOpen: (nonce: number) => void;
  requestFilter: (boardId: string, selection: IntelSelection) => void;
  consumeFilter: (nonce: number) => void;
}

let nonce = 0;
const nextNonce = () => ++nonce;

export const useBoardIntelligenceStore = create<BoardIntelligenceStoreState>()(
  (set) => ({
    runs: {},
    openRequest: null,
    filterRequest: null,
    busy: {},
    setRun: (boardId, run) =>
      set((s) => ({ runs: { ...s.runs, [boardId]: run } })),
    setBusy: (boardId, busy) =>
      set((s) =>
        Boolean(s.busy[boardId]) === busy
          ? {}
          : { busy: { ...s.busy, [boardId]: busy } },
      ),
    requestOpen: (boardId, opts) =>
      set({
        openRequest: { boardId, nonce: nextNonce(), run: opts?.run ?? false },
      }),
    consumeOpen: (n) =>
      set((s) => (s.openRequest?.nonce === n ? { openRequest: null } : {})),
    requestFilter: (boardId, selection) =>
      set({ filterRequest: { boardId, selection, nonce: nextNonce() } }),
    consumeFilter: (n) =>
      set((s) => (s.filterRequest?.nonce === n ? { filterRequest: null } : {})),
  }),
);

/** Badge count: suggestions − dismissed − applied. */
export function unresolvedCount(run: BoardIntelligenceRun | null): number {
  if (!run) return 0;
  const gone = new Set([...run.dismissed, ...run.applied]);
  return run.payload.suggestions.filter((s) => !gone.has(s.id)).length;
}
