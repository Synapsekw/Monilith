import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * Which surface this skeleton is painted on.
   *
   * - `content` (default) — the opaque `--muted` fill. Correct on the opaque
   *   inset content card, which is where all but two of the call sites live.
   * - `chrome` — alpha-on-parent `--chrome-fill`, for skeletons that paint
   *   directly on the wash (the shell's sidebar and header fallbacks). An
   *   opaque block there reads as a grey rectangle punched into the gradient
   *   on every first paint.
   *
   * A variant rather than a changed default on purpose: 12 modules import this
   * primitive across 67 call sites, and flipping the default would repaint all
   * of them to fix two.
   */
  variant?: "content" | "chrome";
};

/**
 * Shared loading-block primitive. The single skeleton token reused by the
 * Phase 9.2 shell fallbacks and the Phase 9.4 page-content loading skeletons.
 */
export function Skeleton({
  className,
  variant = "content",
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md",
        variant === "chrome" ? "bg-chrome-fill" : "bg-muted",
        className,
      )}
      {...props}
    />
  );
}
