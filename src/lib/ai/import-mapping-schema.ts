import {
  IMPORTABLE_KINDS,
  type ImportableKind,
  type ColumnRole,
  type ColumnTarget,
} from "@/lib/boards/spreadsheet/types";
import type {
  ColumnState,
  SheetState,
} from "@/components/boards/import/import-wizard-state";

/**
 * One AI-proposed mapping for a single source column. The model copies
 * `sourceIndex` from the payload it was given and proposes a `kind`, a `role`
 * ("name" for the item-title column, "data" otherwise), and — in existing-board
 * mode — an optional `targetColumnId` to merge into. Every field is
 * re-validated/clamped by `applyMappingSuggestions` before it can touch state;
 * the model's output is never trusted.
 */
export type MappingSuggestion = {
  sourceIndex: number;
  kind: ImportableKind;
  role: "name" | "data";
  targetColumnId?: string;
};

// JSON schema handed to the model (output_config.format). Mirrors the
// proposal-schema.ts style: the discriminating fields are REQUIRED and the
// value domains are pinned via `enum`, so under strict structured output the
// model can't emit empty/garbage mappings. Ids stay plain strings;
// applyMappingSuggestions re-checks them against the real board columns.
export const IMPORT_MAPPING_JSON_SCHEMA = {
  type: "object",
  required: ["suggestions"],
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      // Bound to the server-side column cap so the model can't over-produce.
      maxItems: 40,
      items: {
        type: "object",
        required: ["sourceIndex", "kind", "role"],
        additionalProperties: false,
        properties: {
          sourceIndex: { type: "integer", minimum: 0 },
          kind: { type: "string", enum: IMPORTABLE_KINDS },
          role: { type: "string", enum: ["name", "data"] },
          // Only set when confidently merging into an existing board column.
          targetColumnId: { type: "string" },
        },
      },
    },
  },
} as const;

const IMPORTABLE_KIND_SET = new Set<string>(IMPORTABLE_KINDS);

/**
 * Pure client-state patch: apply the (already server-clamped) AI mapping
 * suggestions onto a `SheetState`, returning a NEW state object so the caller
 * fires `onStateChange` exactly once. Every field is defensively clamped again
 * here so a malformed suggestion can never corrupt the wizard:
 *
 * - an unknown `kind` keeps the column's prior kind;
 * - a `role` outside {name,data} falls back to "data";
 * - an out-of-range `sourceIndex` is ignored (no matching column);
 * - a `targetColumnId` not present in `boardColumns` resolves to "create".
 *
 * `boardColumns` is only supplied in existing-board mode; without it the
 * column `target` is left untouched (new-board mode has no merge targets).
 */
export function applyMappingSuggestions(
  state: SheetState,
  suggestions: MappingSuggestion[],
  boardColumns?: { id: string }[],
): SheetState {
  const byIndex = new Map<number, MappingSuggestion>();
  for (const s of suggestions ?? []) {
    if (typeof s?.sourceIndex === "number") byIndex.set(s.sourceIndex, s);
  }
  const boardColIds = new Set((boardColumns ?? []).map((c) => c.id));

  const columns: ColumnState[] = state.columns.map((column) => {
    const s = byIndex.get(column.sourceIndex);
    if (!s) return column;

    const suggestedKind: ImportableKind = IMPORTABLE_KIND_SET.has(
      s.kind as string,
    )
      ? s.kind
      : column.kind;
    const role: ColumnRole = s.role === "name" ? "name" : "data";

    // Grouping is never originated here; a "name" column is structural (kind
    // "text", no merge target) — mirror deriveSheetState's name-column shape.
    if (role === "name") {
      return {
        ...column,
        role,
        kind: "text",
        detectedKind: suggestedKind,
        target: null,
      };
    }

    let target: ColumnTarget | null = column.target;
    if (boardColumns) {
      target =
        s.targetColumnId && boardColIds.has(s.targetColumnId)
          ? { columnId: s.targetColumnId }
          : "create";
    }

    return {
      ...column,
      role,
      kind: suggestedKind,
      detectedKind: suggestedKind,
      target,
    };
  });

  return { ...state, columns };
}
