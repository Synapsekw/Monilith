import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { dashboardsTag } from "@/lib/cache/tags";
import type { Dashboard } from "@/lib/dashboards/queries";

/**
 * Cached org dashboards list. `orgId` is passed in (part of the cache key + tag);
 * the explicit `org_id = orgId` filter is the tenant boundary (the service client
 * bypasses RLS).
 */
export async function listDashboardsCached(
  orgId: string,
): Promise<Dashboard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(dashboardsTag(orgId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dashboards")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
