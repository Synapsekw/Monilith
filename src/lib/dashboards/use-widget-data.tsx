"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getWidgetsData } from "@/lib/dashboards/actions";
import type { WidgetDataResult } from "@/lib/dashboards/actions";
import type { CacheWidget } from "@/lib/dashboards/cache";
import {
  configHash,
  type AggregateBucket,
  type ColumnMeta,
  type CompletionGroupRow,
  type GroupMeta,
  type HealthCounts,
} from "@/lib/dashboards/widget-data";

export type WidgetData = {
  buckets: AggregateBucket[];
  columnMeta: ColumnMeta | null;
  /** Completion widgets only; null for aggregate kinds. */
  completion: { rows: CompletionGroupRow[]; groups: GroupMeta[] } | null;
  /** Health widgets only; null for other kinds. */
  health: HealthCounts | null;
};

type WidgetDataContextValue = {
  /** True while the dashboard's single batched fetch is in flight. */
  isLoading: boolean;
  /** True if the batched fetch itself failed (whole request). */
  isError: boolean;
  /** Per-widget results keyed by id; `undefined` until the batch resolves. */
  results: Record<string, WidgetDataResult> | undefined;
};

const WidgetDataContext = createContext<WidgetDataContextValue | null>(null);

/** Widget kinds whose bodies read aggregate data via {@link useWidgetData}.
 *  Chart + list widgets use their own actions (series / rows) and are excluded
 *  from the aggregate batch. */
function usesAggregateData(kind: CacheWidget["kind"]): boolean {
  return (
    kind === "number" ||
    kind === "battery" ||
    kind === "completion" ||
    kind === "health"
  );
}

/**
 * Fetch aggregate data for *all* of a dashboard's aggregate widgets in one
 * server round-trip, and distribute the results to each widget via context.
 * Replaces the old per-widget `getWidgetData` fetches, which Next serialized
 * into a one-by-one populate. Keyed by dashboard id + a stable per-widget
 * id+config hash, so a widget-config edit refetches (read-your-own-writes) but
 * layout drags — which don't change ids/config — never do.
 */
export function WidgetDataProvider({
  dashboardId,
  widgets,
  children,
}: {
  dashboardId: string;
  widgets: CacheWidget[];
  children: ReactNode;
}) {
  const aggWidgets = useMemo(
    () => widgets.filter((w) => usesAggregateData(w.kind)),
    [widgets],
  );

  const widgetIds = useMemo(
    () => aggWidgets.map((w) => w.id).sort(),
    [aggWidgets],
  );

  // Stable, order-independent cache-key fragment: any widget's config change
  // (or add/remove) flips this string and refetches the batch; a layout drag
  // leaves it untouched.
  const widgetsKey = useMemo(
    () =>
      aggWidgets
        .map(
          (w) =>
            `${w.id}:${configHash((w.config ?? {}) as Record<string, unknown>)}`,
        )
        .sort()
        .join("|"),
    [aggWidgets],
  );

  const query = useQuery({
    queryKey: ["dashboard-widgets-data", dashboardId, widgetsKey],
    queryFn: async (): Promise<Record<string, WidgetDataResult>> => {
      const res = await getWidgetsData({ widgetIds });
      if (!res.ok) throw new Error(res.error);
      return res.data.results;
    },
    enabled: widgetIds.length > 0,
    staleTime: 60_000,
  });

  const value = useMemo<WidgetDataContextValue>(
    () => ({
      isLoading: query.isLoading,
      isError: query.isError,
      results: query.data,
    }),
    [query.isLoading, query.isError, query.data],
  );

  return (
    <WidgetDataContext.Provider value={value}>
      {children}
    </WidgetDataContext.Provider>
  );
}

/**
 * Feed a single widget's already-resolved slot into WidgetDataContext — used by
 * the config-sheet live preview, which fetches one draft widget outside the
 * dashboard grid. `slot === undefined` while loading; a resolved `{ ok:false }`
 * slot surfaces as that widget's error, exactly like the batched path.
 */
export function SingleWidgetDataProvider({
  widgetId,
  slot,
  isLoading,
  isError,
  children,
}: {
  widgetId: string;
  slot: WidgetDataResult | undefined;
  isLoading: boolean;
  isError: boolean;
  children: ReactNode;
}) {
  const value = useMemo<WidgetDataContextValue>(
    () => ({
      isLoading,
      isError,
      results: slot ? { [widgetId]: slot } : undefined,
    }),
    [widgetId, slot, isLoading, isError],
  );
  return (
    <WidgetDataContext.Provider value={value}>
      {children}
    </WidgetDataContext.Provider>
  );
}

/**
 * Read one widget's slice of the dashboard's batched aggregate fetch. Keeps the
 * per-widget `{ data, isLoading, isError }` shape the widget bodies already use,
 * so a failed aggregation for one widget surfaces as that widget's error only.
 *
 * Rendered without a {@link WidgetDataProvider} (e.g. the widget-config sheet's
 * live preview mounts NumberWidget/BatteryWidget outside the dashboard grid),
 * the hook degrades to a stable non-loading error state instead of throwing —
 * matching the pre-batch behavior, where a preview id failed the action's Zod
 * parse and surfaced as `isError`. The preview never needs live batch data;
 * widgets fall back to their configure/empty affordances.
 */
export function useWidgetData(widgetId: string): {
  data: WidgetData | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const ctx = useContext(WidgetDataContext);
  if (!ctx) return { data: undefined, isLoading: false, isError: true };

  const entry = ctx.results?.[widgetId];
  // A resolved batch with no slot for this id (row not visible under RLS, or a
  // stale/unknown id) is an error for this widget — not a silent blank.
  const missing = ctx.results !== undefined && entry === undefined;
  return {
    isLoading: ctx.isLoading,
    // The widget errors if the whole batch failed, its slot did, or its slot is absent.
    isError: ctx.isError || missing || entry?.ok === false,
    data: entry?.ok
      ? {
          buckets: entry.buckets,
          columnMeta: entry.columnMeta,
          completion: entry.completion ?? null,
          health: entry.health ?? null,
        }
      : undefined,
  };
}
