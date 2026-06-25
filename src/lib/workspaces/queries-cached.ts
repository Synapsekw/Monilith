import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { workspacesTag } from "@/lib/cache/tags";

export type WorkspaceListEntry = { id: string; name: string };

/**
 * Cached org workspaces list (extracted from the inline shell select). `orgId` is
 * passed in (cache key + tag); the explicit `org_id = orgId` filter is the tenant
 * boundary (the service client bypasses RLS).
 */
export async function listWorkspacesCached(
  orgId: string,
): Promise<WorkspaceListEntry[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(workspacesTag(orgId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
