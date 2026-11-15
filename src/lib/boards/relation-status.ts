/** The status a linked item currently shows on its own board. */
export type LinkedItemStatus = { label: string; color: string };

type StatusCell = { item_id: string; column_id: string; value: unknown };
type StatusColumn = { id: string; position: number; settings: unknown };
type Option = { id: string; label: string; color: string };

function optionsOf(settings: unknown): Option[] {
  const raw = (settings as { options?: unknown } | null)?.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is Option =>
      !!o &&
      typeof o === "object" &&
      typeof (o as Option).id === "string" &&
      typeof (o as Option).label === "string" &&
      typeof (o as Option).color === "string",
  );
}

/**
 * Resolve the status each linked item shows, for colouring relation chips.
 *
 * A target board can carry several status-kind columns (the Milestones board
 * has Status and Programme). The left-most one that holds a value wins, which
 * matches what a person reads as "the status" of that row. `cells` are the
 * linked items' status-kind cells; `columns` are those boards' status columns.
 */
export function resolveLinkedStatuses(
  cells: readonly StatusCell[],
  columns: readonly StatusColumn[],
): Map<string, LinkedItemStatus> {
  const byColumn = new Map(
    columns.map((c) => [
      c.id,
      {
        position: c.position,
        options: new Map(optionsOf(c.settings).map((o) => [o.id, o])),
      },
    ]),
  );

  const best = new Map<
    string,
    { position: number; status: LinkedItemStatus }
  >();
  for (const cell of cells) {
    const column = byColumn.get(cell.column_id);
    if (!column) continue;
    const optionId = (cell.value as { optionId?: unknown } | null)?.optionId;
    if (typeof optionId !== "string") continue;
    const option = column.options.get(optionId);
    if (!option) continue;
    const current = best.get(cell.item_id);
    if (current && current.position <= column.position) continue;
    best.set(cell.item_id, {
      position: column.position,
      status: { label: option.label, color: option.color },
    });
  }

  return new Map([...best].map(([itemId, b]) => [itemId, b.status]));
}
