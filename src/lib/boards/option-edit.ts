import type { ColumnOption } from "@/lib/validations/boards";

import { nextOptionColor } from "./option-colors";

export function addOption(opts: readonly ColumnOption[]): ColumnOption[] {
  return [
    ...opts,
    {
      id: crypto.randomUUID(),
      label: "New label",
      color: nextOptionColor(opts.map((o) => o.color)),
    },
  ];
}

export function renameOption(
  opts: readonly ColumnOption[],
  id: string,
  label: string,
): ColumnOption[] {
  return opts.map((o) => (o.id === id ? { ...o, label } : o));
}

export function recolorOption(
  opts: readonly ColumnOption[],
  id: string,
  color: string,
): ColumnOption[] {
  return opts.map((o) => (o.id === id ? { ...o, color } : o));
}

export function reorderOptions(
  opts: readonly ColumnOption[],
  from: number,
  to: number,
): ColumnOption[] {
  const next = [...opts];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function removeOption(
  opts: readonly ColumnOption[],
  id: string,
): ColumnOption[] {
  return opts.filter((o) => o.id !== id);
}

type CellLike = { column_id: string; value: unknown };

/** How many cells on `columnId` reference `optionId` (status + dropdown). Pure, from cache. */
export function countOptionUsage(
  cells: readonly CellLike[],
  columnId: string,
  optionId: string,
): number {
  let n = 0;
  for (const c of cells) {
    if (c.column_id !== columnId) continue;
    const v = c.value as { optionId?: string | null; optionIds?: string[] };
    if (v?.optionId === optionId) n++;
    else if (v?.optionIds?.includes(optionId)) n++;
  }
  return n;
}
