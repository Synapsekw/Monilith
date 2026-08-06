"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assertOnline } from "@/lib/offline/online-status";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey } from "./invitations";
import { acceptInvitation, declineInvitation } from "./invitations-data";

export function useInvitationMutations(userId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: invitationsKey(userId) });

  const accept = useMutation({
    mutationFn: (inviteId: string) => {
      assertOnline();
      return acceptInvitation(createClient(), inviteId);
    },
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
