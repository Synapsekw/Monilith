/**
 * Spec §4: a dashboard with a live folder redirects into that folder's
 * Overview; otherwise the legacy canvas renders.
 *
 * `reviewRequested` (`?review=1`) is the one carve-out: the `AiReviewBanner`
 * Keep/Regenerate/Discard flow lives on the legacy canvas, and Task 13's AI
 * wizard sets `folder_id` at creation time while still pushing to
 * `/dashboards/{id}?review=1` — without this, that safety net would be
 * unreachable for every folder-attached dashboard. Defaults to `false` so
 * existing two-argument callers are unaffected.
 */
export function dashboardRedirectTarget(
  dashboard: { folder_id: string | null },
  folderExists: boolean,
  reviewRequested = false,
): string | null {
  if (!dashboard.folder_id || !folderExists || reviewRequested) return null;
  return `/folders/${dashboard.folder_id}?tab=overview#widgets`;
}
