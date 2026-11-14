import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  FOLDER_ACCESS_HEAD_LIMIT,
  type FolderAccessHead,
} from "./sharing-types";

/**
 * First-paint read for the folder header: how many people the folder is shared
 * with, the first ids for the avatar stack, and whether the caller may manage
 * it. RLS client; a failure degrades to "nobody, cannot manage" rather than
 * failing the page.
 */
export async function getFolderAccessHead(
  supabase: SupabaseClient<Database>,
  folderId: string,
): Promise<FolderAccessHead> {
  const [membersRes, manageRes] = await Promise.all([
    supabase
      .from("folder_members")
      .select("user_id", { count: "exact" })
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true })
      .limit(FOLDER_ACCESS_HEAD_LIMIT),
    typedRpc(supabase, "can_manage_folder", { p_folder_id: folderId }),
  ]);
  const memberIds = (membersRes.data ?? []).map((r) => r.user_id);
  return {
    count: membersRes.count ?? memberIds.length,
    memberIds,
    canManage: manageRes.data === true,
  };
}
