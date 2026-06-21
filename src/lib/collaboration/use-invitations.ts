"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { invitationsKey, type PendingInvitation } from "./invitations";
import { fetchPendingInvitations } from "./invitations-data";

export function useInvitations(userId: string) {
  const query = useQuery({
    queryKey: invitationsKey(userId),
    enabled: !!userId,
    staleTime: Infinity,
    queryFn: (): Promise<PendingInvitation[]> =>
      fetchPendingInvitations(createClient()),
  });
  const invites = query.data ?? [];
  return { query, invites, count: invites.length };
}
