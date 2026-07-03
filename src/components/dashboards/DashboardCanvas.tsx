"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout";

import { WidgetConfigSheet } from "@/components/dashboards/WidgetConfigSheet";
import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { DashboardWidget } from "@/components/dashboards/DashboardWidget";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import type { DashboardCache, GridRect } from "@/lib/dashboards/cache";
import { useDashboardCache } from "@/lib/dashboards/use-dashboard-cache";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import { WidgetDataProvider } from "@/lib/dashboards/use-widget-data";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";

const DEFAULT_RECT: GridRect = { x: 0, y: 0, w: 3, h: 2 };

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 } as const;

export function DashboardCanvas({
  initialData,
  boards,
}: {
  initialData: DashboardCache;
  boards: BoardOption[];
}) {
  const dashboardId = initialData.dashboard.id;
  const { data: cache } = useDashboardCache(dashboardId, initialData);
  const { persistLayout, renameDashboard } = useDashboardMutations(dashboardId);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const dashboardName = cache.dashboard.name;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(dashboardName);
  const [isRenamePending, startRename] = useTransition();

  function openRename() {
    setNameDraft(dashboardName);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = nameDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === dashboardName) return;
    startRename(() => renameDashboard(trimmed));
  }

  // react-grid-layout v2 has no WidthProvider HOC — measure the container width
  // ourselves and feed it to ResponsiveGridLayout.
  const { width, containerRef, mounted } = useContainerWidth();

  const widgets = cache.widgets;

  const layout: LayoutItem[] = widgets.map((w) => {
    const r = (w.layout ?? {}) as Partial<GridRect>;
    return {
      i: w.id,
      x: r.x ?? DEFAULT_RECT.x,
      y: r.y ?? DEFAULT_RECT.y,
      w: r.w ?? DEFAULT_RECT.w,
      h: r.h ?? DEFAULT_RECT.h,
    };
  });

  const layouts: ResponsiveLayouts = useMemo(
    () => ({ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }),
    // layout is derived from cache.widgets each render; key the memo on the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widgets],
  );

  // Persist 600ms after the last drag/resize. onMutate patches the cache
  // immediately, so no data refetch happens here.
  const persistRects = useDebouncedCallback(
    (rects: ({ id: string } & GridRect)[]) => persistLayout.mutate(rects),
    600,
  );
  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (!editing) return; // ignore layout events while in view mode
      persistRects(
        next.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
      );
    },
    [editing, persistRects],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        {renaming ? (
          <Input
            autoFocus
            value={nameDraft}
            disabled={isRenamePending}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenaming(false);
              }
            }}
            aria-label="Dashboard name"
            className="h-8 max-w-md text-lg font-semibold"
          />
        ) : (
          <h1 className="text-lg font-semibold">
            <button
              type="button"
              onClick={openRename}
              className="hover:text-muted-foreground focus-visible:ring-ring rounded-sm text-left tracking-tight transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {dashboardName}
            </button>
          </h1>
        )}
        <div className="flex items-center gap-2">
          {editing ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
            >
              Add widget
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={editing ? "default" : "outline"}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <EmptyState>
          No widgets yet. Click <strong>Edit</strong> →{" "}
          <strong>Add widget</strong>.
        </EmptyState>
      ) : (
        <div ref={containerRef}>
          {mounted ? (
            // One batched fetch for all aggregate widgets (distributed via
            // context), instead of one server round-trip per widget.
            <WidgetDataProvider dashboardId={dashboardId} widgets={widgets}>
              <ResponsiveGridLayout
                className="layout"
                width={width}
                layouts={layouts}
                breakpoints={BREAKPOINTS}
                cols={COLS}
                rowHeight={80}
                margin={[12, 12]}
                dragConfig={{ enabled: editing }}
                resizeConfig={{ enabled: editing }}
                onLayoutChange={onLayoutChange}
              >
                {widgets.map((w) => (
                  <div key={w.id}>
                    <DashboardWidget
                      widget={w}
                      dashboardId={dashboardId}
                      editing={editing}
                      boards={boards}
                    />
                  </div>
                ))}
              </ResponsiveGridLayout>
            </WidgetDataProvider>
          ) : null}
        </div>
      )}
      <WidgetConfigSheet
        dashboardId={dashboardId}
        boards={boards}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}
