"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assertOnline } from "@/lib/offline/online-status";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey } from "./invitations";
import { acceptInvitation, declineInvitation } from "./invitations-data";
import { refreshAccessAfterInvitation } from "./invitation-actions";

export function useInvitationMutations(userId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: invitationsKey(userId) });

  const accept = useMutation({
    mutationFn: (inviteId: string) => {
      assertOnline();
      return acceptInvitation(createClient(), inviteId);
    },
    // accept_invitation ran in the browser, so the server's cached nav reads
    // never saw it: expire this user's access entries (a failure here must not
    // fail an accept that already succeeded).
    // Returned, so the mutation settles (and a caller's own onSuccess runs)
    // only after the caches are expired: the caller navigates next, and a
    // navigation would abort a refresh still in flight.
    onSuccess: (orgId) => refreshAccessAfterInvitation(orgId).catch(() => {}),
    onSettled: invalidate,
  });
  const decline = useMutation({
    mutationFn: (inviteId: string) => {
      assertOnline();
      return declineInvitation(createClient(), inviteId);
    },
    onSettled: invalidate,
  });

  return { accept, decline };
}
