import "server-only";

import { createClient } from "@/lib/supabase/server";
import { type BoardPayload } from "@/lib/boards/queries";

/**
 * Build a `userId → display name` map for the people cells in a board payload.
 * Returns an empty map (and skips the DB read) when the board has no people
 * columns or no assignees. RLS-scoped read of `profiles(id, full_name)`; ids
 * whose profile is missing or has no name are simply absent from the map and
 * get dropped at render time.
 */
export async function resolvePeopleNames(
  payload: BoardPayload,
): Promise<Map<string, string>> {
  const peopleColumnIds = new Set(
    payload.columns.filter((c) => c.kind === "people").map((c) => c.id),
  );
  if (peopleColumnIds.size === 0) return new Map();

  const userIds = new Set<string>();
  for (const cv of payload.cellValues) {
    if (!peopleColumnIds.has(cv.column_id)) continue;
    const ids = (cv.value as { userIds?: unknown } | null)?.userIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) if (typeof id === "string") userIds.add(id);
  }
  if (userIds.size === 0) return new Map();

  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...userIds]);

  const map = new Map<string, string>();
  for (const p of profiles ?? []) {
    if (p.full_name) map.set(p.id, p.full_name);
  }
  return map;
}
