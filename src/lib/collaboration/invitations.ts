import type { Database } from "@/types/database.types";

/** One pending invitation as returned by the my_pending_invitations RPC. */
export type PendingInvitation =
  Database["public"]["Functions"]["my_pending_invitations"]["Returns"][number];

/** TanStack Query cache key for a user's pending invitations. */
export function invitationsKey(userId: string) {
  return ["invitations", userId] as const;
}
