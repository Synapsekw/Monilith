import Link from "next/link";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import {
  listReportsForBoard,
  listReportTemplates,
} from "@/lib/reports/queries";
import { formatDateTime } from "@/lib/datetime/format";
import { Kicker } from "@/components/ui/kicker";
import { EmptyState } from "@/components/ui/empty-state";
import { scopeLabel } from "@/components/reports/ReportsIndex";
import { CreateReportButton } from "@/components/reports/CreateReportButton";
import { ReportRowActions } from "@/components/reports/ReportRowActions";

/**
 * A board's reports tab.
 *
 * `listReportsForBoard` is MEMBERSHIP-based now, so this list includes
 * multi-board roll-ups and portfolio reports that happen to contain this board
 * — not only reports whose home board it is. Those rows carry a scope chip so a
 * roll-up is never mistaken for a report about this board alone, and every row
 * opens the builder at its real home, `/reports/[reportId]`.
 *
 * Both reads are bounded by the queries' own limits and run concurrently. The
 * identity read stays outside any cache (the Phase-9.3 rule).
 */
export default async function ReportsListPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const orgId = await getActiveOrgId();
  const [reports, templates] = await Promise.all([
    listReportsForBoard(boardId),
    orgId ? listReportTemplates(orgId) : Promise.resolve([]),
  ]);
  const templateOptions = templates.map((t) => ({ id: t.id, name: t.name }));

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
        {reports.length > 0 ? (
          <CreateReportButton boardId={boardId} templates={templateOptions} />
        ) : null}
      </div>

      {reports.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-4">
          <p>No reports yet. Create one to build a shareable PDF.</p>
          <CreateReportButton boardId={boardId} templates={templateOptions} />
        </EmptyState>
      ) : (
        <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg border">
          {reports.map((r) => (
            <li
              key={r.id}
              className="group hover:bg-state-hover flex items-center gap-3 px-3 py-2.5 transition-colors"
            >
              <Link
                href={`/reports/${r.id}`}
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
              {r.scope === "board" ? null : (
                <span className="text-kicker text-3xs shrink-0 rounded-sm border px-1.5 py-0.5 font-mono font-medium tracking-[0.1em] uppercase">
                  {scopeLabel(r.scope)}
                </span>
              )}
              <ReportRowActions reportId={r.id} reportName={r.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
