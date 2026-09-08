import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";

/**
 * Keystone meta chip — a mono `LABEL value` pair (e.g. `DUE Jul 14`,
 * `STATUS Working`). The label uses the shared kicker recipe (mono, uppercase,
 * `--kicker`); the value is foreground, or accent when `tone="accent"`. Static
 * and decorative — for panel/card metadata, not interactive controls.
 */
export function MetaChip({
  label,
  tone = "default",
  className,
  children,
}: {
  label: string;
  tone?: "default" | "accent";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 text-xs", className)}>
      <Kicker size="xs" className="tracking-[0.1em]">
        {label}
      </Kicker>
      <span
        className={cn(
          "font-medium",
          tone === "accent" ? "text-primary" : "text-foreground",
        )}
      >
        {children}
      </span>
    </span>
  );
}
