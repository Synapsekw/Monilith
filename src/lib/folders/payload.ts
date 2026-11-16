import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { visibleOrgMembersFor } from "@/lib/org/visible-roster";
import { labelEmail } from "@/lib/ui/member-label";
import { effectiveTimeZone } from "@/lib/datetime/timezone";
import { todayInTimeZone } from "@/lib/focus/today";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import type { Database } from "@/types/database.types";
import { layoutNeedsBurn, layoutNeedsLoad, resolveLayout } from "./layout";
import {
  getFolderHead,
  getFolderLayoutRow,
  getOrgTimeZone,
  listLatestBriefs,
} from "./queries";
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
 * Attention rows on the first paint: the folder's most urgent, unfiltered,
 * with the count of all of them (`attentionTotal`).
 *
 * The Overview narrows this list to the selected board and stage on the
 * client. That is exact only while the list is COMPLETE (total <= rows on
 * the page). When the folder has more, the Overview does not filter this
 * sample (matching rows past the limit would be lost): it reads each board's
 * rows on demand with the filter in the query (`getFolderAttention`). 100 is
 * the RPC's own hard ceiling.
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
 *   - briefs, members and the organisation's time zone need the head (board
 *     ids, org id) and start when it resolves; the viewer's own zone starts
 *     at once.
 * `todayISO` is the calendar date in the viewer's zone, then the
 * organisation's, then UTC: the SAME order the folder RPCs resolve "today"
 * in (`_work_time_zone`), so the page and its numbers agree on the date. A
 * failed zone read falls back to the next one, never fails the page.
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
  const userTzP = getUserTimeZoneCached(userId).catch(() => null);
  const orgTzP = headP
    .then((h) => (h ? getOrgTimeZone(supabase, h.folder.orgId) : null))
    .catch(() => null);
  // ONE Promise.all over every read, so a rejection anywhere is handled.
  const [
    head,
    layout,
    rollup,
    attention,
    access,
    burn,
    load,
    briefs,
    members,
    userTz,
    orgTz,
  ] = await Promise.all([
    headP,
    layoutP,
    resolveFolderRollup(supabase, folderId),
    resolveFolderAttention(supabase, folderId, ATTENTION_LIMIT),
    getFolderAccessHead(supabase, folderId),
    burnP,
    loadP,
    briefsP,
    membersP,
    userTzP,
    orgTzP,
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
    attentionTotal: attention.ok ? attention.total : null,
    rollupCapped: rollup.ok && rollup.capped === true,
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
    todayISO: todayInTimeZone(effectiveTimeZone(userTz, orgTz), Date.now())
      .today,
  };
}
