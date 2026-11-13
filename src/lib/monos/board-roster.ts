import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { OrgMember } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { listOrgMonosCached } from "./queries-cached";
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
 *  this page, never the page. */
export async function loadBoardRoster(
  supabase: SupabaseClient<Database>,
  orgId: string,
): Promise<BoardRoster> {
  const [members, monos, myMono] = await Promise.all([
    listOrgMembersCached(orgId),
    // A failed Monos read shows Mono ids as unknown members, never a crash.
    listOrgMonosCached(orgId).catch((): OrgMono[] => []),
    getMyMono(supabase, orgId).catch(() => null),
  ]);
  return { orgId, members, monos, myMono };
}
