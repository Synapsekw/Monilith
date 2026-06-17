"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
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

export function patchDashboardCache(
  qc: QueryClient,
  dashboardId: string,
  patch: (prev: DashboardCache) => DashboardCache,
) {
  qc.setQueryData<DashboardCache>(dashboardKey(dashboardId), (prev) =>
    prev ? patch(prev) : prev,
  );
}
