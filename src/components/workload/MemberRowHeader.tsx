import { cn } from "@/lib/utils";
import type { WorkloadMember } from "@/lib/workload/types";

function initials(member: WorkloadMember | null): string {
  if (!member) return "—";
  const source = member.fullName ?? member.email ?? "";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function displayName(member: WorkloadMember | null): string {
  if (!member) return "Unassigned";
  return member.fullName ?? member.email ?? "Unnamed member";
}

/** Whole-hour readout. */
function hours(secs: number): string {
  return `${Math.round(secs / 3600)}h`;
}

/**
 * Sticky-left member identity for a workload row: avatar initials, name, and the
 * row's total effort across the visible window. The synthetic Unassigned row
 * (member === null) is visually distinct.
 */
export function MemberRowHeader({
  member,
  totalEffortSecs,
  totalCapacitySecs,
  trailing,
}: {
  member: WorkloadMember | null;
  totalEffortSecs: number;
  totalCapacitySecs: number;
  trailing?: React.ReactNode;
}) {
  const isUnassigned = member === null;
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
          isUnassigned
            ? "border-border text-muted-foreground border border-dashed"
            : "bg-surface-muted text-foreground",
        )}
        aria-hidden
      >
        {initials(member)}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium",
            isUnassigned && "text-muted-foreground",
          )}
        >
          {displayName(member)}
        </p>
        <p className="text-muted-foreground text-[11px] tabular-nums">
          {hours(totalEffortSecs)}
          {!isUnassigned && totalCapacitySecs > 0
            ? ` / ${hours(totalCapacitySecs)}`
            : ""}
        </p>
      </div>
      {trailing}
    </div>
  );
}
