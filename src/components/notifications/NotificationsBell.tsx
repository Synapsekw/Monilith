"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/lib/collaboration/use-notifications";
import { useNotificationMutations } from "@/lib/collaboration/use-notification-mutations";
import { useInvitations } from "@/lib/collaboration/use-invitations";
import {
  takeInviteFlash,
  useInvitationResponses,
} from "@/lib/collaboration/use-invitation-responses";
import {
  invitationSummary,
  type PendingInvitation,
} from "@/lib/collaboration/invitations";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";
import { getDesktopBridge } from "@/lib/desktop/bridge";
import { NotificationsList } from "./NotificationsList";
import { InvitationsSection } from "./InvitationsSection";

/** Per-user list of invitation ids this browser has already announced. */
const announcedKey = (userId: string) => `monolith:invites-announced:${userId}`;
const ANNOUNCED_CAP = 100;

function readAnnounced(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(announcedKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function unannouncedInvitations(
  userId: string,
  invites: readonly PendingInvitation[],
): PendingInvitation[] {
  if (!userId || invites.length === 0) return [];
  const seen = new Set(readAnnounced(userId));
  return invites.filter((i) => !seen.has(i.id));
}

function markAnnounced(
  userId: string,
  invites: readonly PendingInvitation[],
): void {
  try {
    const ids = [
      ...new Set([...invites.map((i) => i.id), ...readAnnounced(userId)]),
    ].slice(0, ANNOUNCED_CAP);
    window.localStorage.setItem(announcedKey(userId), JSON.stringify(ids));
  } catch {
    // Storage unavailable: the badge is still the cue.
  }
}

export function NotificationsBell({ userId }: { userId: string }) {
  const { query, unread } = useNotifications(userId);
  const { markRead, markAllRead } = useNotificationMutations(userId);
  const { invites, count: inviteCount } = useInvitations(userId);
  const {
    onAccept,
    onDecline,
    pendingId,
    error: inviteError,
  } = useInvitationResponses(userId, invites);
  const [bellOpen, setBellOpen] = useState(false);

  const badge = unread + inviteCount;

  // After an accept the page was reloaded onto the folder; say what happened.
  useEffect(() => {
    const message = takeInviteFlash();
    if (message) toast.success(message);
  }, []);

  // A pending invitation must not depend on someone noticing a badge: the
  // first time this browser sees one (an invite that arrived while they were
  // away, found on their next sign-in, or pushed live), say so once and offer
  // to open it. Uses the invitations the bell already loaded: no extra read.
  useEffect(() => {
    const fresh = unannouncedInvitations(userId, invites);
    if (fresh.length === 0) return;
    markAnnounced(userId, invites);
    toast(
      fresh.length === 1
        ? invitationSummary(fresh[0])
        : `You have ${fresh.length} pending invitations`,
      {
        description: "Open your notifications to accept or decline.",
        action: { label: "View", onClick: () => setBellOpen(true) },
        duration: 12000,
      },
    );
  }, [userId, invites]);

  useEffect(() => {
    // The desktop shell exposes `window.monolith` via its preload bridge; in a
    // plain browser this is undefined and the effect is a no-op. Guarding on the
    // object rather than a user-agent sniff keeps the web build unaware of the
    // desktop app.
    //
    // Publishes `badge`, not `unread`: that is the number rendered in the bell
    // above, and a dock showing 2 while the bell shows 3 reads as a bug.
    getDesktopBridge()?.setBadge?.(badge);
  }, [badge]);

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

  return (
    <Popover open={bellOpen} onOpenChange={setBellOpen}>
      <PopoverTrigger
        aria-label="Notifications"
        className="hover:bg-state-hover focus-visible:ring-ring relative grid size-9 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <Bell className="size-4" />
        {badge > 0 && (
          <span className="bg-primary text-primary-foreground text-3xs absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 leading-4">
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
          onDecline={onDecline}
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
