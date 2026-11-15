import type { Database } from "@/types/database.types";

type PendingInvitationRow =
  Database["public"]["Functions"]["my_pending_invitations"]["Returns"][number];

/**
 * One pending invitation as returned by the my_pending_invitations RPC.
 *
 * The folder context (migration 20261115173702) is optional here on purpose:
 * the app must keep working against a database where that migration is not
 * applied yet, and every consumer falls back to the org-only wording when the
 * fields are absent. `folder_*` are set when the org invitation came with
 * pending folder invitations (a folder invite); `folder_id` / `folder_name`
 * are the first of them and `folder_count` is how many there are.
 */
export type PendingInvitation = PendingInvitationRow & {
  inviter_name?: string | null;
  folder_id?: string | null;
  folder_name?: string | null;
  folder_count?: number | null;
};

/** TanStack Query cache key for a user's pending invitations. */
export function invitationsKey(userId: string) {
  return ["invitations", userId] as const;
}

type Describable = Pick<
  PendingInvitation,
  "org_name" | "role" | "inviter_name" | "folder_name" | "folder_count"
>;

/**
 * One sentence saying what the invitation is, e.g.
 * "Ann invited you to the folder Launch in Acme". Falls back to the org and
 * role when the invitation is not a folder invite (or the folder context is
 * not available).
 */
export function invitationSummary(i: Describable): string {
  const inviter = i.inviter_name?.trim();
  const folder = i.folder_name?.trim();
  if (folder) {
    const more = (i.folder_count ?? 1) - 1;
    const folders =
      more > 0
        ? `the folder ${folder} and ${more} more`
        : `the folder ${folder}`;
    return `${inviter || "Someone"} invited you to ${folders} in ${i.org_name}`;
  }
  return inviter
    ? `${inviter} invited you to ${i.org_name} as ${i.role}`
    : `You've been invited to ${i.org_name} as ${i.role}`;
}

/** Where accepting an invitation takes the person: the folder they were
 *  invited to, otherwise the app entry (which picks their board). */
export function invitationDestination(
  i: Pick<PendingInvitation, "folder_id">,
): string {
  return i.folder_id ? `/folders/${i.folder_id}` : "/";
}

/** What to tell the person once they are in. */
export function invitationAcceptedMessage(i: Describable): string {
  const folder = i.folder_name?.trim();
  return folder
    ? `You now have access to the folder ${folder} in ${i.org_name}`
    : `You joined ${i.org_name}`;
}
