import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";

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
        <Tag className="font-heading text-lg font-semibold tracking-tight">
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
