import type { CSSProperties, ReactNode } from "react";
import { softPillText } from "@/components/boards/cells/soft-pill-color";
import { cn } from "@/lib/utils";

/**
 * Soft translucent chip for an arbitrary user hex — a 15% tint of `color` over
 * the surface, with text derived from that same color but contrast-clamped per
 * theme (see {@link softPillText}) so any hue clears WCAG AA in both modes. The
 * `--pill*` custom properties carry the fill + per-theme text; the `dark:`
 * variant picks the right text. Static base — interactive call sites add
 * `hover:-translate-y-px hover:brightness-110` via `className` (matches
 * `StatusPill`). This is the one sanctioned rendering of arbitrary option color.
 */
export function ColorChip({
  color,
  className,
  children,
}: {
  color: string;
  className?: string;
  children: ReactNode;
}) {
  const fg = softPillText(color);
  return (
    <span
      style={
        {
          "--pill": color,
          "--pill-fg-light": fg.light,
          "--pill-fg-dark": fg.dark,
        } as CSSProperties
      }
      className={cn(
        "ease-keystone inline-flex max-w-full items-center truncate rounded-sm bg-[color-mix(in_oklab,var(--pill)_15%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--pill-fg-light)] transition-[transform,filter] duration-300 dark:text-[color:var(--pill-fg-dark)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
