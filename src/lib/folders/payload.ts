import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { visibleOrgMembersFor } from "@/lib/org/visible-roster";
import { labelEmail } from "@/lib/ui/member-label";
import { localTodayISO } from "@/lib/boards/overdue";
import type { Database } from "@/types/database.types";
import { layoutNeedsBurn, layoutNeedsLoad, resolveLayout } from "./layout";
import { getFolderHead, getFolderLayoutRow, listLatestBriefs } from "./queries";
import {
  resolveFolderAttention,
  resolveFolderBurn,
  resolveFolderLoad,
  resolveFolderRollup,
} from "./resolve";
import { hasDatedItems } from "./rollup";
import { getFolderAccessHead } from "./sharing-queries";
import type { FolderLoad, FolderPayload } from "./types";

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
 * First paint (spec §6), every read on the request's RLS client (the RPCs
 * gate on auth.uid()). Each read starts as soon as what it depends on
 * resolves, not in whole waves:
 *   - head, folder_layouts, folder_rollup, folder_attention and the access
 *     head start at once;
 *   - folder_burn_packed and folder_load depend only on the LAYOUT (a burn
 *     section or stages tab; a load section), so each starts the moment the
 *     layout row resolves, alongside the rollup. A load result is discarded
 *     when the rollup shows no dated items (or failed): nothing to plot;
 *   - briefs and members need the head (board ids, org id) and start when it
 *     resolves.
 * Critical path: max(head then briefs/members, layout then burn/load, rollup,
 * attention, access), instead of the slowest first read PLUS the slowest
 * second one. An RPC failure degrades that panel (inline retry, spec §8)
 * instead of failing the page.
 */
export async function buildFolderPayload(
  supabase: SupabaseClient<Database>,
  folderId: string,
  userId: string,
): Promise<FolderPayload | null> {
  const headP = getFolderHead(supabase, folderId);
  const layoutP = getFolderLayoutRow(supabase, folderId).then(resolveLayout);
  const burnP = layoutP.then((l) =>
    layoutNeedsBurn(l.config) ? resolveFolderBurn(supabase, folderId) : null,
  );
  const loadP = layoutP.then((l) =>
    layoutNeedsLoad(l.config) ? resolveFolderLoad(supabase, folderId) : null,
  );
  const briefsP = headP.then((h) =>
    h ? listLatestBriefs(supabase, h.boards, userId) : [],
  );
  const membersP = headP.then((h) =>
    // Narrowed to the viewer: a guest gets the folder's people, not the org.
    h ? visibleOrgMembersFor(supabase, userId, h.folder.orgId) : [],
  );
  // ONE Promise.all over every read, so a rejection anywhere is handled.
  const [head, layout, rollup, attention, access, burn, load, briefs, members] =
    await Promise.all([
      headP,
      layoutP,
      resolveFolderRollup(supabase, folderId),
      resolveFolderAttention(supabase, folderId, ATTENTION_LIMIT),
      getFolderAccessHead(supabase, folderId),
      burnP,
      loadP,
      briefsP,
      membersP,
    ]);
  if (!head) return null;
  const dated = rollup.ok && hasDatedItems(rollup.rows);
  const folderLoad: FolderLoad =
    load === null || !dated
      ? { status: "skipped" }
      : load.ok
        ? { status: "ready", weeks: load.weeks, rows: load.rows }
        : { status: "failed" };
  return {
    folder: head.folder,
    boards: head.boards,
    rollup: rollup.ok ? rollup.rows : null,
    burnPacked: burn && burn.ok ? burn.packed : null,
    load: folderLoad,
    attention: attention.ok ? attention.rows : null,
    briefs,
    members: members.map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
      email: labelEmail(m),
      avatarUrl: m.avatarUrl,
    })),
    access,
    layout,
    generatedAt: new Date().toISOString(),
    todayISO: localTodayISO(),
  };
}
