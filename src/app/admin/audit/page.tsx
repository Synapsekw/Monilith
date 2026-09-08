import { platformAuditFeed } from "@/lib/platform/queries";
import { ActivityFeed } from "@/components/settings/activity-feed";
import { Pager } from "@/components/platform/pager";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Platform admin · audit log" };
const PAGE_SIZE = 50;

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const page = Math.max(0, Number(pageStr ?? "0") || 0);
  // Fetch one extra row to know whether a next page exists (audit feed has no count).
  const rows = await platformAuditFeed(PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Platform"
        title="Audit log"
        description="Every privileged action across the platform."
      />

      <div className="bg-surface rounded-lg border p-4">
        <ActivityFeed rows={pageRows} />
      </div>

      <Pager
        basePath="/admin/audit"
        page={page}
        pageSize={PAGE_SIZE}
        hasNext={hasNext}
      />
    </div>
  );
}
