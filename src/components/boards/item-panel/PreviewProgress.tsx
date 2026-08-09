"use client";

import { cn } from "@/lib/utils";

/**
 * Loading feedback for a preview that has to fetch and parse bytes before it
 * can show anything.
 *
 * Two modes, and the distinction is deliberate: pass a `value` when real
 * progress is known (a download with a Content-Length) and omit it when it is
 * not (a parse step with no progress API). A fake determinate bar that creeps
 * to 90% and stops is worse than an honest indeterminate one — it promises a
 * completion time the code cannot know.
 */
export function PreviewProgress({
  label,
  value,
  className,
}: {
  label: string;
  /** 0–1 for a determinate bar; omit for indeterminate. */
  value?: number;
  className?: string;
}) {
  const determinate = typeof value === "number" && Number.isFinite(value);
  const pct = determinate
    ? Math.round(Math.min(1, Math.max(0, value)) * 100)
    : 0;

  return (
    <div
      className={cn(
        "text-muted-foreground flex w-full max-w-xs flex-col items-center gap-2 py-12 text-sm",
        className,
      )}
    >
      <span>{label}</span>
      <div
        role="progressbar"
        aria-label={label}
        // An indeterminate bar reports no value at all, per ARIA — omitting
        // these is what tells a screen reader "unknown", rather than "0%".
        aria-valuenow={determinate ? pct : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        className="bg-surface-muted relative h-1 w-full overflow-hidden rounded-full"
      >
        {determinate ? (
          <div
            data-testid="preview-progress-fill"
            className="bg-primary h-full rounded-full transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div
            data-testid="preview-progress-indeterminate"
            className="bg-primary/70 absolute inset-y-0 w-1/3 animate-[preview-sweep_1.1s_ease-in-out_infinite] rounded-full"
          />
        )}
      </div>
    </div>
  );
}
