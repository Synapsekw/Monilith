"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getWidgetsData } from "@/lib/dashboards/actions";
import type { WidgetDataResult } from "@/lib/dashboards/actions";
import type { CacheWidget } from "@/lib/dashboards/cache";
import type { SeriesData } from "@/lib/dashboards/series";
import type { WidgetRowsData } from "@/lib/dashboards/widget-resolve";
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

/** Widget kinds whose bodies read their data from the batched fetch. This is now
 *  every kind: aggregate (number/battery/completion/health) via {@link
 *  useWidgetData}, chart via {@link useBatchedWidgetSeries}, and list via {@link
 *  useBatchedWidgetRows}. Kept as an explicit allowlist so a not-yet-handled
 *  future kind is excluded from the batch rather than silently mis-resolved. */
function usesBatchedData(kind: CacheWidget["kind"]): boolean {
  return (
    kind === "number" ||
    kind === "battery" ||
    kind === "completion" ||
    kind === "health" ||
    kind === "chart" ||
    kind === "list"
  );
}

/**
 * Fetch data for *all* of a dashboard's widgets — aggregate, chart (series) and
 * list (rows) alike — in one server round-trip, and distribute the results to
 * each widget via context. Replaces the old per-widget fetches (aggregate +
 * one `getWidgetSeries`/`getWidgetRows` per chart/list), which Next serialized
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
  const batchWidgets = useMemo(
    () => widgets.filter((w) => usesBatchedData(w.kind)),
    [widgets],
  );

  const widgetIds = useMemo(
    () => batchWidgets.map((w) => w.id).sort(),
    [batchWidgets],
  );

  // Stable, order-independent cache-key fragment: any widget's config change
  // (or add/remove) flips this string and refetches the batch; a layout drag
  // leaves it untouched.
  const widgetsKey = useMemo(
    () =>
      batchWidgets
        .map(
          (w) =>
            `${w.id}:${configHash((w.config ?? {}) as Record<string, unknown>)}`,
        )
        .sort()
        .join("|"),
    [batchWidgets],
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
  // `"buckets" in entry` narrows to the aggregate slot (chart/list slots carry a
  // `shape` tag and no buckets), so an aggregate widget only ever reads its own
  // family's payload.
  const isAggregate = entry?.ok === true && "buckets" in entry;
  return {
    isLoading: ctx.isLoading,
    // The widget errors if the whole batch failed, its slot did, or its slot is absent.
    isError: ctx.isError || missing || entry?.ok === false,
    data: isAggregate
      ? {
          buckets: entry.buckets,
          columnMeta: entry.columnMeta,
          completion: entry.completion ?? null,
          health: entry.health ?? null,
        }
      : undefined,
  };
}

/**
 * Read one chart widget's series from the dashboard's batched fetch, in the same
 * `{ data, isLoading, isError }` shape the ChartWidget body already consumes. A
 * failed resolve (or a missing slot) surfaces as that widget's error only.
 * Without a {@link WidgetDataProvider} (e.g. a stray render outside the grid),
 * degrades to a stable non-loading error instead of throwing — the live-preview
 * path never reaches here (it short-circuits on `preview.active`).
 */
export function useBatchedWidgetSeries(widgetId: string): {
  data: SeriesData | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const ctx = useContext(WidgetDataContext);
  if (!ctx) return { data: undefined, isLoading: false, isError: true };

  const entry = ctx.results?.[widgetId];
  const missing = ctx.results !== undefined && entry === undefined;
  const data =
    entry?.ok === true && "shape" in entry && entry.shape === "series"
      ? entry.series
      : undefined;
  return {
    isLoading: ctx.isLoading,
    isError: ctx.isError || missing || entry?.ok === false,
    data,
  };
}

/**
 * Read one list widget's rows from the dashboard's batched fetch — the rows
 * analogue of {@link useBatchedWidgetSeries}.
 */
export function useBatchedWidgetRows(widgetId: string): {
  data: WidgetRowsData | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const ctx = useContext(WidgetDataContext);
  if (!ctx) return { data: undefined, isLoading: false, isError: true };

  const entry = ctx.results?.[widgetId];
  const missing = ctx.results !== undefined && entry === undefined;
  const data =
    entry?.ok === true && "shape" in entry && entry.shape === "rows"
      ? entry.rows
      : undefined;
  return {
    isLoading: ctx.isLoading,
    isError: ctx.isError || missing || entry?.ok === false,
    data,
  };
}
