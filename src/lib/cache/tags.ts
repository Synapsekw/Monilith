import "server-only";

/**
 * Single source of truth for `use cache` tag strings. Producers (cached reads,
 * via cacheTag) and consumers (Server Actions, via updateTag) MUST both import
 * from here — never inline a literal, or invalidation silently breaks.
 *
 * Tags are identity-scoped so a user can only ever serve/invalidate their own
 * cache entry: a leak across tenants is impossible by construction.
 */
export const boardsTag = (userId: string) => `boards:user:${userId}`;
export const sharedBoardsTag = (userId: string) =>
  `shared-boards:user:${userId}`;
export const dashboardsTag = (orgId: string) => `dashboards:org:${orgId}`;
export const workspacesTag = (orgId: string) => `workspaces:org:${orgId}`;
export const platformAdminTag = (userId: string) =>
  `platform-admin:user:${userId}`;
export const orgAdminTag = (userId: string, orgId: string) =>
  `org-admin:user:${userId}:org:${orgId}`;
export const widgetAggregationTag = (orgId: string, widgetId: string) =>
  `widget-agg:org:${orgId}:widget:${widgetId}`;
