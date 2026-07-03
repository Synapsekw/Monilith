import type {
  ParsedTable,
  ColumnSpec,
  SynthOption,
  ImportableKind,
} from "./types";
import { IMPORTABLE_KINDS } from "./types";
import { splitRows2 } from "./build-import-payload";
import { textToCell } from "./cell-codec";
import { missingOptionLabels, type BoardColumnRef } from "./match-columns";
import { nextOptionColor } from "@/lib/boards/option-colors";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
import type { Json } from "@/types/database.types";

export type AppendPayload = {
  newGroup?: { id: string; name: string; color: string };
  groupId?: string;
  newColumns: {
    id: string;
    kind: ImportableKind;
    name: string;
    settings: Json;
    position: number;
  }[];
  optionAdditions: { columnId: string; options: SynthOption[] }[];
  items: {
    id: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
  subitems: {
    id: string;
    parentId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
};

/** Kinds a board column may have that are safe to encode text cells against. */
const IMPORTABLE_KIND_SET = new Set<string>(IMPORTABLE_KINDS);

function isImportableKind(kind: string): kind is ImportableKind {
  return IMPORTABLE_KIND_SET.has(kind);
}

/**
 * Build the `import_rows_into_board` RPC payload for appending an imported
 * sheet into an EXISTING board/group. Unlike `buildImportPayloadV2` (which
 * mints a brand-new board), every data column here resolves against either an
 * existing board column (`target: {columnId}` — encoded with the TARGET
 * column's kind + merged options) or a freshly minted one (`target:
 * "create"`, or no target at all — treated the same as "create"; the calling
 * action's Zod validation requires an explicit target for existing
 * destinations, so `undefined` reaching here is a defensive fallback, not the
 * expected path). `target: "skip"` drops the column. `role: "group"` specs
 * are not supported here — the caller rejects them before this is invoked;
 * every row lands in the single `group` the caller resolved.
 *
 * Throws:
 * - "no name column" — no spec has `role: "name"`.
 * - "unknown target column" — a `{columnId}` target isn't in `boardColumns`.
 * - "incompatible column kind" — a mapped target's kind isn't one of
 *   IMPORTABLE_KINDS (e.g. people, files, relation, mirror, time_tracking).
 */
export function buildAppendPayload(
  table: ParsedTable,
  specs: ColumnSpec[],
  boardColumns: BoardColumnRef[],
  group: { groupId: string } | { newGroupName: string },
): AppendPayload {
  const nameSpec = specs.find((s) => s.role === "name");
  if (!nameSpec) throw new Error("no name column");

  const dataSpecs = specs.filter(
    (s) => s.role === "data" && s.target !== "skip",
  );

  // All rows land in one group chosen by the caller, so there is no per-row
  // grouping column here (any file "group" column was demoted client-side).
  const split = splitRows2(table.rows, nameSpec.sourceIndex, null);

  const boardColumnsById = new Map(boardColumns.map((c) => [c.id, c]));

  type Resolved = {
    columnId: string;
    kind: ImportableKind;
    options: SynthOption[];
    sourceIndex: number;
  };

  const newColumns: AppendPayload["newColumns"] = [];
  const optionAdditions: AppendPayload["optionAdditions"] = [];
  const resolved: Resolved[] = [];

  let newColumnPosition = 0;
  for (const spec of dataSpecs) {
    // `target !== "skip"` is guaranteed by the dataSpecs filter above, so the
    // only remaining shapes are undefined | "create" | { columnId }.
    const target = spec.target;

    if (target === undefined || target === "create") {
      const id = crypto.randomUUID();
      newColumns.push({
        id,
        kind: spec.kind,
        name: spec.name,
        settings: (spec.options.length > 0
          ? { options: spec.options }
          : {}) as Json,
        position: newColumnPosition++,
      });
      resolved.push({
        columnId: id,
        kind: spec.kind,
        options: spec.options,
        sourceIndex: spec.sourceIndex,
      });
      continue;
    }

    // target is { columnId: string } here — dataSpecs already filtered out
    // "skip" above, but the .filter predicate doesn't narrow ColumnSpec's
    // type, so guard explicitly for TypeScript's sake.
    if (target === "skip") continue;
    const boardColumn = boardColumnsById.get(target.columnId);
    if (!boardColumn) throw new Error("unknown target column");
    if (!isImportableKind(boardColumn.kind)) {
      throw new Error("incompatible column kind");
    }
    const targetKind = boardColumn.kind;

    let mergedOptions = boardColumn.options;
    if (targetKind === "status" || targetKind === "dropdown") {
      const rawValues = [
        ...split.items.map((item) => item.row[spec.sourceIndex] ?? ""),
        ...split.subitems.map((sub) => sub.row[spec.sourceIndex] ?? ""),
      ];
      const missingLabels = missingOptionLabels(
        rawValues,
        targetKind,
        boardColumn,
      );
      if (missingLabels.length > 0) {
        const minted: SynthOption[] = [];
        for (const label of missingLabels) {
          const usedColors = [
            ...boardColumn.options.map((o) => o.color),
            ...minted.map((o) => o.color),
          ];
          minted.push({
            id: crypto.randomUUID(),
            label,
            color: nextOptionColor(usedColors),
          });
        }
        optionAdditions.push({ columnId: boardColumn.id, options: minted });
        mergedOptions = [...boardColumn.options, ...minted];
      }
    }

    resolved.push({
      columnId: boardColumn.id,
      kind: targetKind,
      options: mergedOptions,
      sourceIndex: spec.sourceIndex,
    });
  }

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    for (const r of resolved) {
      const value = textToCell(r.kind, row[r.sourceIndex] ?? "", r.options);
      if (value !== null) cells.push({ columnId: r.columnId, value });
    }
    return cells;
  };

  const itemIds = split.items.map(() => crypto.randomUUID());

  const items = split.items.map((item, i) => ({
    id: itemIds[i],
    name: item.name,
    position: i,
    cells: buildCells(item.row),
  }));

  const subitems = split.subitems.map((sub, i) => ({
    id: crypto.randomUUID(),
    parentId: itemIds[sub.parentIndex],
    name: sub.name,
    position: i,
    cells: buildCells(sub.row),
  }));

  const payload: AppendPayload = {
    newColumns,
    optionAdditions,
    items,
    subitems,
  };

  if ("newGroupName" in group) {
    payload.newGroup = {
      id: crypto.randomUUID(),
      name: group.newGroupName,
      color: GROUP_COLORS[0],
    };
  } else {
    payload.groupId = group.groupId;
  }

  return payload;
}
