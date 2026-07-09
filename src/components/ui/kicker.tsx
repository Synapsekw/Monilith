import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Keystone eyebrow label — mono, uppercase, wide tracking, dim `--kicker` color,
 * with an optional accent-colored index prefix ("01 / SPRINT 24"). Decorative;
 * keep it for section labels, not body content.
 */
export function Kicker({
  index,
  className,
  children,
}: {
  index?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-kicker font-mono text-[11px] font-medium tracking-[0.12em] uppercase",
        className,
      )}
    >
      {index ? (
        <>
          <span className="text-primary">{index}</span>
          <span aria-hidden="true">{" / "}</span>
        </>
      ) : null}
      {children}
    </span>
  );
}
