"use client";

import { cn } from "@/lib/utils";
import type { CommandTab } from "./command-center-state";

const TABS: { id: CommandTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "stages", label: "Stages" },
  { id: "boards", label: "Boards" },
  { id: "people", label: "People" },
];

/** Tabs under the folder header (spec §5.1). Roving tablist; counts are mono; overloaded count is red. */
export function TabStrip({
  tab,
  counts,
  disabled = false,
  onChange,
}: {
  tab: CommandTab;
  counts: {
    stages: number;
    boards: number;
    people: number | null;
    overloaded: number;
  };
  disabled?: boolean;
  onChange: (t: CommandTab) => void;
}) {
  const countFor = (id: CommandTab): { n: number | null; red: boolean } => {
    if (id === "stages") return { n: counts.stages, red: false };
    if (id === "boards") return { n: counts.boards, red: false };
    if (id === "people")
      return {
        n: counts.overloaded > 0 ? counts.overloaded : counts.people,
        red: counts.overloaded > 0,
      };
    return { n: null, red: false };
  };
  return (
    <div
      role="tablist"
      aria-label="Command center sections"
      data-print-hide
      className="flex gap-1 border-b"
    >
      {TABS.map((t) => {
        const c = countFor(t.id);
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled && t.id !== "overview"}
            onClick={() => onChange(t.id)}
            className={cn(
              "focus-visible:ring-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
            {c.n !== null ? (
              <>
                {" "}
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    c.red ? "text-status-red" : "text-muted-foreground",
                  )}
                >
                  {c.n}
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
