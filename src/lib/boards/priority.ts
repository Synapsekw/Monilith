// Pure render-time priority derivation. Spec (priority-critical, 2026-07-03):
// effective = critical iff stored.level === "critical" OR >= 2 direct
// dependents; the stored value is never mutated by the rule (self-clearing,
// like the overdue tint — zero schema, 0 extra round-trips, gotcha-09).
import type { CacheDependency } from "@/lib/boards/cache";

/** Direct dependents required before an item auto-reads Critical. */
export const AUTO_CRITICAL_MIN_DEPENDENTS = 2;

/**
 * One O(E) pass over the board's dependency edges → predecessor id → count of
 * direct successors. Memoize on `cache.dependencies` at the call site so
 * per-row lookups are O(1).
 */
export function buildDependentsCountMap(
  dependencies: readonly Pick<CacheDependency, "predecessor_id">[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of dependencies) {
    map.set(d.predecessor_id, (map.get(d.predecessor_id) ?? 0) + 1);
  }
  return map;
}

/**
 * Displayed priority for a cell. `auto: true` only when the dependents
 * threshold (not a manual Critical) caused the escalation — it drives the
 * distinguishing icon + "Critical (auto)" label.
 */
export function effectivePriority(
  value: unknown,
  dependents: number,
): { level: "normal" | "critical"; auto: boolean } {
  const stored =
    typeof value === "object" && value !== null
      ? (value as { level?: unknown }).level
      : undefined;
  if (stored === "critical") return { level: "critical", auto: false };
  if (dependents >= AUTO_CRITICAL_MIN_DEPENDENTS)
    return { level: "critical", auto: true };
  return { level: "normal", auto: false };
}
