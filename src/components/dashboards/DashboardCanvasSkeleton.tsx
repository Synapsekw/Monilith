import { Skeleton } from "@/components/ui/skeleton";

/**
 * Single dashboard-widget card chrome. Mirrors DashboardWidget:
 * `bg-card flex h-full flex-col overflow-hidden rounded-[14px] border`,
 * header `border-b px-3 py-2`, body `min-h-0 flex-1 p-3`.
 */
export function DashboardWidgetSkeleton() {
  return (
    <div
      data-testid="widget-skeleton"
      className="bg-card flex h-full flex-col overflow-hidden rounded-[14px] border"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-4" />
      </div>
      <div className="min-h-0 flex-1 p-3">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

// Representative span heights (DashboardCanvas rowHeight=80, margin 12):
// h=2 -> ~172px, h=3 -> ~252px. Fixed heights keep the box stable.
const WIDGET_HEIGHTS = [
  "h-[172px]",
  "h-[252px]",
  "h-[172px]",
  "h-[172px]",
  "h-[252px]",
  "h-[172px]",
];

/**
 * Full dashboard canvas loading state. Mirrors DashboardCanvas:
 * root `flex flex-col gap-3 p-4`, toolbar `flex items-center justify-between`,
 * then a responsive grid of widget cards. Static markup, 0 data fetch.
 */
export function DashboardCanvasSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
      className="flex flex-col gap-3 p-4"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {WIDGET_HEIGHTS.map((h, i) => (
          <div key={i} className={h}>
            <DashboardWidgetSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
