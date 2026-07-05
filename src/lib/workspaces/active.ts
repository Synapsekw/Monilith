import "server-only";
import { cookies } from "next/headers";

/** Persisted "current workspace" selection. Read in the sidebar loader (outside
 * any `use cache` scope) and passed into the cached board/dashboard reads. */
export const ACTIVE_WS_COOKIE = "pulse_active_ws";

/**
 * The active workspace id: the cookie value when it still matches one of the
 * user's workspaces, otherwise the first workspace (stable default), otherwise
 * "". Validating against the passed list means a deleted/foreign id can never
 * scope the nav to nothing.
 */
export async function getActiveWorkspaceId(
  workspaces: { id: string }[],
): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(ACTIVE_WS_COOKIE)?.value;
  if (raw && workspaces.some((w) => w.id === raw)) return raw;
  return workspaces[0]?.id ?? "";
}
