import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Keystone eyebrow label — mono, uppercase, wide tracking, dim `--kicker` color,
 * with an optional index prefix ("01 / SPRINT 24"). The index inherits the
 * kicker's own (monochrome) color — the accent is reserved for interactive
 * states/indicators, not static label text. Decorative; keep it for section
 * labels, not body content. `size="xs"` (`text-3xs`) is for dense table/column
 * labels (board chrome); the default `"sm"` (`text-2xs`) is everywhere else.
 */
export function Kicker({
  index,
  size = "sm",
  className,
  children,
}: {
  index?: string;
  size?: "sm" | "xs";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-kicker font-mono font-medium tracking-[0.12em] uppercase",
        size === "xs" ? "text-3xs" : "text-2xs",
        className,
      )}
    >
      {index ? (
        <>
          <span>{index}</span>
          <span aria-hidden="true">{" / "}</span>
        </>
      ) : null}
      {children}
    </span>
  );
}
