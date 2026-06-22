"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CapacityCell } from "./CapacityCell";
import { MemberRowHeader } from "./MemberRowHeader";
import { CapacityEditor } from "./CapacityEditor";
import { WorkloadDefaultsDialog } from "./WorkloadDefaultsDialog";
import { buildWorkloadGrid, filterByBoards } from "@/lib/workload/rollup";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadActualRow,
  WorkloadBoard,
  WorkloadMember,
  WorkloadMetric,
  WorkloadRawRow,
  WorkloadWorkspace,
} from "@/lib/workload/types";

type SortKey = "name" | "load";

const SORT_LABEL: Record<SortKey, string> = {
  name: "Name",
  load: "Total load",
};

const METRIC_LABEL: Record<WorkloadMetric, string> = {
  planned: "Planned",
  actual: "Actual",
  both: "Both",
};

/**
 * In-page filters/sorts are client state over already-loaded rows: push them
 * into the URL via the History API so Next syncs them into `useSearchParams()`
 * and this component re-renders WITHOUT re-running the server component (0
 * round-trips). A `<Link>`/`router.push` here would refetch the whole page on
 * each interaction. See AGENTS.md §5 / gotcha-09.
 */
function setParam(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.pushState(null, "", url);
}

/** Compact monochrome listbox popover used for the workspace + board filters. */
function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="hover:bg-accent/50 focus-visible:ring-ring text-foreground inline-flex h-7 max-w-40 items-center gap-1 truncate rounded border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {current ? current.label : allLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="listbox"
        aria-label={label}
        align="start"
        sideOffset={4}
        className="flex max-h-72 min-w-44 flex-col gap-0.5 overflow-auto p-1"
      >
        <button
          type="button"
          role="option"
          aria-selected={value === null}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          className={cn(
            "hover:bg-accent focus-visible:ring-ring rounded px-2 py-1 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
            value === null && "bg-accent",
          )}
        >
          {allLabel}
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={value === o.value}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className={cn(
              "hover:bg-accent focus-visible:ring-ring truncate rounded px-2 py-1 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
              value === o.value && "bg-accent",
            )}
          >
            {o.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function WorkloadGrid({
  rawRows,
  actuals,
  members,
  capacities,
  defaults,
  boards,
  workspaces,
  today,
  weeksBack,
  weeksFwd,
  weekStartsOn,
  currentUserId,
  isOrgAdmin,
}: {
  rawRows: WorkloadRawRow[];
  actuals: WorkloadActualRow[];
  members: WorkloadMember[];
  capacities: MemberCapacity[];
  defaults: OrgWorkloadDefaults;
  boards: WorkloadBoard[];
  workspaces: WorkloadWorkspace[];
  today: string;
  weeksBack: number;
  weeksFwd: number;
  weekStartsOn: number;
  currentUserId: string;
  isOrgAdmin: boolean;
}) {
  const params = useSearchParams();
  const sort: SortKey = params.get("sort") === "load" ? "load" : "name";
  const rawMetric = params.get("metric");
  const metric: WorkloadMetric =
    rawMetric === "actual" || rawMetric === "both" ? rawMetric : "planned";
  const wsId = params.get("ws");
  const boardId = params.get("board");

  // Board options reflect the selected workspace (Monday-style scoping).
  const boardOptions = useMemo(
    () =>
      boards
        .filter((b) => (wsId ? b.workspaceId === wsId : true))
        .map((b) => ({ value: b.id, label: b.name })),
    [boards, wsId],
  );

  // Resolve the active board id set: explicit board wins, else all boards in the
  // selected workspace, else null (no filter).
  const boardIds: Set<string> | null = useMemo(() => {
    if (boardId) return new Set([boardId]);
    if (wsId)
      return new Set(
        boards.filter((b) => b.workspaceId === wsId).map((b) => b.id),
      );
    return null;
  }, [boardId, wsId, boards]);

  // Filter raw rows + actuals, then assemble the grid CLIENT-SIDE (0 refetch).
  const grid = useMemo(() => {
    const rows = filterByBoards(rawRows, boardIds);
    const acts = filterByBoards(actuals, boardIds);
    return buildWorkloadGrid(
      rows,
      members,
      capacities,
      defaults,
      today,
      weeksBack,
      weeksFwd,
      weekStartsOn,
      acts,
    );
  }, [
    rawRows,
    actuals,
    boardIds,
    members,
    capacities,
    defaults,
    today,
    weeksBack,
    weeksFwd,
    weekStartsOn,
  ]);

  const capById = useMemo(() => {
    const m = new Map<string, MemberCapacity>();
    for (const c of capacities) m.set(c.userId, c);
    return m;
  }, [capacities]);

  // The synthetic Unassigned row (userId === null) always stays pinned at top;
  // only the member rows are sorted by the in-page control.
  const sortedRows = useMemo(() => {
    const unassigned = grid.rows.filter((r) => r.userId === null);
    const memberRows = grid.rows.filter((r) => r.userId !== null);
    memberRows.sort((a, b) => {
      if (sort === "load") return b.totalEffortSecs - a.totalEffortSecs;
      const an = a.member?.fullName ?? a.member?.email ?? "";
      const bn = b.member?.fullName ?? b.member?.email ?? "";
      return an.localeCompare(bn);
    });
    return [...unassigned, ...memberRows];
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
        <div className="flex flex-wrap items-center gap-3">
          {workspaces.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Workspace</span>
              <FilterSelect
                label="Filter by workspace"
                allLabel="All workspaces"
                value={wsId}
                options={workspaces.map((w) => ({
                  value: w.id,
                  label: w.name,
                }))}
                // Changing workspace clears any board selection (board scoping).
                onChange={(v) => setParam({ ws: v, board: null })}
              />
            </div>
          ) : null}
          {boards.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Board</span>
              <FilterSelect
                label="Filter by board"
                allLabel="All boards"
                value={boardId}
                options={boardOptions}
                onChange={(v) => setParam({ board: v })}
              />
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Show</span>
            <div className="flex gap-1">
              {(["planned", "actual", "both"] as WorkloadMetric[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={metric === m}
                  onClick={() =>
                    setParam({ metric: m === "planned" ? null : m })
                  }
                  className={cn(
                    "focus-visible:ring-ring rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    metric === m
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {METRIC_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Sort</span>
            <div className="flex gap-1">
              {(["name", "load"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={sort === k}
                  onClick={() => setParam({ sort: k })}
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
                        actualSecs={cell.actualSecs}
                        state={cell.state}
                        metric={metric}
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
