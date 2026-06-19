"use client";

import type { AppNotification } from "@/lib/collaboration/notifications-cache";

function label(n: AppNotification): string {
  switch (n.kind) {
    case "mention":
      return "mentioned you in an update";
    case "assigned":
      return "assigned you to an item";
    case "automation":
      return "an automation ran on an item";
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
    return (
      <p className="text-muted-foreground p-4 text-center text-sm">
        No notifications.
      </p>
    );
  }
  return (
    <ul className="max-h-96 overflow-y-auto">
      {notifications.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            className="hover:bg-accent flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm"
          >
            {!n.read_at && (
              <span
                className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                aria-label="unread"
              />
            )}
            <span className={n.read_at ? "text-muted-foreground" : ""}>
              {label(n)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
