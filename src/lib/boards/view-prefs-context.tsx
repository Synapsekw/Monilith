"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { saveBoardViewPrefs } from "./view-prefs-actions";
import {
  MAX_PREF_IDS,
  type BoardViewPrefsState,
  type ResolvedBoardViewPrefs,
} from "@/lib/validations/view-prefs";

/**
 * Live owner of the user's board arrangement.
 *
 * Every toggle updates local state immediately — the UI never waits on the
 * network — and schedules one debounced write of the WHOLE blob. Coalescing to
 * a single upsert is what keeps a burst of collapses (or a drag through several
 * groups) at one round trip instead of one per click, and it means an in-page
 * interaction still costs 0 server READS (AGENTS.md working agreement #5).
 */

/** Debounce before a change is persisted. Bursts inside this window coalesce. */
export const SAVE_DEBOUNCE_MS = 800;

export type BoardViewPrefsApi = {
  collapsedGroups: Set<string>;
  expandedItems: Set<string>;
  /**
   * The saved filter query as it was at first paint. Deliberately NOT live:
   * the URL is authoritative once the session starts writing it, so consumers
   * use this only to seed.
   */
  initialFilterQuery: string;
  toggleGroupCollapsed: (groupId: string) => void;
  toggleItemExpanded: (itemId: string) => void;
  setActiveViewId: (viewId: string) => void;
  setFilterQuery: (query: string) => void;
  /** Drop remembered ids for groups/items that no longer exist on the board. */
  pruneTo: (live: { groupIds: string[]; itemIds: string[] }) => void;
};

const noop = () => {};

const BoardViewPrefsContext = createContext<BoardViewPrefsApi | null>(null);

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Fallback used when a view is rendered outside the provider (tests,
 * Storybook-style harnesses). Remembering an arrangement is a convenience, so
 * its absence must never break a board — but a purely inert object would not
 * "degrade to today's behaviour", it would FREEZE the UI: collapse and
 * expansion are state, so no-op togglers leave every group permanently open and
 * every sub-item permanently hidden. Real (unpersisted) local state is what
 * today's behaviour actually is, so that is what the no-provider path returns.
 *
 * The write-only half stays inert: with nowhere to persist to, recording the
 * active view or the filter query has no observable effect.
 */
function useLocalBoardViewPrefs(): BoardViewPrefsApi {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => setCollapsedGroups((prev) => toggleIn(prev, groupId)),
    [],
  );
  const toggleItemExpanded = useCallback(
    (itemId: string) => setExpandedItems((prev) => toggleIn(prev, itemId)),
    [],
  );

  return useMemo(
    () => ({
      collapsedGroups,
      expandedItems,
      initialFilterQuery: "",
      toggleGroupCollapsed,
      toggleItemExpanded,
      setActiveViewId: noop,
      setFilterQuery: noop,
      pruneTo: noop,
    }),
    [collapsedGroups, expandedItems, toggleGroupCollapsed, toggleItemExpanded],
  );
}

export function useBoardViewPrefs(): BoardViewPrefsApi {
  const ctx = useContext(BoardViewPrefsContext);
  // Called unconditionally (hook rules); the two useState cells are inert and
  // never read when a provider is mounted, which is every production path.
  const local = useLocalBoardViewPrefs();
  return ctx ?? local;
}

export function BoardViewPrefsProvider({
  boardId,
  initial,
  children,
}: {
  boardId: string;
  initial: ResolvedBoardViewPrefs;
  children: React.ReactNode;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(initial.collapsedGroupIds),
  );
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    () => new Set(initial.expandedItemIds),
  );

  // The view id and filter query are write-only from this provider's point of
  // view: the URL renders them, so holding them in state would just be a second
  // source of truth. Refs keep them out of the render path entirely.
  const viewIdRef = useRef<string | null>(initial.viewId);
  const filterQueryRef = useRef<string>(initial.filterQuery);

  // Latest sets for the debounced writer, so the timer never closes over stale
  // state and never has to be re-created on every toggle.
  const collapsedRef = useRef(collapsedGroups);
  const expandedRef = useRef(expandedItems);
  useEffect(() => {
    collapsedRef.current = collapsedGroups;
  }, [collapsedGroups]);
  useEffect(() => {
    expandedRef.current = expandedItems;
  }, [expandedItems]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const state: BoardViewPrefsState = {
        viewId: viewIdRef.current,
        // Capped here as well as in the schema: the cap is a bound on what we
        // are willing to remember, so the write must not fail validation just
        // because a very large board got fully collapsed.
        collapsedGroupIds: [...collapsedRef.current].slice(0, MAX_PREF_IDS),
        expandedItemIds: [...expandedRef.current].slice(0, MAX_PREF_IDS),
        filterQuery: filterQueryRef.current,
      };
      // Fire and forget. A failed persist is dropped, never surfaced and never
      // allowed to roll back local state — failing to remember a collapsed
      // group is not worth interrupting the user for.
      void saveBoardViewPrefs({ boardId, state }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, [boardId]);

  const toggleGroupCollapsed = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => toggleIn(prev, groupId));
      schedule();
    },
    [schedule],
  );

  const toggleItemExpanded = useCallback(
    (itemId: string) => {
      setExpandedItems((prev) => toggleIn(prev, itemId));
      schedule();
    },
    [schedule],
  );

  const setActiveViewId = useCallback(
    (viewId: string) => {
      if (viewIdRef.current === viewId) return;
      viewIdRef.current = viewId;
      schedule();
    },
    [schedule],
  );

  const setFilterQuery = useCallback(
    (query: string) => {
      if (filterQueryRef.current === query) return;
      filterQueryRef.current = query;
      schedule();
    },
    [schedule],
  );

  const pruneTo = useCallback(
    (live: { groupIds: string[]; itemIds: string[] }) => {
      const liveGroups = new Set(live.groupIds);
      const liveItems = new Set(live.itemIds);

      // Decide from the refs BEFORE touching state: `changed` has to be known
      // synchronously here. Setting a flag from inside a state updater (the
      // shape the plan sketched) relies on React choosing to compute the
      // updater eagerly — it is skipped when a queue is already pending, and
      // double-invoked under StrictMode — so a prune could silently fail to
      // persist. Deriving the next sets from the refs is pure and exact.
      const nextCollapsed = new Set(
        [...collapsedRef.current].filter((id) => liveGroups.has(id)),
      );
      const nextExpanded = new Set(
        [...expandedRef.current].filter((id) => liveItems.has(id)),
      );
      const changed =
        nextCollapsed.size !== collapsedRef.current.size ||
        nextExpanded.size !== expandedRef.current.size;

      // Only write when something actually fell out, so the common case (every
      // remembered id still exists) costs nothing.
      if (!changed) return;

      collapsedRef.current = nextCollapsed;
      expandedRef.current = nextExpanded;
      setCollapsedGroups(nextCollapsed);
      setExpandedItems(nextExpanded);
      schedule();
    },
    [schedule],
  );

  const value = useMemo<BoardViewPrefsApi>(
    () => ({
      collapsedGroups,
      expandedItems,
      initialFilterQuery: initial.filterQuery,
      toggleGroupCollapsed,
      toggleItemExpanded,
      setActiveViewId,
      setFilterQuery,
      pruneTo,
    }),
    [
      collapsedGroups,
      expandedItems,
      initial.filterQuery,
      toggleGroupCollapsed,
      toggleItemExpanded,
      setActiveViewId,
      setFilterQuery,
      pruneTo,
    ],
  );

  return (
    <BoardViewPrefsContext.Provider value={value}>
      {children}
    </BoardViewPrefsContext.Provider>
  );
}
