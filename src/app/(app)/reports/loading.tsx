import { ReportsIndexSkeleton } from "@/components/reports/ReportsIndexSkeleton";

/** Instant loading fallback for the org reports index. Static Server Component. */
export default function ReportsLoading() {
  return <ReportsIndexSkeleton />;
}
