import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Dashboard = Tables<"dashboards">;
export type DashboardWidget = Tables<"dashboard_widgets">;

export type DashboardPayload = {
  dashboard: Dashboard;
  widgets: DashboardWidget[];
};

/** Workspace-scoped list of dashboards visible to the current user (RLS). */
export async function listDashboards(): Promise<Dashboard[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .select("*")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** A dashboard + its widgets. Returns null when not visible (RLS) or absent. */
export const getDashboardPayload = cache(
  async (dashboardId: string): Promise<DashboardPayload | null> => {
    const supabase = await createClient();

    const { data: dashboard, error } = await supabase
      .from("dashboards")
      .select("*")
      .eq("id", dashboardId)
      .maybeSingle();
    if (error || !dashboard) return null;

    const { data: widgets } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("dashboard_id", dashboardId)
      .order("position", { ascending: true });

    return { dashboard, widgets: widgets ?? [] };
  },
);
