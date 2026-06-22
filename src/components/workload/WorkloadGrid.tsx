"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { CapacityCell } from "./CapacityCell";
import { MemberRowHeader } from "./MemberRowHeader";
import { CapacityEditor } from "./CapacityEditor";
import { WorkloadDefaultsDialog } from "./WorkloadDefaultsDialog";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadGrid as WorkloadGridData,
} from "@/lib/workload/types";

type SortKey = "name" | "load";

const SORT_LABEL: Record<SortKey, string> = {
  name: "Name",
  load: "Total load",
};

/**
 * In-page sort is client state over already-loaded rows: push it into the URL
 * via the History API so Next syncs it into `useSearchParams()` and this
 * component re-renders WITHOUT re-running the server component (0 round-trips).
 * A `<Link>`/`router.push` here would refetch the whole page on each sort.
 * See AGENTS.md §5 / gotcha-09.
 */
function setSort(key: SortKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("sort", key);
  window.history.pushState(null, "", url);
}

export function WorkloadGrid({
  grid,
  currentUserId,
  isOrgAdmin,
  capacities,
  defaults,
}: {
  grid: WorkloadGridData;
  currentUserId: string;
  isOrgAdmin: boolean;
  capacities: MemberCapacity[];
  defaults: OrgWorkloadDefaults;
}) {
  const params = useSearchParams();
  const rawSort = params.get("sort");
  const sort: SortKey = rawSort === "load" ? "load" : "name";

  const capById = useMemo(() => {
    const m = new Map<string, MemberCapacity>();
    for (const c of capacities) m.set(c.userId, c);
    return m;
  }, [capacities]);

  // The synthetic Unassigned row (userId === null) always stays pinned at top;
  // only the member rows are sorted by the in-page control.
  const sortedRows = useMemo(() => {
    const unassigned = grid.rows.filter((r) => r.userId === null);
    const members = grid.rows.filter((r) => r.userId !== null);
    members.sort((a, b) => {
      if (sort === "load") return b.totalEffortSecs - a.totalEffortSecs;
      const an = a.member?.fullName ?? a.member?.email ?? "";
      const bn = b.member?.fullName ?? b.member?.email ?? "";
      return an.localeCompare(bn);
    });
    return [...unassigned, ...members];
  }, [grid.rows, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">Workload</h1>
          <p className="text-muted-foreground text-xs">
            Assigned effort vs. capacity, by week. Edit a person&apos;s capacity
            to recolor their row.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Sort</span>
            <div className="flex gap-1">
              {(["name", "load"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={sort === k}
                  onClick={() => setSort(k)}
                  className={cn(
                    "focus-visible:ring-ring rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    sort === k
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {SORT_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          {isOrgAdmin ? (
            <WorkloadDefaultsDialog
              defaultHoursPerDay={defaults.hoursPerDay}
              defaultPerItemHours={defaults.perItemHours}
              defaultWorkingDays={defaults.workingDays}
            />
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                scope="col"
                className="bg-card text-muted-foreground sticky left-0 z-30 w-56 min-w-56 border-r border-b px-4 py-2 text-left text-xs font-medium"
              >
                Member
              </th>
              {grid.window.map((b) => (
                <th
                  key={b.weekKey}
                  scope="col"
                  className="bg-card text-muted-foreground w-24 min-w-24 border-b px-2 py-2 text-center text-xs font-medium"
                >
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const isUnassigned = row.userId === null;
              const canEdit =
                !isUnassigned && (isOrgAdmin || row.userId === currentUserId);
              const cap = row.userId ? capById.get(row.userId) : undefined;
              const memberName =
                row.member?.fullName ?? row.member?.email ?? "Unnamed member";
              return (
                <tr key={row.userId ?? "__unassigned"} className="group">
                  <td
                    className={cn(
                      "bg-background group-hover:bg-accent/20 sticky left-0 z-10 w-56 min-w-56 border-r border-b px-4 py-2",
                      isUnassigned && "bg-surface-muted/40",
                    )}
                  >
                    <MemberRowHeader
                      member={row.member}
                      totalEffortSecs={row.totalEffortSecs}
                      totalCapacitySecs={row.totalCapacitySecs}
                      trailing={
                        canEdit && row.userId ? (
                          <CapacityEditor
                            userId={row.userId}
                            memberName={memberName}
                            hoursPerDay={
                              cap?.hoursPerDay ?? defaults.hoursPerDay
                            }
                            workingDays={
                              cap?.workingDays ?? defaults.workingDays
                            }
                            customized={cap?.customized ?? false}
                          />
                        ) : undefined
                      }
                    />
                  </td>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.weekKey}
                      className="border-b px-1.5 py-1.5 align-middle"
                    >
                      <CapacityCell
                        effortSecs={cell.effortSecs}
                        capacitySecs={cell.capacitySecs}
                        state={cell.state}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={grid.window.length + 1}
                  className="text-muted-foreground px-4 py-10 text-center text-sm"
                >
                  No org members yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
