"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  parseBoardFilter,
  serializeBoardFilter,
  filterFacetCount,
  isFilterActive,
  parseIntel,
  FILTER_PARAM_KEYS,
  INTEL_PARAM_KEY,
  URL_PARAM_KEYS,
  type BoardFilterState,
  type BoardSort,
} from "@/lib/boards/board-filter";
import type { ListFilter } from "@/lib/validations/dashboards";
import type { IntelSelection } from "@/lib/boards/intelligence/types";
import { useBoardViewPrefs } from "@/lib/boards/view-prefs-context";

/**
 * Board filter/sort/search state, read from and written to the URL.
 *
 * This is the board-toolbar analogue of {@link ViewSwitcher}'s `?view=` trick:
 * the state lives in the URL and is applied to the **already-loaded** board
 * cache in memory, so changing a filter re-renders the view via
 * `useSearchParams()` WITHOUT re-running the board RSC page — 0 server
 * round-trips (AGENTS.md §invariants / gotcha-09). Writes go through the History
 * API (`pushState`/`replaceState`); Next syncs them into `useSearchParams()`.
 *
 * The `view` / `item` params are preserved on every write so filtering never
 * drops the active view or an open item panel.
 */
export function useBoardFilterSort() {
  const searchParams = useSearchParams();

  const { initialFilterQuery, setFilterQuery } = useBoardViewPrefs();

  // True once this session has written the filter URL even once. Load-bearing:
  // clearing a filter empties the URL, which looks identical to a fresh visit,
  // so a naive "empty URL means use the saved filter" rule would resurrect the
  // filter the user just cleared. After the first write the URL is
  // authoritative and an empty URL means an empty filter.
  //
  // State, not a ref: flipping it must re-render, because the render it
  // invalidates is the one showing the seeded filter. Relying on
  // `useSearchParams()` to re-render us after the History write would make
  // "Clear all" depend on a second, unrelated mechanism firing — and a ref
  // mutation would be invisible if it didn't. React bails out on the
  // unchanged `true`, so only the first write costs a render.
  const [hasWritten, setHasWritten] = useState(false);
  // FILTER_PARAM_KEYS, not URL_PARAM_KEYS: `intel` is a lens, not an
  // arrangement (it is never persisted — see `write` below). Counting it here
  // made a link carrying ONLY `?intel=overdue` look like "the URL already has
  // a filter", so the saved filter was neither applied nor seeded — and the
  // first write after that persisted the resulting empty `keep`, destroying
  // the saved arrangement.
  const urlHasFilter = FILTER_PARAM_KEYS.some((k) => searchParams.get(k));
  const useSaved = !hasWritten && !urlHasFilter && initialFilterQuery !== "";

  // Re-parse only when one of the filter params actually changes (identity is
  // stable across unrelated re-renders — e.g. presence heartbeats — so the
  // derived predicate/comparator memos in the views don't churn).
  //
  // NUL is the join delimiter because it cannot appear in a URL query value, so
  // no combination of filter values can forge a key collision the way a comma
  // or pipe could. It is written as an escape rather than a literal NUL byte: a
  // raw one makes git classify this file as binary, which silently costs it
  // diffs in review, line-ending normalization, and grep hits.
  const raw = URL_PARAM_KEYS.map((k) => searchParams.get(k) ?? "").join(
    "\u0000",
  );
  const state = useMemo<BoardFilterState>(
    () =>
      useSaved
        ? {
            // The saved query holds the FILTER params only, so the chip has to
            // be overlaid from the URL — otherwise a `?intel=` link would drop
            // its own chip the moment a saved filter seeded the state.
            ...parseBoardFilter(new URLSearchParams(initialFilterQuery)),
            intel: parseIntel(searchParams.get(INTEL_PARAM_KEY)),
          }
        : parseBoardFilter(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, useSaved, initialFilterQuery],
  );

  // Write the given next-state to the URL. `replace` (search typing) avoids
  // spamming the back-stack; discrete toggles push so Back undoes them. Reads
  // the LIVE `window.location` so concurrent param writes (view/item) are kept.
  const write = useCallback(
    (next: BoardFilterState, opts?: { replace?: boolean }) => {
      setHasWritten(true);
      const url = new URL(window.location.href);
      const updates = serializeBoardFilter(next);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      if (opts?.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);

      // Remember the filter for the next visit. Only the filter params are
      // stored — never `view` or `item`, which are navigation, not arrangement.
      const keep = new URLSearchParams();
      for (const key of FILTER_PARAM_KEYS) {
        const value = url.searchParams.get(key);
        if (value) keep.set(key, value);
      }
      setFilterQuery(keep.toString());
    },
    [setFilterQuery],
  );

  // Reflect the seeded filter into the URL once, with replaceState so it does
  // not add a back-stack entry. Runs only when the saved filter is what seeded
  // this render.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !useSaved) return;
    seeded.current = true;
    const url = new URL(window.location.href);
    for (const [key, value] of new URLSearchParams(initialFilterQuery)) {
      url.searchParams.set(key, value);
    }
    window.history.replaceState(null, "", url);
  }, [useSaved, initialFilterQuery]);

  // Quick-search typing must not write the URL (and rebuild the searchParams-
  // derived state → re-scan every row) on every keystroke. Debounce the write
  // ~200ms; the toolbar holds the immediate text locally so the field never
  // lags. Discrete toggles (people/status/sort) stay immediate below.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest state for the debounced search write (avoids a stale closure without
  // re-creating the timer/callback on every state change). Updated in an effect
  // — never during render (react-hooks/refs).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  const setSearch = useCallback(
    (q: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      // Clearing (empty q, e.g. the X button) applies immediately.
      if (q === "") {
        write({ ...stateRef.current, q: "" }, { replace: true });
        return;
      }
      searchTimer.current = setTimeout(() => {
        write({ ...stateRef.current, q }, { replace: true });
      }, 200);
    },
    [write],
  );
  const setPeople = useCallback(
    (people: string[]) => write({ ...state, people }),
    [state, write],
  );
  const setStatus = useCallback(
    (status: string[]) => write({ ...state, status }),
    [state, write],
  );
  const setConditions = useCallback(
    (conditions: ListFilter) => write({ ...state, conditions }),
    [state, write],
  );
  const setSort = useCallback(
    (sort: BoardSort | null) => write({ ...state, sort }),
    [state, write],
  );
  const clearAll = useCallback(
    () =>
      write({
        q: "",
        people: [],
        status: [],
        conditions: { combinator: "and", conditions: [] },
        sort: null,
        intel: null,
      }),
    [write],
  );

  // The Intelligence chip. replaceState (spec §3.3): a chip toggle is a lens on
  // the board, not a navigation the Back button should undo.
  const setIntel = useCallback(
    (intel: IntelSelection | null) =>
      write({ ...state, intel }, { replace: true }),
    [state, write],
  );

  return {
    state,
    facetCount: filterFacetCount(state),
    isActive: isFilterActive(state),
    setSearch,
    setPeople,
    setStatus,
    setConditions,
    setSort,
    clearAll,
    setIntel,
  };
}
