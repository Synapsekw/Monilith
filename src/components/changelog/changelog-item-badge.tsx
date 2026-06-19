import { cn } from "@/lib/utils";
import type { ChangelogKind } from "@/lib/changelog/types";

// new = the earned brand accent; improved/fixed = muted monochrome outline.
const BADGES: Record<ChangelogKind, { label: string; className: string }> = {
  new: { label: "New", className: "bg-primary text-primary-foreground" },
  improved: { label: "Improved", className: "text-muted-foreground border" },
  fixed: { label: "Fixed", className: "text-muted-foreground border" },
};

export function ChangelogItemBadge({ kind }: { kind: ChangelogKind }) {
  const { label, className } = BADGES[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {label}
    </span>
  );
}
