"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetData } from "@/lib/dashboards/actions";
import { configHash, type AggregateBucket } from "@/lib/dashboards/widget-data";

/**
 * Fetch one widget's bounded aggregate. Keyed by widget id + config hash so an
 * edit re-queries only this widget. Never refetched by layout drags.
 */
export function useWidgetData(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget", widgetId, configHash(config)],
    queryFn: async (): Promise<AggregateBucket[]> => {
      const res = await getWidgetData({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data.buckets;
    },
    staleTime: 60_000,
  });
}
