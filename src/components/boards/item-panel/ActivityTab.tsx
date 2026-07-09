"use client";

import {
  resolveActivity,
  type Column,
  type Member,
} from "@/lib/collaboration/activity";
import type { ActivityCache } from "@/lib/collaboration/cache";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityRow } from "./ActivityRow";

export function ActivityTab({
  cache,
  isError = false,
  columns,
  members,
}: {
  cache: ActivityCache | undefined;
  isError?: boolean;
  columns: readonly Column[];
  members: readonly Member[];
}) {
  // A failed fetch is distinct from "no activity" — the read now surfaces
  // isError (was silently cached as an empty success) so we show a retryable
  // message instead of a misleading empty state.
  if (isError) {
    return (
      <EmptyState variant="inline">
        Couldn&apos;t load activity. Reopen the item to try again.
      </EmptyState>
    );
  }
  if (!cache || cache.activities.length === 0) {
    return <EmptyState variant="inline">No activity yet.</EmptyState>;
  }
  return (
    <ul className="flex flex-col">
      {cache.activities.map((a) => (
        <ActivityRow
          key={a.id}
          descriptor={resolveActivity(a, columns, members)}
          actorName={
            members.find((m) => m.userId === a.actor_id)?.fullName ?? "Someone"
          }
          when={a.created_at}
        />
      ))}
    </ul>
  );
}
