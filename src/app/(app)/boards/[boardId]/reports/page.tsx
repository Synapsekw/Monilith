import Link from "next/link";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listReports } from "@/lib/reports/queries";
import { formatDateTime } from "@/lib/datetime/format";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateReportButton } from "@/components/reports/CreateReportButton";
import { ReportRowActions } from "@/components/reports/ReportRowActions";

export default async function ReportsListPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const reports = await listReports(boardId);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Kicker>Reports</Kicker>
          <h1 className="text-lg font-bold">
            {reports.length === 0
              ? "PDF reports"
              : `${reports.length} ${reports.length === 1 ? "report" : "reports"}`}
          </h1>
        </div>
        {reports.length > 0 ? <CreateReportButton boardId={boardId} /> : null}
      </div>

      {reports.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-4">
          <p>No reports yet. Create one to build a shareable PDF.</p>
          <CreateReportButton boardId={boardId} />
        </EmptyState>
      ) : (
        <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg border">
          {reports.map((r) => (
            <li
              key={r.id}
              className="group hover:bg-state-hover flex items-center gap-3 px-3 py-2.5 transition-colors"
            >
              <Link
                href={`/boards/${boardId}/reports/${r.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 outline-none"
              >
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="text-muted-foreground text-xs">
                    Updated {formatDateTime(r.updatedAt)}
                  </span>
                </span>
              </Link>
              <ReportRowActions
                reportId={r.id}
                boardId={boardId}
                reportName={r.name}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
