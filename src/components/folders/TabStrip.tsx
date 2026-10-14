"use client";

import { cn } from "@/lib/utils";
import type { LayoutTab, TabKind } from "@/lib/validations/folder-layout";

export type TabCounts = {
  stages: number;
  boards: number;
  people: number | null;
  overloaded: number;
};

/** Tabs under the folder header (spec §5.1), rendered from the folder's
 *  layout config — tab set, order and labels are per-folder, not a fixed
 *  four. Roving tablist; counts are mono and keyed by tab KIND (a renamed
 *  "Pipeline" stages tab still shows the stage count); overloaded is red. */
export function TabStrip({
  tabs,
  tab,
  counts,
  disabled = false,
  onChange,
}: {
  tabs: LayoutTab[];
  tab: string;
  counts: TabCounts;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const countFor = (kind: TabKind): { n: number | null; red: boolean } => {
    if (kind === "stages") return { n: counts.stages, red: false };
    if (kind === "boards") return { n: counts.boards, red: false };
    if (kind === "people")
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
      {tabs.map((t) => {
        const c = countFor(t.kind);
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled && t.kind !== "canvas"}
            onClick={() => onChange(t.id)}
            className={cn(
              // Hand-rolled control: it has to buy its own 44px coarse touch
              // target, the app primitives get it for free.
              "focus-visible:ring-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 pointer-coarse:min-h-11",
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
