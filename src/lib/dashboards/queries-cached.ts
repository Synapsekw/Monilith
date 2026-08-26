import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { dashboardsTag } from "@/lib/cache/tags";
import type { Dashboard } from "@/lib/dashboards/queries";

/** Hot-path cap (AGENTS.md: bounded reads over dashboards_org_id_idx).
 * Truncates silently at the cap. */
export const DASHBOARDS_LIMIT = 100;

/**
 * Cached org dashboards list. `orgId` is passed in (part of the cache key + tag);
 * the explicit `org_id = orgId` filter is the tenant boundary (the service client
 * bypasses RLS).
 */
export async function listDashboardsCached(
  orgId: string,
  workspaceId?: string,
): Promise<Dashboard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(dashboardsTag(orgId));

  const supabase = createServiceClient();
  let query = supabase.from("dashboards").select("*").eq("org_id", orgId);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data } = await query
    .order("created_at", { ascending: true })
    .limit(DASHBOARDS_LIMIT);
  return data ?? [];
}

// NOTE: `getWidgetAggregationCached` / `getWidgetCompletionCached` /
// `getWidgetHealthCached` used to live here (Phase 9.3b), each a `"use cache"`
// function that ran `dashboard_aggregate` / `dashboard_completion` /
// `dashboard_health_summary` on the service client. They were removed:
// those three RPCs are SECURITY DEFINER and gate on `is_org_member(org_id)`
// then `can_read_board(board_id)`, both keyed off `auth.uid()`
// (20260704110000_dashboard_rpc_board_read_guards.sql). The service client
// carries no user session, so `auth.uid()` is NULL and the guard raised
// `42501` unconditionally — for every widget of these kinds, every time,
// since that migration shipped. No amount of app-level prechecking fixes
// that: the RPC itself always fails under the service role, so a "use cache"
// wrapper around it can never populate successfully. `resolveWidgetAggregate`
// (`widget-slot-core.ts`) now calls `resolveAggregate`/`resolveCompletion`/
// `resolveHealth` (`widget-resolve.ts`) instead, over the request's own
// RLS-respecting client — uncached, matching how chart/list widgets already
// resolved via `resolveSeries`/`resolveRows`. A "use cache" scope cannot call
// `cookies()` (Next 16 forbids dynamic APIs inside cache scope), so there is
// no way to thread that per-request client into a cached function; caching
// the always-failing service-client result is what caused this bug.
