"use client";

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CacheColumn } from "@/lib/boards/cache";

export type CalendarMode = "month" | "week" | "agenda";

const MODES: { id: CalendarMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];

export function CalendarControls({
  mode,
  onModeChange,
  label,
  onPrev,
  onNext,
  onToday,
  dateColumns,
  activeDateColumnId,
  onDateColumnChange,
}: {
  mode: CalendarMode;
  onModeChange: (m: CalendarMode) => void;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  dateColumns: CacheColumn[];
  activeDateColumnId: string;
  onDateColumnChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b px-6 py-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous period"
          onClick={onPrev}
          className="text-muted-foreground hover:bg-state-hover flex h-7 w-7 items-center justify-center rounded-md transition-colors pointer-coarse:size-11"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="text-muted-foreground hover:bg-state-hover rounded-md border px-2.5 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-11"
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Next period"
          onClick={onNext}
          className="text-muted-foreground hover:bg-state-hover flex h-7 w-7 items-center justify-center rounded-md transition-colors pointer-coarse:size-11"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      <span className="text-sm font-semibold tracking-tight">{label}</span>

      <div className="ml-auto flex items-center gap-3">
        <div
          role="tablist"
          aria-label="Calendar view mode"
          className="bg-surface-muted flex items-center gap-0.5 rounded-md border p-0.5"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => onModeChange(m.id)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors pointer-coarse:min-h-11",
                mode === m.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label
          htmlFor="cal-date-column"
          className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
        >
          <CalendarDays className="size-3.5" aria-hidden />
          Date by
        </label>
        <select
          id="cal-date-column"
          aria-label="Date column"
          value={activeDateColumnId}
          onChange={(e) => onDateColumnChange(e.target.value)}
          className="bg-surface focus-visible:ring-ring rounded-md border px-2 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {dateColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
