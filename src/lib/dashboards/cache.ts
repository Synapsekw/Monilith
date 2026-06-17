import type { Tables } from "@/types/database.types";

export type Dashboard = Tables<"dashboards">;
export type CacheWidget = Tables<"dashboard_widgets">;

export type GridRect = { x: number; y: number; w: number; h: number };

export type DashboardCache = {
  dashboard: Dashboard;
  widgets: CacheWidget[];
};

/** Append a widget; idempotent on id. Immutable. */
export function insertWidget(
  cache: DashboardCache,
  widget: CacheWidget,
): DashboardCache {
  if (cache.widgets.some((w) => w.id === widget.id)) return cache;
  return { ...cache, widgets: [...cache.widgets, widget] };
}

/** Replace a widget by id. Immutable; no-op if absent. */
export function replaceWidget(
  cache: DashboardCache,
  widget: CacheWidget,
): DashboardCache {
  return {
    ...cache,
    widgets: cache.widgets.map((w) => (w.id === widget.id ? widget : w)),
  };
}

/** Remove a widget by id. Immutable. */
export function removeWidget(
  cache: DashboardCache,
  widgetId: string,
): DashboardCache {
  return {
    ...cache,
    widgets: cache.widgets.filter((w) => w.id !== widgetId),
  };
}

/** Patch layout rects by id. Immutable; widgets not in the list keep their layout. */
export function applyLayouts(
  cache: DashboardCache,
  layouts: ({ id: string } & GridRect)[],
): DashboardCache {
  const byId = new Map(layouts.map((l) => [l.id, l]));
  return {
    ...cache,
    widgets: cache.widgets.map((w) => {
      const l = byId.get(w.id);
      return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
    }),
  };
}
