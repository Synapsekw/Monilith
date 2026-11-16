import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { OrgMember } from "@/lib/boards/queries";
import { visibleRosterFor } from "@/lib/org/visible-roster";
import { getMyMono } from "./queries";
import type { MyMono, OrgMono } from "./types";

export type BoardRoster = {
  orgId: string;
  members: OrgMember[];
  monos: OrgMono[];
  myMono: MyMono | null;
};

/** People (cached), Monos (cached, same tag) and the viewer's own Mono (one
 *  point read), in parallel. A failed Mono read costs the viewer the Monos on
 *  this page, never the page.
 *
 *  Both lists are narrowed to what `userId` may see: a guest gets only the
 *  people and Monos they share a folder or board with, so every picker,
 *  mention list and avatar fed from this roster offers nobody else. */
export async function loadBoardRoster(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userId: string,
): Promise<BoardRoster> {
  const [roster, myMono] = await Promise.all([
    // A failed Monos read shows Mono ids as unknown members, never a crash.
    visibleRosterFor(supabase, userId, orgId),
    getMyMono(supabase, orgId).catch(() => null),
  ]);
  return { orgId, members: roster.members, monos: roster.monos, myMono };
}
