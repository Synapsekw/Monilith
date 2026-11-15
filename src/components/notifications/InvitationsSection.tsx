"use client";

import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import {
  invitationSummary,
  type PendingInvitation,
} from "@/lib/collaboration/invitations";

export function InvitationsSection({
  invites,
  onAccept,
  onDecline,
  pendingId,
  error,
}: {
  invites: readonly PendingInvitation[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  pendingId?: string | null;
  error?: string | null;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="border-b">
      <Kicker className="block px-3 pt-2">Invitations</Kicker>
      <ul>
        {invites.map((i) => (
          <li key={i.id} className="space-y-2 px-3 py-2 text-sm">
            <p>{invitationSummary(i)}</p>
            <p className="text-muted-foreground text-xs">
              {i.folder_name
                ? "Accepting opens the folder. It also lets the person who invited you collaborate on boards you share from your own workspace."
                : "Accepting also lets the person who invited you collaborate on boards you share from your own workspace."}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pendingId === i.id}
                onClick={() => onAccept(i.id)}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingId === i.id}
                onClick={() => onDecline(i.id)}
              >
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-destructive px-3 pb-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
