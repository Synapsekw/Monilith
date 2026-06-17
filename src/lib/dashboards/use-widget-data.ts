"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetData } from "@/lib/dashboards/actions";
import {
  configHash,
  type AggregateBucket,
  type ColumnMeta,
} from "@/lib/dashboards/widget-data";

export type WidgetData = {
  buckets: AggregateBucket[];
  columnMeta: ColumnMeta | null;
};

/**
 * Fetch one widget's bounded aggregate + (for grouped widgets) its group
 * column's options. Keyed by widget id + config hash so an edit re-queries only
 * this widget. Never refetched by layout drags.
 */
export function useWidgetData(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget", widgetId, configHash(config)],
    queryFn: async (): Promise<WidgetData> => {
      const res = await getWidgetData({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return { buckets: res.data.buckets, columnMeta: res.data.columnMeta };
    },
    staleTime: 60_000,
  });
}
