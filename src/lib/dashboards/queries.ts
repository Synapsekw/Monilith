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

    // The widgets read filters on dashboardId alone — it never needed the head
    // row, so both reads share one Promise.all (1 RTT instead of 2). The head
    // result is still checked FIRST after settle, preserving the previous
    // error/null contract (DB error throws; missing/RLS-hidden row → null).
    const [dashRes, widgetsRes] = await Promise.all([
      supabase
        .from("dashboards")
        .select("*")
        .eq("id", dashboardId)
        .maybeSingle(),
      supabase
        .from("dashboard_widgets")
        .select("*")
        .eq("dashboard_id", dashboardId)
        .order("position", { ascending: true }),
    ]);

    const { data: dashboard, error } = dashRes;
    // A DB failure is not a 404: throw so the dashboards error boundary
    // renders (same policy as boards/queries.ts getBoardPayload).
    // Missing/RLS-hidden row stays null → notFound().
    if (error) throw new Error(`Failed to load dashboard: ${error.message}`);
    if (!dashboard) return null;

    const { data: widgets, error: widgetsErr } = widgetsRes;
    // A silently-empty dashboard is indistinguishable from deleted widgets:
    // fail loudly instead of rendering an empty canvas.
    if (widgetsErr)
      throw new Error(
        `Failed to load dashboard widgets: ${widgetsErr.message}`,
      );

    return { dashboard, widgets: widgets ?? [] };
  },
);
