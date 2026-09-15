"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getFolderWorkload } from "@/lib/folders/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OVERLOAD_THRESHOLD,
  WorkloadBars,
  type WorkloadPerson,
} from "@/components/folders/charts/WorkloadBars";
import type { FolderMember, WorkloadRow } from "@/lib/folders/types";

export const workloadKey = (folderId: string) =>
  ["folder-workload", folderId] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Per-person totals for the selected stage; the null (unassigned) row is excluded. */
export function peopleFromWorkload(
  rows: WorkloadRow[],
  stage: string | null,
  members: FolderMember[],
): WorkloadPerson[] {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const acc = new Map<string, WorkloadPerson>();
  for (const r of rows) {
    if (r.userId === null) continue;
    if (stage !== null && r.stageKey !== stage) continue;
    const m = byId.get(r.userId);
    const cur = acc.get(r.userId) ?? {
      userId: r.userId,
      name: m?.fullName ?? "Unknown member",
      avatarUrl: m?.avatarUrl ?? null,
      open: 0,
      overdue: 0,
    };
    cur.open += r.open;
    cur.overdue += r.overdue;
    acc.set(r.userId, cur);
  }
  return [...acc.values()].sort(
    (a, b) => b.open - a.open || a.name.localeCompare(b.name),
  );
}

/**
 * Spec §6: folder_workload is fetched ONCE on first open (Server Action →
 * TanStack Query, staleTime 60 s); stage switches re-derive from the cache.
 */
export function PeopleTab({
  folderId,
  stage,
  members,
  onWorkload,
}: {
  folderId: string;
  stage: string | null;
  members: FolderMember[];
  onWorkload: (rows: WorkloadRow[]) => void;
}) {
  const q = useQuery({
    queryKey: workloadKey(folderId),
    queryFn: async () => {
      const res = await getFolderWorkload({ folderId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
  useEffect(() => {
    if (q.data) onWorkload(q.data);
  }, [q.data, onWorkload]);

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError)
    return (
      <EmptyState variant="inline">
        Couldn&apos;t load workload. {q.error.message}
      </EmptyState>
    );

  const rows = q.data;
  const people = peopleFromWorkload(rows, stage, members);
  const byId = new Map(members.map((m) => [m.userId, m]));
  const owns = new Map<
    string,
    { boards: Set<string>; open: number; overdue: number }
  >();
  for (const r of rows) {
    if (r.userId === null) continue;
    const cur = owns.get(r.userId) ?? {
      boards: new Set<string>(),
      open: 0,
      overdue: 0,
    };
    cur.boards.add(r.boardName);
    cur.open += r.open;
    cur.overdue += r.overdue;
    owns.set(r.userId, cur);
  }
  const unassigned = rows.filter(
    (r) => r.userId === null && (stage === null || r.stageKey === stage),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4 lg:col-span-2">
        <div>
          <Kicker>01</Kicker>
          <h2 className="text-sm font-semibold">Workload</h2>
          <p className="text-muted-foreground text-xs">
            Open items per person · red above {OVERLOAD_THRESHOLD}
          </p>
        </div>
        <WorkloadBars people={people} />
      </section>
      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <Kicker>02</Kicker>
          <h2 className="text-sm font-semibold">Who owns what</h2>
        </div>
        {owns.size === 0 ? (
          <EmptyState variant="inline">No owners yet.</EmptyState>
        ) : (
          <ul className="divide-y text-xs">
            {[...owns.entries()].map(([userId, o]) => {
              const name = byId.get(userId)?.fullName ?? "Unknown member";
              const boards = [...o.boards].sort().join(", ");
              return (
                <li
                  key={userId}
                  title={name}
                  aria-label={`${name}: ${boards}, ${o.open} open, ${o.overdue} overdue`}
                  className="flex items-center gap-2 py-2"
                >
                  <Avatar className="size-6 shrink-0">
                    <AvatarFallback className="text-2xs">
                      {initials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {boards}
                  </span>
                  <span className="font-mono tabular-nums">
                    {o.open} open · {o.overdue} overdue
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="bg-surface flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <Kicker>03</Kicker>
          <h2 className="text-sm font-semibold">Unassigned</h2>
        </div>
        {unassigned.length === 0 ? (
          <EmptyState variant="inline">
            Every open item has an owner.
          </EmptyState>
        ) : (
          <ul className="divide-y text-xs">
            {unassigned.map((r) => (
              <li key={`${r.boardId}:${r.stageKey}`} className="py-2">
                <Link
                  href={`/boards/${r.boardId}`}
                  className="hover:text-foreground font-medium"
                >
                  Unassigned · {r.open} open · {r.boardName} · {r.stageName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
