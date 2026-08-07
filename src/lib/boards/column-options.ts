import { optionSchema, type ColumnOption } from "@/lib/validations/boards";

/**
 * Parse a column's `settings.options` into the canonical option list.
 *
 * Pure and TOTAL: any shape of input yields an array, never a throw, so one
 * hand-edited `settings` jsonb can never fail a whole board read. The array is
 * validated as a unit — one bad entry discards all of them, rather than
 * returning a partial list a caller would wrongly treat as complete.
 *
 * Callers: `buildBoardSnapshot` (`src/lib/ai/board-snapshot.ts`, projects to
 * `{id, label}` for /ask token economy) and `describeColumn`
 * (`src/lib/mcp/tools/column-meta.ts`, emits `color` too).
 */
export function parseColumnOptions(settings: unknown): ColumnOption[] {
  const raw =
    typeof settings === "object" && settings !== null
      ? (settings as { options?: unknown }).options
      : undefined;
  return optionSchema.array().safeParse(raw ?? []).data ?? [];
}
