import type { Classification } from "@/lib/ai/column-fill/schema";
import { COLUMN_FILL_MAX } from "@/lib/ai/column-fill/schema";

/**
 * Re-validates raw model classifications before they ever touch a mutation:
 * every `optionId` must reference a real target option (unknown ids are
 * nulled out — "no confident match" — with a warning), and the row count is
 * bounded by `ctx.max` (default `COLUMN_FILL_MAX`). Never trust raw model
 * output.
 */
export function validateClassifications(
  classifications: Classification[],
  ctx: { targetOptionIds: Set<string>; max?: number },
): { classifications: Classification[]; warnings: string[] } {
  const warnings: string[] = [];
  const max = ctx.max ?? COLUMN_FILL_MAX;

  let rows = classifications;
  if (rows.length > max) {
    warnings.push(
      `Row cap exceeded: ${rows.length} rows received, keeping the first ${max} (cap ${max}).`,
    );
    rows = rows.slice(0, max);
  }

  const validated = rows.map((row) => {
    if (row.optionId === null) return row;
    if (ctx.targetOptionIds.has(row.optionId)) return row;
    warnings.push(
      `Row "${row.itemId}": unknown optionId "${row.optionId}" is not a target option — set to null.`,
    );
    return { itemId: row.itemId, optionId: null };
  });

  return { classifications: validated, warnings };
}
