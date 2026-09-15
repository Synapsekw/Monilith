"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { commandTabSchema } from "@/lib/validations/folders";

export type CommandTab = "overview" | "stages" | "boards" | "people";

export function parseTab(v: string | null): CommandTab {
  const parsed = commandTabSchema.safeParse(v);
  return parsed.success ? parsed.data : "overview";
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

export function useCommandCenterState() {
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const stage = params.get("stage");
  const board = params.get("board");

  const setTab = useCallback((t: CommandTab) => {
    write((url) => {
      if (t === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
    });
  }, []);
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

  return {
    tab,
    stage: stage === "" ? null : stage,
    board: board === "" ? null : board,
    setTab,
    setStage,
    setBoard,
  };
}
