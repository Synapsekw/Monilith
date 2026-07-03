"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetSeries } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import { useWidgetPreview } from "@/lib/dashboards/use-widget-preview";
import type { SeriesData } from "@/lib/dashboards/series";

/** Fetch a Chart widget's bounded series. Keyed by widget id + config hash so an
 * edit re-queries only this widget; never refetched by a layout drag.
 *
 * Inside the config-sheet live preview (a {@link WidgetPreviewProvider}), the
 * id-keyed query is disabled and the debounced draft series is served from the
 * preview context instead — one draft fetch feeds the real ChartWidget body. */
export function useWidgetSeries(
  widgetId: string,
  config: Record<string, unknown>,
) {
  const preview = useWidgetPreview();
  const query = useQuery({
    queryKey: ["dashboard-widget-series", widgetId, configHash(config)],
    queryFn: async (): Promise<SeriesData> => {
      const res = await getWidgetSeries({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !preview.active,
    staleTime: 60_000,
  });
  if (preview.active)
    return {
      data: preview.series,
      isLoading: preview.isLoading,
      isError: preview.isError,
    };
  return query;
}
