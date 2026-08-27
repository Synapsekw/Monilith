import { AdminListSkeleton } from "@/components/admin/AdminListSkeleton";

/**
 * Instant loading fallback for the feedback triage list. Mirrors
 * FeedbackFilters' kind/status chip strip and its five-column table, so the
 * real list swaps in without shifting the page. Static Server Component.
 */
export default function AdminFeedbackLoading() {
  return (
    <AdminListSkeleton
      label="feedback"
      gridClass="grid grid-cols-[0.5fr_2fr_1fr_1fr_90px] gap-3"
      cellWidths={["w-10", "w-56", "w-20", "w-16", null]}
      rows={8}
      toolbar="filters"
    />
  );
}
