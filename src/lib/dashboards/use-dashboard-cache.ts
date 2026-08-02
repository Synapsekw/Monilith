"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardCache } from "@/lib/dashboards/cache";

export function dashboardKey(dashboardId: string) {
  return ["dashboard", dashboardId] as const;
}

export function useDashboardCache(
  dashboardId: string,
  initialData: DashboardCache,
) {
  return useQuery({
    queryKey: dashboardKey(dashboardId),
    queryFn: () => initialData,
    initialData,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
