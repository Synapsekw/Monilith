"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { ProgressBar } from "./ProgressBar";
import { GoalStatusPill } from "./GoalStatusPill";
import type { GoalNode, GoalStatus } from "@/lib/goals/types";

type SortKey = "name" | "progress" | "status";

const SORT_LABEL: Record<SortKey, string> = {
  name: "Name",
  progress: "Progress",
  status: "Status",
};

const STATUS_RANK: Record<GoalStatus, number> = {
  off_track: 0,
  at_risk: 1,
  on_track: 2,
  done: 3,
};

/**
 * In-page sort/expand is client state over already-loaded rows. The sort key
 * lives in the URL via the History API so Next syncs it into
 * `useSearchParams()` without re-running the server component (0 round-trips).
 * Opening a goal sets `?goal=<id>` the same way (the drawer reads it).
 */
function setSort(key: SortKey) {
  const url = new URL(window.location.href);
  url.searchParams.set("sort", key);
  window.history.pushState(null, "", url);
}
function openGoal(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("goal", id);
  window.history.pushState(null, "", url);
}

function sortNodes(nodes: GoalNode[], sort: SortKey): GoalNode[] {
  const sorted = nodes.slice().sort((a, b) => {
    switch (sort) {
      case "progress":
        return (b.progress ?? -1) - (a.progress ?? -1);
      case "status":
        return (
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          a.name.localeCompare(b.name)
        );
      default:
        return a.name.localeCompare(b.name);
    }
  });
  return sorted.map((n) => ({ ...n, children: sortNodes(n.children, sort) }));
}

function readout(node: GoalNode): string {
  switch (node.progressMode) {
    case "manual_number":
      if (node.targetValue == null) return "";
      return `${node.currentValue ?? 0} / ${node.targetValue}${node.unit ? ` ${node.unit}` : ""}`;
    default:
      return "";
  }
}

function GoalRow({
  node,
  depth,
  expanded,
  toggle,
}: {
  node: GoalNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  return (
    <>
      <tr className="hover:bg-state-hover/30 border-t transition-colors">
        <td className="px-3 py-2">
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: depth * 20 }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-label={isOpen ? "Collapse" : "Expand"}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </button>
            ) : (
              <span className="inline-block size-4" />
            )}
            <button
              type="button"
              onClick={() => openGoal(node.id)}
              className="focus-visible:ring-ring rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {node.name}
            </button>
            {readout(node) ? (
              <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                {readout(node)}
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2">
          <ProgressBar progress={node.progress} />
        </td>
        <td className="px-3 py-2">
          <GoalStatusPill status={node.status} autoHealth={node.autoHealth} />
        </td>
        <td className="text-muted-foreground px-3 py-2 text-xs">
          {node.owner?.fullName ?? node.owner?.email ?? "—"}
        </td>
      </tr>
      {isOpen
        ? node.children.map((c) => (
            <GoalRow
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
            />
          ))
        : null}
    </>
  );
}

export function GoalTree({ tree }: { tree: GoalNode[] }) {
  const params = useSearchParams();
  const rawSort = params.get("sort");
  const sort: SortKey =
    rawSort === "progress" || rawSort === "status" ? rawSort : "name";

  // Expand all parents by default so the cascade reads at a glance.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    const walk = (nodes: GoalNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) ids.add(n.id);
        walk(n.children);
      }
    };
    walk(tree);
    return ids;
  });
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sorted = useMemo(() => sortNodes(tree, sort), [tree, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        <span className="text-muted-foreground text-xs">Sort by</span>
        <div className="flex gap-1">
          {(["name", "progress", "status"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={sort === k}
              onClick={() => setSort(k)}
              className={cn(
                "focus-visible:ring-ring rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                sort === k
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-state-hover/50 hover:text-foreground",
              )}
            >
              {SORT_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground bg-card sticky top-0 z-10 text-left text-xs">
            <tr className="border-b">
              {["Goal", "Progress", "Status", "Owner"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium" scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((node) => (
              <GoalRow
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                toggle={toggle}
              />
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="text-muted-foreground px-3 py-8 text-center text-sm"
                >
                  No goals yet. Create one to start tracking objectives.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
