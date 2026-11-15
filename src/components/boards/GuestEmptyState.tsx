"use client";

import Link from "next/link";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { InvitationsSection } from "@/components/notifications/InvitationsSection";
import { Button } from "@/components/ui/button";
import { useInvitations } from "@/lib/collaboration/use-invitations";
import { useInvitationResponses } from "@/lib/collaboration/use-invitation-responses";

/**
 * /home for a guest who can open no board yet. A guest cannot create boards
 * (`boards_block_guest_insert`), so there is no create control here, unlike
 * `FirstBoardEmptyState`: it says where shared work will show up and lists any
 * invitations still waiting for an answer.
 *
 * The invitations come from the same query the notifications bell uses (same
 * key, so one shared read), and accept / decline behave exactly as in the bell.
 */
export function GuestEmptyState({
  orgName,
  userId,
  hasFolders,
}: {
  orgName: string;
  userId: string;
  /** The guest is on at least one folder (it may simply hold no boards yet). */
  hasFolders: boolean;
}) {
  const { invites } = useInvitations(userId);
  const { onAccept, onDecline, pendingId, error } = useInvitationResponses(
    userId,
    invites,
  );

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg text-center">
        <div className="bg-surface mx-auto flex size-12 items-center justify-center rounded-lg border">
          <MonolithMark className="text-foreground size-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          You&apos;re a guest in {orgName}
        </h1>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm text-pretty">
          Folders and boards that people share with you will appear here.
          {hasFolders
            ? " The folders you were added to have no boards yet."
            : " Nothing has been shared with you yet."}
        </p>

        {hasFolders ? (
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href="/dashboards">Open your folders</Link>
            </Button>
          </div>
        ) : null}

        {invites.length > 0 ? (
          <div className="bg-surface mt-8 overflow-hidden rounded-lg border text-left [&>div]:border-b-0">
            <InvitationsSection
              invites={invites}
              onAccept={onAccept}
              onDecline={onDecline}
              pendingId={pendingId}
              error={error}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
