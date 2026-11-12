import { Mono } from "@/components/brand/mono";
import { cn } from "@/lib/utils";

/**
 * Standard empty-state message. `panel` is the designed dashed-box pattern
 * (page/canvas-level emptiness); `inline` is unboxed for already-bounded
 * regions (item-panel tabs, popovers). Spec:
 * docs/superpowers/specs/2026-07-02-ui-polish-micro-design.md (D1).
 *
 * `mascot`, `title` and `actions` opt into the page-level layout: Mono on the
 * left, then a title, the message and a row of actions; it stacks and centres
 * on narrow widths. With none of the three, the output is the original
 * single-message markup, unchanged. Spec:
 * docs/superpowers/specs/2026-11-12-visual-refresh-design.md (4.6).
 */
export function EmptyState({
  children,
  variant = "panel",
  className,
  mascot,
  title,
  actions,
}: {
  children: React.ReactNode;
  variant?: "panel" | "inline";
  className?: string;
  /** Show Mono. `true` is the idle mood. Page-level empty states only. */
  mascot?: boolean | "idle" | "happy";
  /** What will appear here once there is something to show. */
  title?: React.ReactNode;
  /** One or two controls that already exist on the page. */
  actions?: React.ReactNode;
}) {
  const base = cn(
    "text-muted-foreground text-center text-sm",
    variant === "panel" && "rounded-lg border border-dashed p-12",
    variant === "inline" && "py-8",
  );

  if (!mascot && title == null && actions == null) {
    return <div className={cn(base, className)}>{children}</div>;
  }

  return (
    <div
      className={cn(
        base,
        "flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-5 sm:text-left",
        className,
      )}
    >
      {mascot ? (
        <Mono
          mood={mascot === "happy" ? "happy" : "idle"}
          size={72}
          className="shrink-0"
        />
      ) : null}
      <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
        {title != null ? (
          <p className="text-foreground text-base font-semibold">{title}</p>
        ) : null}
        <div className="max-w-sm">{children}</div>
        {actions != null ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
