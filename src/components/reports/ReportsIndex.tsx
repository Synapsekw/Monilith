import Link from "next/link";
import { FileText, LayoutTemplate } from "lucide-react";
import type { ReportRow, ReportScope } from "@/lib/reports/queries";
import { formatDateTime } from "@/lib/datetime/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Kicker } from "@/components/ui/kicker";

/**
 * A row as the org index needs it: the query's `ReportRow`, plus an optional
 * board list a roll-up can carry. Optional on purpose — the chip degrades to
 * "Multiple boards" when the read doesn't hydrate membership, and nothing here
 * issues a second query to find out (AGENTS.md #5: bounded hot-path reads).
 */
export type ReportIndexRow = ReportRow & { boardIds?: string[] };

/**
 * What the report covers, in words. Kept quiet and typographic — the scope is
 * orientation, not status, so it never earns a color.
 */
export function scopeLabel(scope: ReportScope, boardCount?: number): string {
  switch (scope) {
    case "board":
      return "Board";
    case "boards":
      return boardCount && boardCount > 0
        ? `${boardCount} boards`
        : "Multiple boards";
    case "portfolio":
      return "Portfolio";
    case "template":
      return "Template";
  }
}

/** Mono uppercase hairline chip — the Keystone kicker recipe, boxed. */
function ScopeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-kicker text-3xs shrink-0 rounded-sm border px-1.5 py-0.5 font-mono font-medium tracking-[0.1em] uppercase">
      {children}
    </span>
  );
}

function ReportLink({
  report,
  icon: Icon,
  chip,
}: {
  report: ReportIndexRow;
  icon: typeof FileText;
  chip?: string;
}) {
  return (
    <li className="hover:bg-state-hover transition-colors">
      <Link
        href={`/reports/${report.id}`}
        className="focus-visible:ring-ring flex items-center gap-3 rounded-md px-3 py-2.5 outline-none focus-visible:ring-2"
      >
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{report.name}</span>
          <span className="text-muted-foreground text-xs">
            Updated {formatDateTime(report.updatedAt)}
          </span>
        </span>
        {chip ? <ScopeChip>{chip}</ScopeChip> : null}
      </Link>
    </li>
  );
}

/**
 * The org-wide reports index: every report in the organization — single-board,
 * multi-board roll-ups and portfolio-bound roll-ups — over the org's template
 * gallery. Presentational Server Component; the page owns the reads.
 */
export function ReportsIndex({
  reports,
  templates,
}: {
  reports: ReportIndexRow[];
  templates: ReportIndexRow[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Kicker>Planning</Kicker>
        <h1 className="text-lg font-bold">Reports</h1>
        {reports.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {reports.length} {reports.length === 1 ? "report" : "reports"} in
            this organization
          </p>
        ) : null}
      </div>

      {reports.length === 0 ? (
        <EmptyState className="flex flex-col items-center gap-2">
          <p className="text-foreground text-sm font-medium">No reports yet</p>
          <p className="max-w-md">
            A report turns board data into a shareable PDF. It can cover one
            board, roll up several at once, or follow a portfolio and pick up
            every board in it.
          </p>
          <p className="max-w-md">
            Open a board and use its Reports tab to build the first one.
          </p>
        </EmptyState>
      ) : (
        <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg border">
          {reports.map((r) => (
            <ReportLink
              key={r.id}
              report={r}
              icon={FileText}
              chip={scopeLabel(r.scope, r.boardIds?.length)}
            />
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3 border-t pt-6">
        <div className="flex flex-col gap-1">
          <Kicker>Templates</Kicker>
          <p className="text-muted-foreground text-xs">
            Saved layouts to start a new report from.
          </p>
        </div>
        {templates.length === 0 ? (
          <EmptyState variant="inline">
            No templates yet. Save a report as a template to reuse its layout
            across boards.
          </EmptyState>
        ) : (
          <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg border">
            {templates.map((t) => (
              <ReportLink key={t.id} report={t} icon={LayoutTemplate} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
