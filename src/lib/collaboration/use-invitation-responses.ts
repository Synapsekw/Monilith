"use client";

import { setActiveOrg } from "@/lib/org/active-actions";
import {
  invitationAcceptedMessage,
  invitationDestination,
  type PendingInvitation,
} from "./invitations";
import { useInvitationMutations } from "./use-invitation-mutations";

/**
 * A message to show after the full-page navigation that follows an accept (a
 * toast raised before it would be torn down with the page). Written here, read
 * and cleared once by the notifications bell on the next page.
 */
export const INVITE_FLASH_KEY = "monolith:invite-flash";

/** Read and clear the pending post-accept message, if any. */
export function takeInviteFlash(): string | null {
  try {
    const message = window.sessionStorage.getItem(INVITE_FLASH_KEY);
    if (message) window.sessionStorage.removeItem(INVITE_FLASH_KEY);
    return message;
  } catch {
    return null;
  }
}

/**
 * Accept / decline for a list of pending invitations, shared by the bell and
 * the guest empty state so both behave the same.
 *
 * Accepting: the membership is created in the browser (`accept_invitation`),
 * the server caches are expired (awaited inside the mutation), the invited org
 * becomes the active org through the existing org switch (`setActiveOrg`,
 * which re-verifies membership), and the person is taken to the folder they
 * were invited to with a message waiting for them there. A failed org switch
 * does not block the navigation: the folder page is readable either way.
 */
export function useInvitationResponses(
  userId: string,
  invites: readonly PendingInvitation[],
) {
  const { accept, decline } = useInvitationMutations(userId);

  const pendingId = accept.isPending
    ? ((accept.variables as string | undefined) ?? null)
    : decline.isPending
      ? ((decline.variables as string | undefined) ?? null)
      : null;
  const error = (accept.error ?? decline.error)?.message ?? null;

  function onAccept(id: string) {
    const invite = invites.find((i) => i.id === id);
    accept.mutate(id, {
      onSuccess: async (orgId) => {
        try {
          window.sessionStorage.setItem(
            INVITE_FLASH_KEY,
            invite ? invitationAcceptedMessage(invite) : "Invitation accepted",
          );
        } catch {
          // Storage unavailable: the navigation below is still the cue.
        }
        try {
          await setActiveOrg(orgId);
        } catch {
          // Best effort (see above).
        }
        // Membership is server data → a real navigation pulls the new org
        // context, sidebar and boards.
        window.location.assign(invite ? invitationDestination(invite) : "/");
      },
    });
  }

  function onDecline(id: string) {
    decline.mutate(id);
  }

  return { onAccept, onDecline, pendingId, error };
}
