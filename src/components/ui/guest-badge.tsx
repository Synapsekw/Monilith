import { cn } from "@/lib/utils";

/**
 * Marks a person who is in the organization as a guest: someone from outside
 * who sees only what was shared with them. A quiet, static chip that sits
 * next to a name. It carries its own text, so it never relies on color.
 */
export function GuestBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "border-border bg-surface-muted text-muted-foreground inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px align-middle text-xs font-medium",
        className,
      )}
    >
      Guest
    </span>
  );
}
