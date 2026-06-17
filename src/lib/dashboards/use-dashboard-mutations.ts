"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createWidget,
  deleteWidget,
  saveLayout,
  updateWidgetConfig,
} from "@/lib/dashboards/actions";
import {
  applyLayouts,
  insertWidget,
  removeWidget,
  replaceWidget,
  type CacheWidget,
  type DashboardCache,
  type GridRect,
} from "@/lib/dashboards/cache";
import { dashboardKey } from "@/lib/dashboards/use-dashboard-cache";

export function useDashboardMutations(dashboardId: string) {
  const qc = useQueryClient();
  const key = dashboardKey(dashboardId);

  const addWidget = useMutation({
    mutationFn: async (vars: {
      kind: CacheWidget["kind"];
      sourceBoardId: string;
      title: string;
      config: Record<string, unknown>;
    }) => {
      const res = await createWidget({ dashboardId, ...vars });
      if (!res.ok) throw new Error(res.error);
      return res.data.widget as CacheWidget;
    },
    onSuccess: (widget) => {
      qc.setQueryData<DashboardCache>(key, (prev) =>
        prev ? insertWidget(prev, widget) : prev,
      );
    },
  });

  const editWidget = useMutation({
    mutationFn: async (vars: {
      widgetId: string;
      title?: string;
      sourceBoardId?: string;
      config?: Record<string, unknown>;
    }) => {
      const res = await updateWidgetConfig(vars);
      if (!res.ok) throw new Error(res.error);
      return res.data.widget as CacheWidget;
    },
    onSuccess: (widget) => {
      qc.setQueryData<DashboardCache>(key, (prev) =>
        prev ? replaceWidget(prev, widget) : prev,
      );
    },
  });

  const removeWidgetMut = useMutation<
    unknown,
    Error,
    { widgetId: string },
    { previous?: DashboardCache }
  >({
    mutationFn: async (vars) => {
      const res = await deleteWidget(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DashboardCache>(key);
      if (previous) qc.setQueryData(key, removeWidget(previous, vars.widgetId));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  // Layout: patch cache immediately, persist debounced (caller debounces).
  // Roll back the optimistic layout if the persist fails (else the cache would
  // drift ahead of the DB and a reload would snap widgets back).
  const persistLayout = useMutation<
    unknown,
    Error,
    ({ id: string } & GridRect)[],
    { previous?: DashboardCache }
  >({
    mutationFn: async (layouts) => {
      const res = await saveLayout({ dashboardId, layouts });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: async (layouts) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DashboardCache>(key);
      if (previous) qc.setQueryData(key, applyLayouts(previous, layouts));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  return {
    addWidget,
    editWidget,
    removeWidget: removeWidgetMut,
    persistLayout,
  };
}
