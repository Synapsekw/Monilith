"use client";

import { useMemo } from "react";
import {
  fitBoardColumns,
  type FitColumn,
  type FitFont,
  type FitMeasure,
  type FitMember,
} from "@/lib/boards/fit-column-width";
import { useFontsReady } from "@/lib/hooks/use-fonts-ready";

const NO_WIDTHS: Record<string, number> = {};
const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const MONO_FALLBACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * The px size each measured font renders at in the table. A canvas needs px;
 * the CSS is rem. use-column-auto-fit.test.tsx reads globals.css and fails if
 * these drift from it.
 *  - cell:   `[data-board-table] .text-cell` (12.5px)
 *  - chip:   `text-xs`, the ColorChip / StatusPill label
 *  - mono:   `--text-2xs`
 *  - header: `--text-3xs`, the column label kicker
 */
export const FIT_FONT_SIZES: Record<FitFont, string> = {
  cell: "12.5px",
  chip: "12px",
  mono: "11px",
  header: "10px",
};

const FIT_FONT_WEIGHTS: Record<FitFont, string> = {
  cell: "400",
  chip: "500",
  mono: "500",
  header: "500",
};

/**
 * Canvas font strings from the LIVE `--font-inter` / `--font-jetbrains-mono`
 * values. next/font self-hosts both faces under generated family names, so
 * the bare literals never resolve in the browser (same reason as
 * `buildNameMeasureFont` in ./shared). DOM-free, so it is unit-testable; the
 * literals are only the jsdom / pre-font fallback.
 */
export function buildFitFonts(
  fontInterVar: string,
  fontMonoVar: string,
): Record<FitFont, string> {
  const sans = `${fontInterVar.trim() || "Inter"}, ${SANS_FALLBACK}`;
  const mono = `${fontMonoVar.trim() || '"JetBrains Mono"'}, ${MONO_FALLBACK}`;
  const font = (key: FitFont, family: string) =>
    `${FIT_FONT_WEIGHTS[key]} ${FIT_FONT_SIZES[key]} ${family}`;
  return {
    cell: font("cell", sans),
    chip: font("chip", sans),
    mono: font("mono", mono),
    header: font("header", mono),
  };
}

/** One offscreen canvas; `ctx.font` is only reassigned when the font changes. */
function createCanvasMeasure(): FitMeasure {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  if (!ctx) return () => 0;
  const root = getComputedStyle(document.documentElement);
  const fonts = buildFitFonts(
    root.getPropertyValue("--font-inter"),
    root.getPropertyValue("--font-jetbrains-mono"),
  );
  let current: FitFont | null = null;
  return (text, font) => {
    if (current !== font) {
      ctx.font = fonts[font];
      current = font;
    }
    return ctx.measureText(text).width;
  };
}

/**
 * Fitted widths for the value columns that have no saved width:
 * `{ [columnId]: px }`. Pure measurement over the board cache - no server
 * round-trip.
 *
 * WHEN it runs: after hydration (`enabled`), and again when the set of columns
 * changes or the number of items changes. NOT on a cell edit: a column must
 * never change width while someone is typing in it. That is why `cellValues`
 * is read but is not a dependency - the values are picked up at the next
 * column / item-count change.
 */
export function useColumnAutoFit({
  columns,
  cellValues,
  itemCount,
  members,
  enabled,
  coarse = false,
}: {
  columns: readonly FitColumn[];
  cellValues: readonly { column_id: string; value: unknown }[];
  /** Total items on the board; a change (add / remove) triggers a refit. */
  itemCount: number;
  members: readonly FitMember[];
  /** `useHydrated()`: the server has no canvas, and a width computed
   *  differently on the server would stick on the header after hydration. */
  enabled: boolean;
  /** `useCoarsePointer()`: touch headers carry 44px in-flow controls. */
  coarse?: boolean;
}): Record<string, number> {
  // Canvas text measurement is only right once the web fonts have loaded: until
  // then it measures the fallback face and nothing would refit. So the fit is
  // held back until `document.fonts.ready`.
  const fontsReady = useFontsReady();
  const active = enabled && fontsReady;
  return useMemo(() => {
    if (!active) return NO_WIDTHS;
    // Built here, on an active run only (never during the hydration render).
    return fitBoardColumns(
      columns,
      cellValues,
      createCanvasMeasure(),
      members,
      coarse,
    );
    // `cellValues` deliberately omitted and `itemCount` deliberately present:
    // see the "WHEN it runs" note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, columns, itemCount, members, coarse]);
}
