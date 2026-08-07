"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey, type PendingInvitation } from "./invitations";
import { fetchPendingInvitations } from "./invitations-data";

export function useInvitations(userId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: invitationsKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: (): Promise<PendingInvitation[]> =>
      fetchPendingInvitations(createClient()),
  });

  // Push, don't poll. `staleTime: Infinity` above is only correct because of
  // this subscription: without it an invite surfaced solely on the recipient's
  // next full page load (refetchOnWindowFocus is off globally in providers.tsx).
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const key = invitationsKey(userId);

    // Refetch rather than patch the payload row into the cache: the row has no
    // `org_name` (a join on `organizations`, which the invitee cannot read), so
    // only the RPC yields a complete PendingInvitation. Invites are rare, so
    // the extra round-trip is bounded and off the hot path.
    function refetch() {
      void qc.invalidateQueries({ queryKey: key });
    }

    // No filter, deliberately: recipient matching is case-insensitive on email
    // and a Realtime filter is exact equality on one column, so a casing
    // mismatch would silently drop events. The RLS policy is the gate instead
    // (postgres_changes evaluates it per subscriber).
    //
    // INSERT = invite sent, UPDATE = revoked/accepted/declined. Nothing DELETEs
    // an invitation, so those two cover every transition.
    const channel = supabase
      .channel(`invitations:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "org_invitations" },
        refetch,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "org_invitations" },
        refetch,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const invites = query.data ?? [];
  return { query, invites, count: invites.length };
}
