"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Tables } from "@/types/database.types";
import { cn } from "@/lib/utils";
import {
  statusToneClasses,
  type StatusColor,
} from "@/components/ui/status-pill";

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

const KIND_LABELS: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  planned: "Planned",
  in_progress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
};

const STATUS_TONE: Record<string, StatusColor> = {
  new: "blue",
  triaged: "teal",
  planned: "purple",
  in_progress: "orange",
  resolved: "green",
  declined: "gray",
};

/**
 * Client filter bar + list for the admin feedback page.
 * Operates entirely over the already-loaded rows — zero new server round-trips.
 * Filter state is synced to the URL via window.history.replaceState so it
 * survives a refresh without triggering RSC navigation. useSearchParams() is the
 * reactive source-of-truth; no separate useState needed.
 *
 * Note: renders the list itself (rather than taking a render-prop child) because
 * a function child cannot cross the Server→Client boundary from the RSC page.
 */
export function FeedbackFilters({ rows }: { rows: Row[] }) {
  const searchParams = useSearchParams();

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
    // Reset pagination when a filter changes.
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

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No feedback matches the current filter.
        </p>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border">
          <div className="text-muted-foreground grid grid-cols-[0.5fr_2fr_1fr_1fr_90px] gap-3 border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase">
            <span>Kind</span>
            <span>Title</span>
            <span>Submitted</span>
            <span>Status</span>
            <span />
          </div>
          {filtered.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[0.5fr_2fr_1fr_1fr_90px] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <span className="text-muted-foreground text-xs">
                {KIND_LABELS[row.kind] ?? row.kind}
              </span>
              <span className="text-foreground truncate font-medium">
                {row.title}
              </span>
              <span className="text-muted-foreground">
                {new Date(row.created_at).toLocaleDateString()}
              </span>
              <span>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusToneClasses(STATUS_TONE[row.status] ?? "gray", "solid")}`}
                >
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </span>
              <Link
                href={`/admin/feedback/${row.id}`}
                className="text-primary text-right text-xs font-medium"
              >
                Review →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
