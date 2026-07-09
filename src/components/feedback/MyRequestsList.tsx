"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { statusToneClasses } from "@/components/ui/status-pill";
import type { ActionResult, MyFeedback } from "@/lib/feedback/actions";

type StatusColor =
  | "gray"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "teal";

const STATUS_META: Record<
  MyFeedback["status"],
  { label: string; color: StatusColor }
> = {
  new: { label: "New", color: "gray" },
  triaged: { label: "Triaged", color: "blue" },
  planned: { label: "Planned", color: "teal" },
  in_progress: { label: "In Progress", color: "blue" },
  resolved: { label: "Resolved", color: "green" },
  declined: { label: "Declined", color: "red" },
};

const KIND_LABEL: Record<MyFeedback["kind"], string> = {
  bug: "Bug",
  feature_request: "Feature",
};

type Props = {
  load: () => Promise<ActionResult<MyFeedback[]>>;
};

export function MyRequestsList({ load }: Props) {
  const [items, setItems] = useState<MyFeedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setItems(result.data);
      } else {
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (error) {
    return <p className="text-destructive py-6 text-center text-xs">{error}</p>;
  }

  if (items === null) {
    // Skeleton
    return (
      <div className="flex flex-col gap-2 py-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-muted/60 h-10 animate-pulse rounded-md" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-xs">
        No requests yet.
      </p>
    );
  }

  return (
    <div className="divide-border flex flex-col divide-y">
      {items.map((item) => {
        const meta = STATUS_META[item.status] ?? {
          label: item.status,
          color: "gray" as StatusColor,
        };
        return (
          <div
            key={item.id}
            className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-foreground flex-1 truncate text-sm leading-snug font-medium">
                {item.title}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                  statusToneClasses(meta.color, "solid"),
                )}
              >
                {meta.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="bg-muted/60 text-muted-foreground rounded-sm px-1 py-px text-[10px] font-medium">
                {KIND_LABEL[item.kind] ?? item.kind}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {new Date(item.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            {item.admin_response && (
              <p className="border-border bg-muted/30 text-muted-foreground mt-0.5 rounded-md border px-2 py-1.5 text-xs">
                <span className="text-foreground font-medium">Response: </span>
                {item.admin_response}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
