"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetSeries } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import type { SeriesData } from "@/lib/dashboards/series";

/** Fetch a Chart widget's bounded series. Keyed by widget id + config hash so an
 * edit re-queries only this widget; never refetched by a layout drag. */
export function useWidgetSeries(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget-series", widgetId, configHash(config)],
    queryFn: async (): Promise<SeriesData> => {
      const res = await getWidgetSeries({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
}
