import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared loading-block primitive. The single skeleton token reused by the
 * Phase 9.2 shell fallbacks and the Phase 9.4 page-content loading skeletons.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}
