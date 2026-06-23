"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { hours } from "@/lib/workload/rollup";
import type { DayActual } from "@/lib/workload/types";

/** Weekday + month/day label for an ISO date, computed in UTC so SSR/CSR agree. */
function dayLabel(iso: string): string {
  return new Date(Date.parse(iso + "T00:00:00Z")).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Per-day actuals behind one (member, week) cell — the drill-down popover.
 * Presentational: the parent resolves `days` via `actualsForCell` (a pure filter
 * over already-loaded actuals → 0 round-trips, spec §5). Mirrors the monochrome
 * FilterSelect popover idiom in WorkloadGrid. Color is never used to convey
 * meaning here (hours carry it), keeping it AA + colorblind-safe (pulse-ui).
 */
export function DayActualsPopover({
  weekLabel,
  memberName,
  days,
  children,
}: {
  weekLabel: string;
  memberName: string;
  days: DayActual[];
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={4}
        className="min-w-48 p-2"
        aria-label={`${memberName} — actuals for week of ${weekLabel}`}
      >
        <p className="text-muted-foreground mb-1 px-1 text-[11px] font-medium">
          {memberName} · week of {weekLabel}
        </p>
        {days.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">
            No logged time this week.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {days.map((d) => (
              <li
                key={d.day}
                className="flex items-center justify-between rounded px-1 py-0.5 text-xs"
              >
                <span className="text-foreground">{dayLabel(d.day)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {hours(d.secs)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
