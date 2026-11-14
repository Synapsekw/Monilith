"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFolderWorkload } from "@/lib/folders/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkloadBars,
  type WorkloadPerson,
} from "@/components/folders/charts/WorkloadBars";
import {
  peopleFromWorkload,
  workloadKey,
} from "@/components/folders/tabs/People";
import type { FolderMember } from "@/lib/folders/types";
import { Panel } from "./Panel";

export const PEOPLE_SHOWN = 8;

/** True once the element is near the viewport. Where IntersectionObserver is
 *  missing (jsdom, very old browsers) it is true at once. */
function useNearViewport<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const el = ref.current;
    if (near || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return { ref, near };
}

/**
 * Open and late work per person on the Overview. Reads the SAME query the
 * People tab reads (same key, 60 s stale time), fetched when this section
 * nears the viewport — never on first paint. Stage changes re-derive from the
 * cache.
 */
export function PeoplePanel({
  kicker,
  title = "Open work by person",
  folderId,
  stage,
  members,
  onSeeAll,
}: {
  kicker: string;
  title?: string;
  folderId: string;
  stage: string | null;
  members: FolderMember[];
  /** Opens the People tab. Omitted when the layout has no People tab. */
  onSeeAll?: () => void;
}) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const q = useQuery({
    queryKey: workloadKey(folderId),
    queryFn: async () => {
      const res = await getFolderWorkload({ folderId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
    enabled: near,
  });

  let body;
  if (q.isError)
    body = (
      <div className="flex flex-col items-start gap-2">
        <EmptyState variant="inline">
          Couldn&apos;t load workload. {q.error.message}
        </EmptyState>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void q.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  else if (!q.data)
    body = <Skeleton data-testid="people-skeleton" className="h-40 w-full" />;
  else {
    const people = peopleFromWorkload(q.data, stage, members);
    const loose = q.data.filter(
      (r) => r.userId === null && (stage === null || r.stageKey === stage),
    );
    const looseOpen = loose.reduce((s, r) => s + r.open, 0);
    const unassigned: WorkloadPerson | null =
      looseOpen === 0
        ? null
        : {
            userId: null,
            name: "Unassigned",
            avatarUrl: null,
            open: looseOpen,
            overdue: loose.reduce((s, r) => s + r.overdue, 0),
          };
    const shown = people.slice(0, PEOPLE_SHOWN);
    body = (
      <>
        <WorkloadBars people={unassigned ? [...shown, unassigned] : shown} />
        {people.length > PEOPLE_SHOWN && onSeeAll ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={onSeeAll}
          >
            See all {people.length}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div ref={ref}>
      <Panel kicker={kicker} title={title}>
        {body}
      </Panel>
    </div>
  );
}
