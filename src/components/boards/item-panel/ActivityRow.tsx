"use client";

import type { ActivityDescriptor } from "@/lib/collaboration/activity";
import { pillTextColor } from "@/lib/boards/contrast";

function Chip({
  value,
}: {
  value: { label: string; color: string } | string | null;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "string") return <span>{value}</span>;
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: value.color,
        color: pillTextColor(value.color),
      }}
    >
      {value.label}
    </span>
  );
}

export function ActivityRow({
  descriptor,
  actorName,
  when,
}: {
  descriptor: ActivityDescriptor;
  actorName: string;
  when: string;
}) {
  const time = new Date(when).toLocaleString();
  return (
    <li className="bg-surface-muted border-border flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="text-foreground font-bold">{actorName}</span>
        <span className="text-kicker text-3xs font-mono tracking-wide uppercase">
          {time}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {descriptor.kind === "item_created" && <span>created this item</span>}
        {descriptor.kind === "item_deleted" && <span>deleted this item</span>}
        {descriptor.kind === "item_moved" && (
          <span>moved this item to another group</span>
        )}
        {descriptor.kind === "update_added" && <span>posted an update</span>}
        {descriptor.kind === "item_renamed" && (
          <>
            <span>renamed</span>
            <Chip value={descriptor.from} /> <span aria-hidden>→</span>{" "}
            <Chip value={descriptor.to} />
          </>
        )}
        {descriptor.kind === "cell_changed" && (
          <>
            <span className="text-muted-foreground">
              {descriptor.columnName}:
            </span>
            <Chip value={descriptor.from} /> <span aria-hidden>→</span>{" "}
            <Chip value={descriptor.to} />
          </>
        )}
      </div>
    </li>
  );
}
