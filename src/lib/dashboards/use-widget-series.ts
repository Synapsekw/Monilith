"use client";

import { useBatchedWidgetSeries } from "@/lib/dashboards/use-widget-data";
import { useWidgetPreview } from "@/lib/dashboards/use-widget-preview";

/** Read a Chart widget's bounded series.
 *
 * On a live dashboard the series rides the dashboard's single batched fetch
 * (WidgetDataProvider → getWidgetsData) and is read from context here — no
 * per-widget server round-trip, so N charts no longer populate sequentially.
 *
 * Inside the config-sheet live preview (a {@link WidgetPreviewProvider}), the
 * debounced draft series is served from the preview context instead — one draft
 * fetch feeds the real ChartWidget body. */
export function useWidgetSeries(widgetId: string) {
  const preview = useWidgetPreview();
  const batched = useBatchedWidgetSeries(widgetId);
  if (preview.active)
    return {
      data: preview.series,
      isLoading: preview.isLoading,
      isError: preview.isError,
    };
  return batched;
}
