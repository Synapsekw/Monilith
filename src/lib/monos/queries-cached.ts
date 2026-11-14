import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { orgMembersTag } from "@/lib/cache/tags";
import type { OrgMono } from "./types";

/** Hot-path cap, same as ORG_MEMBERS_LIMIT. Index: monos_one_per_owner. */
export const ORG_MONOS_LIMIT = 500;

/**
 * Every Mono in the org (name, colour, owner; never brain). Cached under the
 * SAME tag as the member roster, so every roster invalidation (member removed,
 * deactivated, Mono created or renamed) refreshes both. CALLER CONTRACT as
 * `listOrgMembersCached`: pass an org the caller may read; the explicit
 * `org_id` filter is the tenant boundary (service client).
 */
export async function listOrgMonosCached(orgId: string): Promise<OrgMono[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(orgMembersTag(orgId));

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("monos")
    .select("user_id, owner_id, name, color")
    .eq("org_id", orgId)
    .limit(ORG_MONOS_LIMIT);
  if (error || !data) return [];
  return data.map((m) => ({
    userId: m.user_id,
    ownerId: m.owner_id,
    name: m.name,
    color: m.color,
  }));
}
