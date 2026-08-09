import { redirect } from "next/navigation";

/**
 * Legacy deep link → the builder's real home.
 *
 * The builder used to live here, under one board. A report can now roll up
 * several boards or follow a portfolio, so it moved to `/reports/[reportId]`
 * and this route is kept purely so existing bookmarks, shared links and
 * anything that stored the old URL keep working. It is a permanent fixture of
 * the app, not a migration step to delete later.
 *
 * No reads happen here: `boardId` is not even resolved, because the target
 * page owns auth and access (a report bound to boards you cannot read 404s
 * there). Redirecting before any query also means a stale link costs nothing.
 *
 * `redirect` (307) rather than `permanentRedirect` (308) on purpose: a 308 is
 * cached by the browser indefinitely, which would make the route impossible to
 * reclaim. Bookmarks follow either one.
 */
export default async function LegacyReportBuilderPage({
  params,
}: {
  params: Promise<{ boardId: string; reportId: string }>;
}) {
  const { reportId } = await params;
  redirect(`/reports/${reportId}`);
}
