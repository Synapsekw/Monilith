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
  setRun: (boardId: string, run: BoardIntelligenceRun | null) => void;
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
    setRun: (boardId, run) =>
      set((s) => ({ runs: { ...s.runs, [boardId]: run } })),
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
