import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { listReadableBoardsCached } from "@/lib/portfolios/queries-cached";
import { listPortfolios } from "@/lib/portfolios/queries";
import { getReport } from "@/lib/reports/queries";
import { resolveReportAccess } from "@/lib/reports/access";
import { loadReportScopeContext } from "@/lib/reports/payload";
import { ReportBuilder } from "@/components/reports/ReportBuilder";

/**
 * `/reports/[reportId]` — the report builder's home.
 *
 * A report is no longer a child of one board (it can roll up several, or follow
 * a portfolio), so the builder lives under `/reports`, not under a board. The
 * old `/boards/[boardId]/reports/[reportId]` URL redirects here.
 *
 * ACCESS: `resolveReportAccess` is the gate. `!canRead` is a 404, not a 403 —
 * the existence of a report bound to boards you cannot see is itself
 * information. `canEdit` is passed to the client so a viewer gets the whole
 * builder with its mutating controls disabled.
 *
 * DATA BUDGET (working agreement #5): this is the ONLY read the builder makes.
 * `loadReportScopeContext` fetches one bounded payload per READABLE bound board
 * — never the omitted ones — and everything after first paint is derived in the
 * browser from what it returns.
 */
export default async function ReportBuilderPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  // Identity read OUTSIDE the cache scope (the Phase-9.3 rule) — the user id
  // keys the cached readable-boards entry the scope picker offers.
  const user = await requireUser();

  const report = await getReport(reportId);
  if (!report) notFound();

  const access = await resolveReportAccess(report);
  if (!access.canRead) notFound();

  const [ctx, pickableBoards, portfolios] = await Promise.all([
    loadReportScopeContext(report, access),
    listReadableBoardsCached(user.id),
    listPortfolios(),
  ]);

  return (
    <div style={{ height: "100dvh" }}>
      <ReportBuilder
        reportId={report.id}
        initialName={report.name}
        initialConfig={report.config}
        payloads={ctx.payloads}
        peopleNames={ctx.peopleNames}
        scopeLabel={ctx.scopeLabel}
        omittedBoardCount={ctx.omittedBoardCount}
        orgName={ctx.orgName}
        canEdit={access.canEdit}
        scope={report.scope}
        boardId={report.boardId}
        portfolioId={report.portfolioId}
        boundBoardIds={access.boardIds}
        pickableBoards={pickableBoards.map((b) => ({
          id: b.id,
          name: b.name,
        }))}
        portfolios={portfolios}
      />
    </div>
  );
}
