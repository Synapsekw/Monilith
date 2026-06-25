import { DashboardCanvasSkeleton } from "@/components/dashboards/DashboardCanvasSkeleton";

/**
 * Instant loading fallback for a dashboard. Mirrors the canvas layout so the
 * widget grid swaps in with zero layout shift. Also reused as the 9.2 Suspense
 * fallback. Static Server Component — no data fetch.
 */
export default function DashboardLoading() {
  return <DashboardCanvasSkeleton />;
}
