import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { folderMembersTag, orgAdminTag } from "@/lib/cache/tags";
import { warnIfAtCap } from "@/lib/supabase/cap-warning";

const FOLDER_MEMBERSHIPS_LIMIT = 500;

/**
 * Whether `userId` is a guest of `orgId`, and which of that org's folders they
 * are a member of. `userId` comes from the server session (read outside this
 * scope) and is part of the cache key. Service client: the explicit `user_id` +
 * `org_id` filters are the tenant boundary. Fails closed to "guest with no
 * folders" (no active membership, or a failed membership read), so an error
 * can only hide things, never reveal them.
 *
 * Tags: `folderMembersTag(userId)` (share, unshare, invite, leave, move) and
 * `orgAdminTag(userId, orgId)`, which every role change and deactivation
 * already invalidates.
 */
export async function getFolderAccessForUserCached(
  userId: string,
  orgId: string,
): Promise<{ isGuest: boolean; folderIds: string[] }> {
  "use cache";
  cacheLife("nav");
  cacheTag(folderMembersTag(userId), orgAdminTag(userId, orgId));

  const supabase = createServiceClient();
  const [roleRes, foldersRes] = await Promise.all([
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .maybeSingle(),
    supabase
      .from("folder_members")
      .select("folder_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      // Stable order over the (user_id, folder_id) index: past the cap the same
      // folders are kept on every cache refresh.
      .order("folder_id", { ascending: true })
      .limit(FOLDER_MEMBERSHIPS_LIMIT),
  ]);
  warnIfAtCap(
    "getFolderAccessForUserCached",
    "folder_members",
    foldersRes.data,
    FOLDER_MEMBERSHIPS_LIMIT,
  );
  if (roleRes.error || !roleRes.data) return { isGuest: true, folderIds: [] };
  return {
    isGuest: roleRes.data.role === "guest",
    folderIds: foldersRes.error
      ? []
      : (foldersRes.data ?? []).map((r) => r.folder_id),
  };
}
