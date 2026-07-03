"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetRows } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import { useWidgetPreview } from "@/lib/dashboards/use-widget-preview";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

export type WidgetRows = {
  columns: DisplayColumn[];
  rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
};

/** Fetch a List widget's bounded rows. Keyed by widget id + config hash.
 *
 * Inside the config-sheet live preview (a {@link WidgetPreviewProvider}), the
 * id-keyed query is disabled and the debounced draft rows are served from the
 * preview context instead — one draft fetch feeds the real ListWidget body. */
export function useWidgetRows(
  widgetId: string,
  config: Record<string, unknown>,
) {
  const preview = useWidgetPreview();
  const query = useQuery({
    queryKey: ["dashboard-widget-rows", widgetId, configHash(config)],
    queryFn: async (): Promise<WidgetRows> => {
      const res = await getWidgetRows({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !preview.active,
    staleTime: 60_000,
  });
  if (preview.active)
    return {
      data: preview.rows,
      isLoading: preview.isLoading,
      isError: preview.isError,
    };
  return query;
}
