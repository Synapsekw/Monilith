"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { formatHours, parseHours, secsToHours } from "@/lib/time/hours";

/** One day-cell editor on the weekly card. Editable decimal-hours for the
 * manual portion; the timer portion is a read-only sub-label. Commits on
 * blur/Enter; an emptied value clears the row's day (delete). */
export function TimeCell({
  manualSecs,
  timerSecs,
  onCommit,
  onClear,
  ariaLabel,
  disabled,
}: {
  manualSecs: number;
  timerSecs: number;
  onCommit: (hours: number) => void;
  onClear: () => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(formatHours(manualSecs));
  // Re-sync when the server value changes (e.g. after revalidate). Adjusting
  // state during render (React's recommended replacement for a setState effect)
  // keeps the input in step with the persisted value without cascading renders.
  const [lastManualSecs, setLastManualSecs] = useState(manualSecs);
  if (manualSecs !== lastManualSecs) {
    setLastManualSecs(manualSecs);
    setValue(formatHours(manualSecs));
  }

  function commit() {
    const trimmed = value.trim();
    if (trimmed === "") {
      if (manualSecs > 0) onClear();
      return;
    }
    const h = parseHours(trimmed);
    if (h === null) {
      // revert to the last valid value
      setValue(formatHours(manualSecs));
      return;
    }
    if (h === 0) {
      if (manualSecs > 0) onClear();
      setValue("");
      return;
    }
    if (h !== secsToHours(manualSecs)) onCommit(h);
  }

  return (
    <div className="flex flex-col items-center">
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "focus-visible:ring-ring h-8 w-14 rounded border bg-transparent text-center font-mono text-sm tabular-nums focus-visible:ring-2 focus-visible:outline-none",
          disabled && "opacity-50",
        )}
        placeholder="—"
      />
      {timerSecs > 0 ? (
        <span className="text-muted-foreground text-3xs mt-0.5 leading-tight">
          incl. {formatHours(timerSecs) || "0"}h tracked
        </span>
      ) : null}
    </div>
  );
}
