import type { Tables } from "@/types/database.types";

export type ItemUpdate = Tables<"item_updates">;
export type ItemActivity = Tables<"item_activities">;

export type UpdatesCache = { updates: ItemUpdate[] };
export type ActivityCache = { activities: ItemActivity[] };

export function prependUpdate(c: UpdatesCache, u: ItemUpdate): UpdatesCache {
  if (c.updates.some((x) => x.id === u.id)) return c;
  return { updates: [u, ...c.updates] };
}

export function replaceUpdate(c: UpdatesCache, u: ItemUpdate): UpdatesCache {
  return { updates: c.updates.map((x) => (x.id === u.id ? u : x)) };
}

export function removeUpdate(c: UpdatesCache, id: string): UpdatesCache {
  return { updates: c.updates.filter((x) => x.id !== id) };
}

export function prependActivity(
  c: ActivityCache,
  a: ItemActivity,
): ActivityCache {
  if (c.activities.some((x) => x.id === a.id)) return c;
  return { activities: [a, ...c.activities] };
}
