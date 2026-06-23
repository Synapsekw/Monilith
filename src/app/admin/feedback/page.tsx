import { Suspense } from "react";
import Link from "next/link";
import { listFeedbackPage } from "@/lib/feedback/queries";
import { Pager } from "@/components/platform/pager";
import { FeedbackFilters } from "@/components/feedback/FeedbackFilters";

export const metadata = { title: "Platform admin · feedback" };

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  planned: "Planned",
  in_progress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-status-blue",
  triaged: "bg-status-teal",
  planned: "bg-status-purple",
  in_progress: "bg-status-orange",
  resolved: "bg-status-green",
  declined: "bg-status-gray",
};

const KIND_LABELS: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature",
};

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

      {/* Client-state filters — 0 server round-trips, operates on already-loaded rows */}
      <Suspense fallback={null}>
        <FeedbackFilters rows={rows}>
          {(filtered) =>
            filtered.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No feedback matches the current filter.
              </p>
            ) : (
              <div className="bg-surface overflow-hidden rounded-xl border">
                <div className="text-muted-foreground grid grid-cols-[0.5fr_2fr_1fr_1fr_90px] gap-3 border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase">
                  <span>Kind</span>
                  <span>Title</span>
                  <span>Submitted</span>
                  <span>Status</span>
                  <span />
                </div>
                {filtered.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[0.5fr_2fr_1fr_1fr_90px] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                  >
                    <span className="text-muted-foreground text-xs">
                      {KIND_LABELS[row.kind] ?? row.kind}
                    </span>
                    <span className="text-foreground truncate font-medium">
                      {row.title}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                    <span>
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-white ${STATUS_COLORS[row.status] ?? "bg-status-gray"}`}
                      >
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </span>
                    <Link
                      href={`/admin/feedback/${row.id}`}
                      className="text-primary text-right text-xs font-medium"
                    >
                      Review →
                    </Link>
                  </div>
                ))}
              </div>
            )
          }
        </FeedbackFilters>
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
