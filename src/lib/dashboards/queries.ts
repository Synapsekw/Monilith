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

/** A dashboard + its widgets. Returns null when not visible (RLS) or absent. */
export const getDashboardPayload = cache(
  async (dashboardId: string): Promise<DashboardPayload | null> => {
    const supabase = await createClient();

    const { data: dashboard, error } = await supabase
      .from("dashboards")
      .select("*")
      .eq("id", dashboardId)
      .maybeSingle();
    // A DB failure is not a 404: throw so the dashboards error boundary
    // renders (same policy as boards/queries.ts getBoardPayload).
    // Missing/RLS-hidden row stays null → notFound().
    if (error) throw new Error(`Failed to load dashboard: ${error.message}`);
    if (!dashboard) return null;

    const { data: widgets, error: widgetsErr } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("dashboard_id", dashboardId)
      .order("position", { ascending: true });
    // A silently-empty dashboard is indistinguishable from deleted widgets:
    // fail loudly instead of rendering an empty canvas.
    if (widgetsErr)
      throw new Error(
        `Failed to load dashboard widgets: ${widgetsErr.message}`,
      );

    return { dashboard, widgets: widgets ?? [] };
  },
);
