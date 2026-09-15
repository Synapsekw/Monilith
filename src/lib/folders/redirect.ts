/** Spec §4: a dashboard with a live folder redirects into that folder's Overview; otherwise the legacy canvas renders. */
export function dashboardRedirectTarget(
  dashboard: { folder_id: string | null },
  folderExists: boolean,
): string | null {
  if (!dashboard.folder_id || !folderExists) return null;
  return `/folders/${dashboard.folder_id}?tab=overview#widgets`;
}
