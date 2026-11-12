import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";

/**
 * The page-title type scale: 20px bold, tight tracking. A page's title is its
 * anchor, so it must outweigh card headings and list rows (16px semibold).
 * Exported for the few titles that cannot be a `<PageHeader>` because they are
 * rename-in-place controls (board, dashboard) — they adopt the scale directly.
 */
export const PAGE_TITLE_CLASS =
  "font-heading text-xl font-bold tracking-[-0.02em]";

/**
 * The same scale for the `<Input>` a rename-in-place title swaps to. `<Input>`'s
 * base is `text-base md:text-sm`, and tailwind-merge only lets a class displace
 * one in the SAME variant: `text-xl` removes `text-base` but leaves
 * `md:text-sm`, which then wins at >=768px and shrinks the field to 14px. The
 * explicit `md:text-xl` is what displaces it. Use this — never
 * `PAGE_TITLE_CLASS` — on an `<Input>`.
 */
export const PAGE_TITLE_INPUT_CLASS = `${PAGE_TITLE_CLASS} md:text-xl`;

/** Nested `as="h2"` section headings sit one step below the page title. */
const SECTION_TITLE_CLASS = "font-heading text-lg font-semibold tracking-tight";

/**
 * The one page-title recipe. Kicker (optional) above an h1 on the shared type
 * ramp, optional description, right-aligned actions. Every top-level route
 * renders this so headings stop drifting between weights and sizes.
 */
export function PageHeader({
  title,
  kicker,
  index,
  description,
  actions,
  as: Tag = "h1",
  className,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  index?: string;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {kicker ? (
          <Kicker index={index} className="block">
            {kicker}
          </Kicker>
        ) : null}
        <Tag className={Tag === "h1" ? PAGE_TITLE_CLASS : SECTION_TITLE_CLASS}>
          {title}
        </Tag>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
