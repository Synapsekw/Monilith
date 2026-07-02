import { cn } from "@/lib/utils";

/**
 * Standard empty-state message. `panel` is the designed dashed-box pattern
 * (page/canvas-level emptiness); `inline` is unboxed for already-bounded
 * regions (item-panel tabs, popovers). Spec:
 * docs/superpowers/specs/2026-07-02-ui-polish-micro-design.md (D1).
 */
export function EmptyState({
  children,
  variant = "panel",
  className,
}: {
  children: React.ReactNode;
  variant?: "panel" | "inline";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground text-center text-sm",
        variant === "panel" && "rounded-lg border border-dashed p-12",
        variant === "inline" && "py-8",
        className,
      )}
    >
      {children}
    </div>
  );
}
