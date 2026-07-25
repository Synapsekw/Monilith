import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The alignment contract for a settings page: label + optional helper text on
 * the left, control right-aligned in a fixed-width column so every control in a
 * section shares one edge. Rows are separated by a hairline; the last row in a
 * section drops its rule. Stacks to a single column below `md`.
 *
 * This replaces the old one-Card-per-setting masonry, where nothing lined up
 * because CSS multi-column packs boxes by height.
 *
 * Pass `htmlFor` when the control is a single focusable input — the label then
 * becomes a real <label> and clicking it focuses the control.
 */
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border flex flex-col gap-3 border-b py-5 last:border-b-0",
        "md:flex-row md:items-start md:justify-between md:gap-8",
        className,
      )}
    >
      <div className="min-w-0 md:flex-1">
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="text-foreground block text-sm font-medium"
          >
            {label}
          </label>
        ) : (
          <p className="text-foreground text-sm font-medium">{label}</p>
        )}
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      <div className="md:w-[280px] md:shrink-0">{children}</div>
    </div>
  );
}
