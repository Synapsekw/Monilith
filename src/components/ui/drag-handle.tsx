import * as React from "react";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Slim drag grip with a guaranteed ≥44px touch target on coarse pointers
 * (Apple HIG). Spread dnd-kit `listeners`/`attributes` onto it for the
 * precision-drag surfaces that opt out of long-press (Gantt bar resize, Table
 * column resize). `touch-none` keeps a drag-from-handle from scrolling.
 */
function DragHandle({
  className,
  "aria-label": ariaLabel = "Drag to reorder",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="drag-handle"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
        "size-5 pointer-coarse:size-11",
        className,
      )}
      {...props}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

export { DragHandle };
