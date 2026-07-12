"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GanttRow } from "@/lib/boards/gantt";

export function UnscheduledSection({
  rows,
  onItemTap,
}: {
  rows: GanttRow[];
  /** Tap on a row — status/% are exactly what you'd triage on an unscheduled
   * item, so rows open the quick-edit peek like bars do. */
  onItemTap: (itemId: string, anchorRect: DOMRect) => void;
}) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground hover:bg-accent flex w-full items-center gap-2 px-6 py-2 text-sm font-medium transition-colors"
      >
        <span>Unscheduled ({rows.length})</span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
      </button>
      <ul hidden={!open} aria-hidden={!open} className="border-t px-6 py-2">
        {rows.map((row) => (
          <li key={row.itemId} className="py-0.5">
            <button
              type="button"
              onClick={(e) =>
                onItemTap(row.itemId, e.currentTarget.getBoundingClientRect())
              }
              className="text-foreground hover:bg-accent focus-visible:ring-ring block w-full truncate rounded-md px-1 py-0.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
            >
              {row.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
