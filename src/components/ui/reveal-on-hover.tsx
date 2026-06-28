"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

/**
 * Wraps row/card actions that reveal on hover for mouse users but must stay
 * ALWAYS visible on touch (a finger can't hover). Place inside a `group`
 * ancestor so the hover variant resolves. Replaces hand-rolled
 * `opacity-0 group-hover:opacity-100` blocks across the board surfaces.
 */
function RevealOnHover({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const coarse = useCoarsePointer();
  return (
    <div
      data-slot="reveal-on-hover"
      data-coarse={coarse || undefined}
      className={cn(
        coarse
          ? "opacity-100"
          : "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { RevealOnHover };
