import { DashboardCanvasSkeleton } from "@/components/dashboards/DashboardCanvasSkeleton";

/**
 * Instant loading fallback for the dashboards index. Mirrors the canvas layout
 * so the widget grid swaps in with zero layout shift. Static Server Component —
 * no data fetch.
 */
export default function DashboardsLoading() {
  return <DashboardCanvasSkeleton />;
}
