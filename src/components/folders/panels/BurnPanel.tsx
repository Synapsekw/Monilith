"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import { BurnLegend } from "@/components/folders/charts/BurnLegend";
import { BurnScopeNote } from "@/components/folders/charts/BurnScopeNote";
import { StageBars } from "@/components/folders/charts/StageBars";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import type { BurnPoint } from "@/lib/folders/rollup";
import {
  forecastReading,
  type Forecast,
  type StageBar,
} from "@/lib/folders/tower";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

const NOT_ENOUGH_HISTORY = "Not enough history yet to forecast.";

function gapSentence(gap: number): string {
  if (gap === 0) return "";
  return gap < 0
    ? `${-gap} behind plan today. `
    : `${gap} ahead of plan today. `;
}

/**
 * The chart's text alternative: planned and completed totals over the charted
 * window, the gap (when one is stated) and the forecast reading.
 */
export function burnSummary(
  points: BurnPoint[],
  gap: number | null,
  forecast: Forecast | null,
  todayISO?: string,
): string {
  const last = points[points.length - 1];
  const planned = last?.plannedCum ?? 0;
  const completed = last?.completedCum ?? 0;
  const gapText =
    gap === null
      ? ""
      : gap === 0
        ? " On plan today."
        : ` ${gapSentence(gap).trim()}`;
  const reading =
    forecast === null
      ? ""
      : ` ${forecast.insufficientHistory ? NOT_ENOUGH_HISTORY : forecastReading(forecast, todayISO)}`;
  return `Planned vs completed: ${planned} planned in total, ${completed} completed.${gapText}${reading}`;
}

/**
 * "Planned vs completed" with a forecast, or, for a folder with no dates,
 * "Items by stage". `mode` is local UI state (cumulative/weekly), not folder
 * data, so it lives here rather than being threaded through Overview.
 */
export function BurnPanel({
  kicker,
  title,
  board,
  burn,
  anyDue,
  onRetry,
  forecast = null,
  gap = null,
  stageBars,
  todayISO,
}: {
  kicker: string;
  title?: string;
  /** The active board filter, for the scope caption only — the burn RPC has
   *  no board dimension. */
  board: string | null;
  burn: BurnPoint[] | null;
  anyDue: boolean;
  onRetry: () => void;
  forecast?: Forecast | null;
  /**
   * The gap the reading states: the rollup's done − planned-by-today for the
   * chart's own scope (folder-wide, current stage), which with no board
   * filter IS the Gap card's value. Never `forecast.gapNow`: that is the
   * series' end-of-week figure and once disagreed with the card (DAAS: "54
   * behind" beside −341). Null (or omitted) drops the gap sentence.
   */
  gap?: number | null;
  /** Supplied by Overview; when the folder has no dates these replace the chart. */
  stageBars?: StageBar[];
  /** The page's today, so a finish date in another year shows its year. */
  todayISO?: string;
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  if (!anyDue && stageBars !== undefined)
    return (
      <Panel kicker={kicker} title={title ?? "Items by stage"}>
        <StageBars bars={stageBars} />
      </Panel>
    );
  const charted = burn !== null && anyDue && burn.length > 0;
  return (
    <Panel kicker={kicker} title={title ?? "Planned vs completed"}>
      <div
        role="radiogroup"
        aria-label="Chart mode"
        data-print-hide
        className="flex gap-1 self-end"
      >
        {(["cumulative", "weekly"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              // Hand-rolled control: it has to buy its own 44px coarse
              // touch target, the app primitives get it for free.
              "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3",
              mode === m
                ? "border-border-bright text-foreground"
                : "text-muted-foreground hover:border-border-hover",
            )}
          >
            {m === "cumulative" ? "Cumulative" : "Weekly"}
          </button>
        ))}
      </div>
      <BurnScopeNote board={board} />
      {charted && forecast && mode === "cumulative" ? (
        <p data-testid="burn-reading" className="text-muted-foreground text-xs">
          {forecast.insufficientHistory
            ? NOT_ENOUGH_HISTORY
            : `${gap === null ? "" : gapSentence(gap)}${forecastReading(forecast, todayISO)}`}
        </p>
      ) : null}
      {burn === null ? (
        <Failed onRetry={onRetry} />
      ) : !charted ? (
        <EmptyState variant="inline">
          Add due dates to see planned vs completed
        </EmptyState>
      ) : (
        <figure
          aria-label={burnSummary(burn, gap, forecast, todayISO)}
          className="flex flex-col gap-2"
        >
          <BurnChart
            points={burn}
            mode={mode}
            forecast={mode === "cumulative" ? forecast?.line : undefined}
          />
          <BurnLegend mode={mode} forecast={(forecast?.line.length ?? 0) > 1} />
        </figure>
      )}
    </Panel>
  );
}
