"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetRows } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

export type WidgetRows = {
  columns: DisplayColumn[];
  rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
};

/** Fetch a List widget's bounded rows. Keyed by widget id + config hash. */
export function useWidgetRows(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget-rows", widgetId, configHash(config)],
    queryFn: async (): Promise<WidgetRows> => {
      const res = await getWidgetRows({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
}
