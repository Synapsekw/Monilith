"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { Tables } from "@/types/database.types";
import { cn } from "@/lib/utils";

type Row = Tables<"feedback">;

const ALL = "all";

const KINDS = [
  { value: ALL, label: "All kinds" },
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature" },
] as const;

const STATUSES = [
  { value: ALL, label: "All statuses" },
  { value: "new", label: "New" },
  { value: "triaged", label: "Triaged" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "declined", label: "Declined" },
] as const;

type Kind = (typeof KINDS)[number]["value"];
type Status = (typeof STATUSES)[number]["value"];

/**
 * Client filter bar for the admin feedback list.
 * Operates entirely over the already-loaded rows — zero new server round-trips.
 * Filter state is synced to the URL via window.history.replaceState so it
 * survives a page refresh without triggering RSC navigation.
 * useSearchParams() provides the reactive source-of-truth; no separate useState needed.
 */
export function FeedbackFilters({
  rows,
  children,
}: {
  rows: Row[];
  children: (filtered: Row[]) => React.ReactNode;
}) {
  const searchParams = useSearchParams();

  // Derive kind/status directly from URL params — no separate useState
  const rawKind = searchParams.get("kind") ?? ALL;
  const rawStatus = searchParams.get("status") ?? ALL;
  const kind: Kind = KINDS.some((k) => k.value === rawKind)
    ? (rawKind as Kind)
    : ALL;
  const status: Status = STATUSES.some((s) => s.value === rawStatus)
    ? (rawStatus as Status)
    : ALL;

  const setFilter = useCallback((key: "kind" | "status", value: string) => {
    const params = new URLSearchParams(window.location.search);
    // Preserve page param but remove it on filter change (go back to page 0)
    params.delete("page");
    if (value === ALL) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }, []);

  const filtered = rows.filter((row) => {
    if (kind !== ALL && row.kind !== kind) return false;
    if (status !== ALL && row.status !== status) return false;
    return true;
  });

  const btnCls = (active: boolean) =>
    cn(
      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-primary/15 text-primary border-primary/30"
        : "bg-surface text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">Kind:</span>
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setFilter("kind", k.value)}
            className={btnCls(kind === k.value)}
          >
            {k.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-4 text-xs font-medium">
          Status:
        </span>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setFilter("status", s.value)}
            className={btnCls(status === s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {children(filtered)}
    </div>
  );
}
