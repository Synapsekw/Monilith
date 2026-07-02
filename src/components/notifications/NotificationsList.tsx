"use client";

import { EmptyState } from "@/components/ui/empty-state";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";

function label(n: AppNotification): string {
  switch (n.kind) {
    case "mention":
      return "mentioned you in an update";
    case "assigned":
      return "assigned you to an item";
    case "automation":
      return "an automation ran on an item";
    case "feedback_response":
      return "updated your feedback request";
    default:
      return "updated an item you follow";
  }
}

export function NotificationsList({
  notifications,
  onOpen,
}: {
  notifications: readonly AppNotification[];
  onOpen: (n: AppNotification) => void;
}) {
  if (notifications.length === 0) {
    return <EmptyState variant="inline">No notifications.</EmptyState>;
  }
  return (
    <ul className="max-h-96 overflow-y-auto">
      {notifications.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            className="hover:bg-accent focus-visible:ring-ring flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            {/* Always render the dot slot (transparent when read) so row text
                aligns regardless of read state. */}
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${
                n.read_at ? "bg-transparent" : "bg-primary"
              }`}
              aria-label={n.read_at ? undefined : "unread"}
              aria-hidden={n.read_at ? true : undefined}
            />
            <span className={n.read_at ? "text-muted-foreground" : ""}>
              {label(n)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
