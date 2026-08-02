"use client";

import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/lib/collaboration/use-notifications";
import { useNotificationMutations } from "@/lib/collaboration/use-notification-mutations";
import { useInvitations } from "@/lib/collaboration/use-invitations";
import { useInvitationMutations } from "@/lib/collaboration/use-invitation-mutations";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";
import { NotificationsList } from "./NotificationsList";
import { InvitationsSection } from "./InvitationsSection";

export function NotificationsBell({ userId }: { userId: string }) {
  const { query, unread } = useNotifications(userId);
  const { markRead, markAllRead } = useNotificationMutations(userId);
  const { invites, count: inviteCount } = useInvitations(userId);
  const { accept, decline } = useInvitationMutations(userId);

  const badge = unread + inviteCount;
  const pendingId = accept.isPending
    ? ((accept.variables as string | undefined) ?? null)
    : decline.isPending
      ? ((decline.variables as string | undefined) ?? null)
      : null;
  const inviteError = (accept.error ?? decline.error)?.message ?? null;

  function open(n: AppNotification) {
    markRead(n.id);
    if (n.kind === "health_digest") {
      // Org-wide digest has no board/item FK — land on the dashboards index.
      window.location.assign("/dashboards");
      return;
    }
    if (n.kind === "account_deleted") {
      // Also no board/item FK. The matching `account.self_deleted` audit row is
      // already rendered by the org activity list on the members page.
      window.location.assign("/settings/members");
      return;
    }
    if (n.board_id) {
      const u = new URL(window.location.origin + `/boards/${n.board_id}`);
      if (n.item_id) u.searchParams.set("item", n.item_id);
      // Cross-board jump → a real navigation is correct here (unlike in-board
      // view/panel toggles, which use the History API to avoid an RSC refetch).
      window.location.assign(u.toString());
    }
  }

  function onAccept(id: string) {
    // Membership is server data → reload to pull the new org context + boards.
    accept.mutate(id, {
      onSuccess: () => window.location.assign("/"),
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="hover:bg-state-hover focus-visible:ring-ring relative grid size-9 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <Bell className="size-4" />
        {badge > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4">
            {badge > 9 ? "9+" : badge}
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
        <InvitationsSection
          invites={invites}
          onAccept={onAccept}
          onDecline={(id) => decline.mutate(id)}
          pendingId={pendingId}
          error={inviteError}
        />
        <NotificationsList
          notifications={query.data?.notifications ?? []}
          onOpen={open}
        />
      </PopoverContent>
    </Popover>
  );
}
