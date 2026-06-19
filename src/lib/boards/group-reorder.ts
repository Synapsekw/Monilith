/**
 * Given the current position-ordered groups and a drag (activeId dropped over
 * overId), return the new float `position` for the active group — or null for a
 * no-op. Boundary drops use ±1 (not midpoint's halving) so a drop above a group
 * sitting at position 0 still sorts strictly before it.
 */
export function reorderPosition(
  groups: { id: string; position: number }[],
  activeId: string,
  overId: string,
): number | null {
  if (activeId === overId) return null;
  const from = groups.findIndex((g) => g.id === activeId);
  const to = groups.findIndex((g) => g.id === overId);
  if (from === -1 || to === -1) return null;

  // `to` indexes the original (position-ordered) array; `without` excludes the
  // active group, so `to` is also the slot the active group should occupy —
  // correct whether moving up or down.
  const without = groups.filter((g) => g.id !== activeId);
  const before = without[to - 1]?.position ?? null;
  const after = without[to]?.position ?? null;

  if (before === null && after === null) return 0;
  if (before === null) return after! - 1; // dropped at the top
  if (after === null) return before + 1; // dropped at the bottom
  return (before + after) / 2; // inserted between two groups
}
