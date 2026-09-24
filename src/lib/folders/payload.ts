import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { localTodayISO } from "@/lib/boards/overdue";
import type { Database } from "@/types/database.types";
import { getFolderHead, listLatestBriefs } from "./queries";
import {
  resolveFolderAttention,
  resolveFolderBurn,
  resolveFolderRollup,
} from "./resolve";
import type { FolderPayload } from "./types";

/**
 * Rows `folder_attention` returns for the first paint.
 *
 * The Overview panel SHOWS 20, but it narrows the list to the selected stage
 * on the client — i.e. it classifies AFTER the SQL LIMIT. At 20 a folder whose
 * worst 20 items all sit in one stage left every other stage looking clean.
 * 100 is the RPC's own hard ceiling (`least(greatest(p_limit, 1), 100)`), so
 * this asks for the widest pool it will give; Overview slices to 20 and
 * captions the truncation.
 */
export const ATTENTION_LIMIT = 100;

/**
 * First paint (spec §6): head reads + folder_rollup + folder_burn +
 * folder_attention in ONE Promise.all on the request's RLS client (the RPCs
 * gate on auth.uid()), then the briefs read (needs the board ids). Members
 * come from the shell-warm `use cache` read. An RPC failure degrades that
 * panel to `null` (inline retry, spec §8) instead of failing the page.
 */
export async function buildFolderPayload(
  supabase: SupabaseClient<Database>,
  folderId: string,
  userId: string,
): Promise<FolderPayload | null> {
  const [head, rollup, burn, attention] = await Promise.all([
    getFolderHead(supabase, folderId),
    resolveFolderRollup(supabase, folderId),
    resolveFolderBurn(supabase, folderId),
    resolveFolderAttention(supabase, folderId, ATTENTION_LIMIT),
  ]);
  if (!head) return null;
  const [briefs, members] = await Promise.all([
    listLatestBriefs(supabase, head.boards, userId),
    listOrgMembersCached(head.folder.orgId),
  ]);
  return {
    folder: head.folder,
    boards: head.boards,
    rollup: rollup.ok ? rollup.rows : null,
    burn: burn.ok ? burn.rows : null,
    attention: attention.ok ? attention.rows : null,
    briefs,
    members: members.map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
      avatarUrl: m.avatarUrl,
    })),
    generatedAt: new Date().toISOString(),
    todayISO: localTodayISO(),
  };
}
