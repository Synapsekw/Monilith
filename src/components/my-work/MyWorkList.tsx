import Link from "next/link";
import { ListTodo } from "lucide-react";
import { ColorChip } from "@/components/ui/color-chip";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";
import type { MyWorkGroup, MyWorkItem } from "@/lib/my-work/bucket";

/** `YYYY-MM-DD` → compact `Jul 4`, parsed in UTC so no timezone drift. */
function formatDue(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Row({ item, today }: { item: MyWorkItem; today: string }) {
  const overdue = item.dueDate !== null && item.dueDate < today;
  return (
    <li>
      <Link
        href={`/boards/${item.boardId}?item=${item.itemId}`}
        className="hover:bg-accent/50 flex items-center gap-3 px-4 py-2.5 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.itemName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {item.boardName}
            {item.groupName ? ` · ${item.groupName}` : ""}
          </p>
        </div>
        {item.status ? (
          <ColorChip
            color={item.status.color}
            className="max-w-40 shrink-0 truncate"
          >
            {item.status.label}
          </ColorChip>
        ) : null}
        {item.dueDate ? (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums",
              overdue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {formatDue(item.dueDate)}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <div className="bg-surface-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <ListTodo className="size-6" />
      </div>
      <h2 className="text-sm font-medium">Nothing assigned to you yet</h2>
      <p className="text-muted-foreground text-sm">
        When someone assigns you to an item on any board, it shows up here —
        sorted by when it&apos;s due.
      </p>
    </div>
  );
}

/**
 * Server-rendered list of the current user's assigned items, grouped by due-date
 * bucket. Each row deep-links to the item on its board via the existing
 * `/boards/{id}?item={itemId}` param (the board reads it through
 * `useSearchParams()` to open the ItemPanel — same link the command palette
 * uses). Presentational only: buckets are computed on the server.
 */
export function MyWorkList({
  groups,
  today,
}: {
  groups: MyWorkGroup[];
  today: string;
}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return <EmptyState />;

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.bucket}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <Kicker
                className={cn(group.bucket === "overdue" && "text-destructive")}
              >
                {group.label}
              </Kicker>
              <span className="text-muted-foreground text-xs tabular-nums">
                {group.items.length}
              </span>
            </div>
            <ul className="bg-surface divide-y overflow-hidden rounded-[14px] border">
              {group.items.map((item) => (
                <Row key={item.itemId} item={item} today={today} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
