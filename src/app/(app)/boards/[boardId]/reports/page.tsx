import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listReports } from "@/lib/reports/queries";
import { CreateReportButton } from "@/components/reports/CreateReportButton";

export default async function ReportsListPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const reports = await listReports(boardId);
  return (
    <div style={{ padding: 24 }}>
      <h1>Reports</h1>
      <CreateReportButton boardId={boardId} />
      <ul>
        {reports.map((r) => (
          <li key={r.id}>
            <Link href={`/boards/${boardId}/reports/${r.id}`}>{r.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
