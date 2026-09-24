"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * `?tab=` now carries a TAB ID from the folder's layout config, not a fixed
 * enum — a CRM folder's "pipeline" is as valid as "overview". Unknown ids fall
 * back to the first configured tab, so a deep link to a tab someone removed
 * still renders. Preset tab ids are exactly the legacy slugs, so existing
 * links keep working.
 */
export function parseTab(v: string | null, tabIds: string[]): string {
  return v !== null && tabIds.includes(v) ? v : (tabIds[0] ?? "overview");
}

/**
 * Tab / stage / board are CLIENT state mirrored into the URL with the History
 * API — Next.js syncs replaceState into useSearchParams() with no RSC re-run
 * (gotcha-09; precedent src/components/portfolios/PortfolioGrid.tsx:37-58).
 * Never <Link>/router.push here: that would re-run every query on the page.
 */
function write(mutate: (url: URL) => void) {
  const url = new URL(window.location.href);
  mutate(url);
  window.history.replaceState({}, "", url);
}

export function useCommandCenterState(tabIds: string[]) {
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"), tabIds);
  const stage = params.get("stage");
  const board = params.get("board");
  const edit = params.get("edit") === "1";

  const first = tabIds[0];
  const setTab = useCallback(
    (t: string) => {
      write((url) => {
        if (t === first) url.searchParams.delete("tab");
        else url.searchParams.set("tab", t);
      });
    },
    [first],
  );
  const setStage = useCallback((k: string | null) => {
    write((url) => {
      if (k === null) url.searchParams.delete("stage");
      else url.searchParams.set("stage", k);
    });
  }, []);
  const setBoard = useCallback((id: string | null) => {
    write((url) => {
      if (id === null) url.searchParams.delete("board");
      else url.searchParams.set("board", id);
    });
  }, []);
  const setEdit = useCallback((on: boolean) => {
    write((url) => {
      if (on) url.searchParams.set("edit", "1");
      else url.searchParams.delete("edit");
    });
  }, []);

  return {
    tab,
    stage: stage === "" ? null : stage,
    board: board === "" ? null : board,
    edit,
    setTab,
    setStage,
    setBoard,
    setEdit,
  };
}
