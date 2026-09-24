"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import { BurnScopeNote } from "@/components/folders/charts/BurnScopeNote";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import type { BurnPoint } from "@/lib/folders/rollup";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

/** "Planned vs completed" — the burn chart panel. `mode` is local UI state
 *  (cumulative/weekly), not folder data, so it lives here rather than being
 *  threaded through Overview. */
export function BurnPanel({
  kicker,
  title = "Planned vs completed",
  board,
  burn,
  anyDue,
  onRetry,
}: {
  kicker: string;
  title?: string;
  /** The active board filter, for the scope caption only — the burn RPC has
   *  no board dimension. */
  board: string | null;
  burn: BurnPoint[] | null;
  anyDue: boolean;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  return (
    <Panel kicker={kicker} title={title}>
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
      {burn === null ? (
        <Failed onRetry={onRetry} />
      ) : !anyDue || burn.length === 0 ? (
        <EmptyState variant="inline">
          Add due dates to see planned vs completed
        </EmptyState>
      ) : (
        <BurnChart points={burn} mode={mode} />
      )}
    </Panel>
  );
}
