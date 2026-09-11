"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BoardCache } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardFilterSort } from "@/lib/boards/use-board-filter-sort";
import {
  computeSignals,
  findActiveSignal,
  latestActivityISO,
  selectionEquals,
  signalSelection,
} from "./signals";
import type { IntelSelection, Signal } from "./types";

/**
 * Board Intelligence (Phase 1) — the one place signals are computed.
 *
 * Reads the LIVE React-Query board cache (optimistic + realtime edits included),
 * memoizes `computeSignals` on the cache's identity, and mirrors the active chip
 * to the URL through the board filter state (`intel=`; History API; zero RSC
 * re-runs — AGENTS.md working agreement #5).
 *
 * Two contexts on purpose: the strip needs everything; rows need only "am I in
 * the active set". `IntelMatchContext` is `null` when no chip is active and a
 * Set whose identity changes only when its CONTENTS change, so a cell edit that
 * recomputes signals does not re-render every memoized row.
 */
export type BoardIntelligenceValue = {
  signals: Signal[];
  selection: IntelSelection | null;
  activeSignal: Signal | null;
  intelItemIds: ReadonlySet<string> | null;
  lastChangeAt: string | null;
  nowMs: number;
  loading: boolean;
  toggle: (signal: Signal) => void;
  clear: () => void;
};

const BoardIntelligenceContext = createContext<BoardIntelligenceValue | null>(
  null,
);
const IntelMatchContext = createContext<ReadonlySet<string> | null>(null);

export type IntelMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

export function BoardIntelligenceProvider({
  boardId,
  initialData,
  members,
  lastSeenAt,
  currentUserId,
  children,
}: {
  boardId: string;
  initialData: BoardCache;
  members: readonly IntelMember[];
  /** board_visits.last_seen_at for the caller, or null on a first visit. */
  lastSeenAt: string | null;
  currentUserId: string;
  children: ReactNode;
}) {
  const query = useBoardCache(boardId, initialData);
  const cache = query.data ?? initialData;
  const loading = query.data === undefined;

  // One clock per mount (react-hooks/purity forbids Date.now() in render). The
  // signals are "as of page open"; the next navigation re-snapshots.
  const [now] = useState(() => new Date());
  const nowMs = now.getTime();

  const memberNames = useMemo(
    () =>
      new Map(
        members.map((m) => [m.userId, m.fullName ?? m.email ?? ""] as const),
      ),
    [members],
  );
  const lastSeen = useMemo(
    () => (lastSeenAt ? new Date(lastSeenAt) : null),
    [lastSeenAt],
  );

  const signals = useMemo(
    () =>
      computeSignals(cache, {
        now,
        lastSeenAt: lastSeen,
        currentUserId,
        memberNames,
      }),
    [cache, now, lastSeen, currentUserId, memberNames],
  );
  const lastChangeAt = useMemo(() => latestActivityISO(cache), [cache]);

  const filter = useBoardFilterSort();
  const selection = filter.state.intel;
  const setIntel = filter.setIntel;

  const activeSignal = useMemo(
    () => findActiveSignal(signals, selection),
    [signals, selection],
  );

  // Content-keyed so the Set's identity survives unrelated cache edits:
  // `computeSignals` returns a brand-new `Signal` object on every cache
  // change even when its `itemIds` are unchanged, so memoizing directly on
  // `activeSignal` would rebuild (and re-identify) the Set on every edit
  // elsewhere on the board. `idsKey` is its own memo (not recomputed on
  // every render) so the join only runs when `activeSignal` itself changes.
  const idsKey = useMemo(
    () => (activeSignal ? activeSignal.itemIds.join("\u0000") : null),
    [activeSignal],
  );
  // Built from `activeSignal!.itemIds` directly (not by re-splitting
  // `idsKey`) — splitting an empty-string `idsKey` (`"".split(...)`) would
  // yield `[""]`, a Set containing one empty string, not an empty Set.
  // `idsKey` is the memo key only; the Set's contents always come straight
  // from the signal. Deliberately keyed on `idsKey` alone, not `activeSignal`
  // — see the comment above `idsKey` for why.
  const intelItemIds = useMemo<ReadonlySet<string> | null>(
    () => (idsKey === null ? null : new Set(activeSignal!.itemIds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey],
  );

  const toggle = useCallback(
    (signal: Signal) => {
      const next = signalSelection(signal);
      setIntel(selectionEquals(selection, next) ? null : next);
    },
    [selection, setIntel],
  );
  const clear = useCallback(() => setIntel(null), [setIntel]);

  const value = useMemo<BoardIntelligenceValue>(
    () => ({
      signals,
      selection,
      activeSignal,
      intelItemIds,
      lastChangeAt,
      nowMs,
      loading,
      toggle,
      clear,
    }),
    [
      signals,
      selection,
      activeSignal,
      intelItemIds,
      lastChangeAt,
      nowMs,
      loading,
      toggle,
      clear,
    ],
  );

  return (
    <BoardIntelligenceContext.Provider value={value}>
      <IntelMatchContext.Provider value={intelItemIds}>
        {children}
      </IntelMatchContext.Provider>
    </BoardIntelligenceContext.Provider>
  );
}

/** Full strip state, or null when no provider is mounted (fails open). */
export function useBoardIntelligenceOptional(): BoardIntelligenceValue | null {
  return useContext(BoardIntelligenceContext);
}

/** The active chip's item set, or null when no chip / no provider. */
export function useIntelItemIds(): ReadonlySet<string> | null {
  return useContext(IntelMatchContext);
}

/** Per-row: true = matches the active chip, false = does not, null = no chip. */
export function useIntelMatch(itemId: string): boolean | null {
  const ids = useContext(IntelMatchContext);
  return ids === null ? null : ids.has(itemId);
}

/**
 * Stamps the active chip's tone on an ancestor of every row so the CSS rule in
 * globals.css (`[data-intel-tone] .intel-match`) can paint the 2px rule without
 * threading the tone through every view. `display: contents` keeps the views'
 * own flex/height layout untouched.
 */
export function IntelToneFrame({ children }: { children: ReactNode }) {
  const intel = useBoardIntelligenceOptional();
  return (
    <div className="contents" data-intel-tone={intel?.activeSignal?.tone}>
      {children}
    </div>
  );
}
