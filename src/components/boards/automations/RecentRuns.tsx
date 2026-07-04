"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAutomationRuns } from "@/lib/boards/automation-actions";
import {
  timeAgo,
  formatRunSummary,
  type RunActionOutcome,
} from "@/lib/boards/automation-runs";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  // "ran" = the earned brand accent; "blocked" = muted monochrome; "error" =
  // the sanctioned destructive token. Mirrors changelog-item-badge.tsx so the
  // disclosure stays on Pulse's monochromatic + single-accent system.
  ran: { label: "Ran", className: "bg-primary text-primary-foreground" },
  blocked: { label: "Blocked", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive" },
};

export function RecentRuns({ automationId }: { automationId: string }) {
  const [open, setOpen] = useState(false);
  const { data: result, isLoading } = useQuery({
    queryKey: ["automationRuns", automationId],
    enabled: open,
    staleTime: 30_000,
    queryFn: () => getAutomationRuns(automationId),
  });
  const runs = result?.ok ? result.data : [];
  const loadError = result != null && !result.ok;

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        Recent runs
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {isLoading ? (
            <p className="text-muted-foreground text-xs">Loading…</p>
          ) : loadError ? (
            <p role="alert" className="text-destructive text-xs">
              Couldn&rsquo;t load recent runs. Try again.
            </p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground text-xs">No runs yet.</p>
          ) : (
            runs.map((run) => {
              const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.ran;
              return (
                <div key={run.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {timeAgo(run.created_at)}
                  </span>
                  <span className="truncate">
                    {formatRunSummary(
                      run.status,
                      (run.actions as RunActionOutcome[] | null) ?? [],
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
