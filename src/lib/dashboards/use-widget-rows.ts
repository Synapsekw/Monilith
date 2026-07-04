"use client";

import { useBatchedWidgetRows } from "@/lib/dashboards/use-widget-data";
import { useWidgetPreview } from "@/lib/dashboards/use-widget-preview";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

export type WidgetRows = {
  columns: DisplayColumn[];
  rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
};

/** Read a List widget's bounded rows.
 *
 * On a live dashboard the rows ride the dashboard's single batched fetch
 * (WidgetDataProvider → getWidgetsData) and are read from context here — no
 * per-widget server round-trip.
 *
 * Inside the config-sheet live preview (a {@link WidgetPreviewProvider}), the
 * debounced draft rows are served from the preview context instead — one draft
 * fetch feeds the real ListWidget body. */
export function useWidgetRows(widgetId: string) {
  const preview = useWidgetPreview();
  const batched = useBatchedWidgetRows(widgetId);
  if (preview.active)
    return {
      data: preview.rows,
      isLoading: preview.isLoading,
      isError: preview.isError,
    };
  return batched;
}
