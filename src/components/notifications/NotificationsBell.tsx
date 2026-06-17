"use client";

import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/lib/collaboration/use-notifications";
import { useNotificationMutations } from "@/lib/collaboration/use-notification-mutations";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";
import { NotificationsList } from "./NotificationsList";

export function NotificationsBell({ userId }: { userId: string }) {
  const { query, unread } = useNotifications(userId);
  const { markRead, markAllRead } = useNotificationMutations(userId);

  function open(n: AppNotification) {
    markRead(n.id);
    if (n.board_id) {
      const u = new URL(window.location.origin + `/boards/${n.board_id}`);
      if (n.item_id) u.searchParams.set("item", n.item_id);
      // Cross-board jump → a real navigation is correct here (unlike in-board
      // view/panel toggles, which use the History API to avoid an RSC refetch).
      window.location.assign(u.toString());
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="hover:bg-accent focus-visible:ring-ring relative grid size-9 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Mark all read
            </button>
          )}
        </div>
        <NotificationsList
          notifications={query.data?.notifications ?? []}
          onOpen={open}
        />
      </PopoverContent>
    </Popover>
  );
}
