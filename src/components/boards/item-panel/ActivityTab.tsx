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
  columns,
  members,
}: {
  cache: ActivityCache | undefined;
  columns: readonly Column[];
  members: readonly Member[];
}) {
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
