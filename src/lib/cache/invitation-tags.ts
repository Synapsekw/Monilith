import "server-only";
import {
  folderMembersTag,
  orgAdminTag,
  sharedBoardsTag,
} from "@/lib/cache/tags";

/**
 * The cache tags a redeemed invitation makes stale for the person who accepted
 * it: their "Shared with me" list, the folder-membership/role reader, and (when
 * the org is known) that org's role entry. Boards, folders and org lists are
 * read per user, so only the redeeming user's own entries are touched.
 *
 * Callers pick the API that is valid in their context: `updateTag` in a Server
 * Action, `revalidateTag(tag, { expire: 0 })` in a Route Handler.
 */
export function invitationRedeemedTags(
  userId: string,
  orgId?: string,
): string[] {
  const tags = [sharedBoardsTag(userId), folderMembersTag(userId)];
  if (orgId) tags.push(orgAdminTag(userId, orgId));
  return tags;
}
