import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getBoardPayload } from "@/lib/boards/queries";
import { resolvePeopleNames } from "@/lib/boards/people-names";
import { resolveActiveOrg } from "@/lib/org/active";
import { getReport } from "@/lib/reports/queries";
import { ReportBuilder } from "@/components/reports/ReportBuilder";

export default async function ReportBuilderPage({
  params,
}: {
  params: Promise<{ boardId: string; reportId: string }>;
}) {
  const { boardId, reportId } = await params;
  await requireUser();
  const [payload, report] = await Promise.all([
    getBoardPayload(boardId),
    getReport(reportId),
  ]);
  if (!payload || !report || report.boardId !== boardId) notFound();
  const peopleNames = Object.fromEntries(await resolvePeopleNames(payload));
  // Org display name for the cover — the human-readable name, never the id.
  const orgName = (await resolveActiveOrg())?.name ?? "";
  return (
    <div style={{ height: "100dvh" }}>
      <ReportBuilder
        reportId={report.id}
        boardId={boardId}
        initialName={report.name}
        initialConfig={report.config}
        payload={payload}
        peopleNames={peopleNames}
        orgName={orgName}
      />
    </div>
  );
}
