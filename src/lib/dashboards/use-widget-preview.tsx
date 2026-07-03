"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getWidgetPreviewData } from "@/lib/dashboards/actions";
import type { WidgetDataResult } from "@/lib/dashboards/actions";
import { SingleWidgetDataProvider } from "@/lib/dashboards/use-widget-data";
import { configHash } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";
import type { SeriesData } from "@/lib/dashboards/series";
import type { WidgetRowsData } from "@/lib/dashboards/widget-resolve";

type WidgetPreviewContextValue = {
  active: boolean;
  isLoading: boolean;
  isError: boolean;
  series: SeriesData | undefined;
  rows: WidgetRowsData | undefined;
};

const WidgetPreviewContext = createContext<WidgetPreviewContextValue | null>(
  null,
);

/**
 * Fetch ONE draft widget's data for the config-sheet live preview, keyed on the
 * (debounced) draft config so a config edit refetches exactly one widget and a
 * mere kind/board re-pick re-keys cleanly. Feeds aggregate kinds through the
 * existing WidgetDataContext (so NumberWidget/BatteryWidget/CompletionWidget/
 * HealthWidget stay unchanged) and chart/list through WidgetPreviewContext
 * (read by useWidgetSeries/useWidgetRows). Disabled until a board is chosen.
 */
export function WidgetPreviewProvider({
  previewWidgetId,
  kind,
  sourceBoardId,
  config,
  children,
}: {
  previewWidgetId: string;
  kind: CacheWidget["kind"];
  sourceBoardId: string;
  config: Record<string, unknown>;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["widget-preview", kind, sourceBoardId, configHash(config)],
    queryFn: async () => {
      const res = await getWidgetPreviewData({ kind, sourceBoardId, config });
      if (!res.ok) throw new Error(res.error);
      return res.data; // WidgetPreviewResult
    },
    enabled: Boolean(sourceBoardId),
    staleTime: 60_000,
  });

  const result = query.data;
  const isError = query.isError || result?.ok === false;

  // Aggregate slot for WidgetDataContext (undefined while loading / for non-agg).
  const aggregateSlot: WidgetDataResult | undefined = useMemo(() => {
    if (query.isError) return { ok: false, error: "Failed to load" };
    if (!result) return undefined;
    if (result.ok === false) return { ok: false, error: result.error };
    if (result.shape !== "aggregate") return undefined;
    return { ok: true, ...result.payload };
  }, [query.isError, result]);

  const previewValue = useMemo<WidgetPreviewContextValue>(
    () => ({
      active: true,
      isLoading: query.isLoading && Boolean(sourceBoardId),
      isError,
      series:
        result && result.ok && result.shape === "series"
          ? result.payload
          : undefined,
      rows:
        result && result.ok && result.shape === "rows"
          ? result.payload
          : undefined,
    }),
    [query.isLoading, sourceBoardId, isError, result],
  );

  return (
    <SingleWidgetDataProvider
      widgetId={previewWidgetId}
      slot={aggregateSlot}
      isLoading={query.isLoading && Boolean(sourceBoardId)}
      isError={isError}
    >
      <WidgetPreviewContext.Provider value={previewValue}>
        {children}
      </WidgetPreviewContext.Provider>
    </SingleWidgetDataProvider>
  );
}

/** Read the current preview slice. `active:false` outside a preview provider. */
export function useWidgetPreview(): WidgetPreviewContextValue {
  const ctx = useContext(WidgetPreviewContext);
  return (
    ctx ?? {
      active: false,
      isLoading: false,
      isError: false,
      series: undefined,
      rows: undefined,
    }
  );
}
