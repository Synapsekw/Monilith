import { Suspense } from "react";
import { listFeedbackPage } from "@/lib/feedback/queries";
import { Pager } from "@/components/platform/pager";
import { FeedbackFilters } from "@/components/feedback/FeedbackFilters";

export const metadata = { title: "Platform admin · feedback" };

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const page = Math.max(0, Number(pageStr ?? "0") || 0);
  const { rows, hasMore } = await listFeedbackPage({ page });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Feedback
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          All user-submitted bugs and feature requests.
        </p>
      </header>

      {/* Client-state filters + list — 0 server round-trips, operates on already-loaded rows */}
      <Suspense fallback={null}>
        <FeedbackFilters rows={rows} />
      </Suspense>

      <Pager
        basePath="/admin/feedback"
        page={page}
        pageSize={50}
        hasNext={hasMore}
      />
    </div>
  );
}
