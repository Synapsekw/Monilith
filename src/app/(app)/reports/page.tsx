import { requireUser } from "@/lib/auth/session";
import { isActiveOrgGuest } from "@/lib/org/guest";
import { GuestUnavailable } from "@/components/shell/guest-unavailable";
import { getActiveOrgId } from "@/lib/org/active";
import { listReportsForOrg, listReportTemplates } from "@/lib/reports/queries";
import { ReportsIndex } from "@/components/reports/ReportsIndex";

/**
 * `/reports` — the org-wide report index: a peer of Dashboards, Portfolios and
 * Goals. Lists every report in the active org (board reports and roll-ups)
 * above the org's template gallery. Board reports stay reachable from
 * `/boards/[boardId]/reports`.
 *
 * Reads are bounded by the query's own limit, and both lists are fetched
 * concurrently. The identity read (`getActiveOrgId`) stays OUTSIDE any cache —
 * the Phase-9.3 rule.
 */
export default async function ReportsIndexPage() {
  const user = await requireUser();
  // Org-wide planning is not offered to guests (the sidebar hides the link);
  // reached by URL, say so instead of rendering an empty page whose create
  // buttons the database refuses. Same cached role read as the shell.
  if (await isActiveOrgGuest(user.id))
    return <GuestUnavailable title="Reports" />;
  const orgId = await getActiveOrgId();
  const [reports, templates] = orgId
    ? await Promise.all([
        listReportsForOrg(orgId, { includeTemplates: false }),
        listReportTemplates(orgId),
      ])
    : [[], []];

  return <ReportsIndex reports={reports} templates={templates} />;
}
