import type {
  ParsedTable,
  ColumnSpec,
  SynthOption,
  ImportableKind,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import { IMPORTABLE_KINDS } from "./types";
import { resolveStructuredRows } from "./build-import-payload";
import { textToCell } from "./cell-codec";
import { missingOptionLabels, type BoardColumnRef } from "./match-columns";
import { nextOptionColor } from "@/lib/boards/option-colors";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
import type { Json } from "@/types/database.types";

export type AppendPayload = {
  groups: {
    id: string; // existing group's id, OR a freshly-minted uuid
    existingGroupId: string | null; // null => create; set => reuse (== id)
    name: string;
    color: string;
    position: number;
  }[];
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
    groupId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
  subitems: {
    id: string;
    parentId: string;
    groupId: string;
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
 * sheet into an EXISTING board across one or more target groups. Each of
 * `groups` is either a reused board group (`existingGroupId` set — the
 * payload group's `id` equals it, so items referencing that `id` resolve to
 * the real board group) or a freshly-minted group (`existingGroupId: null`).
 * Row-to-group and item/subitem structure come from `structure` via
 * `resolveStructuredRows` (Task 1) — not from a `↳` name prefix or a group
 * column.
 *
 * Every data column resolves against either an existing board column
 * (`target: {columnId}` — encoded with the TARGET column's kind + merged
 * options) or a freshly minted one (`target: "create"`, or no target at
 * all — treated the same as "create"; the calling action's Zod validation
 * requires an explicit target for existing destinations, so `undefined`
 * reaching here is a defensive fallback, not the expected path). `target:
 * "skip"` drops the column. `role: "group"` specs are not supported here —
 * grouping is driven entirely by `groups`/`structure`.
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
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): AppendPayload {
  const nameSpec = specs.find((s) => s.role === "name");
  if (!nameSpec) throw new Error("no name column");

  const dataSpecs = specs.filter(
    (s) => s.role === "data" && s.target !== "skip",
  );

  const resolved = resolveStructuredRows(
    table,
    nameSpec.sourceIndex,
    groups,
    structure,
  );

  // Existing group => reuse its id; new group => mint one. Items reference
  // groupId == this id in both cases (the RPC creates new ones, validates
  // reused ones).
  const groupIdByKey = new Map(
    resolved.groups.map(
      (g) => [g.key, g.existingGroupId ?? crypto.randomUUID()] as const,
    ),
  );

  const boardColumnsById = new Map(boardColumns.map((c) => [c.id, c]));

  type Resolved = {
    columnId: string;
    kind: ImportableKind;
    options: SynthOption[];
    sourceIndex: number;
  };
  const newColumns: AppendPayload["newColumns"] = [];
  const optionAdditions: AppendPayload["optionAdditions"] = [];
  const resolvedCols: Resolved[] = [];

  let newColumnPosition = 0;
  for (const spec of dataSpecs) {
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
      resolvedCols.push({
        columnId: id,
        kind: spec.kind,
        options: spec.options,
        sourceIndex: spec.sourceIndex,
      });
      continue;
    }
    if (target === "skip") continue;
    const boardColumn = boardColumnsById.get(target.columnId);
    if (!boardColumn) throw new Error("unknown target column");
    if (!isImportableKind(boardColumn.kind))
      throw new Error("incompatible column kind");
    const targetKind = boardColumn.kind;

    let mergedOptions = boardColumn.options;
    if (targetKind === "status" || targetKind === "dropdown") {
      const rawValues = [
        ...resolved.items.map((it) => it.row[spec.sourceIndex] ?? ""),
        ...resolved.subitems.map((s) => s.row[spec.sourceIndex] ?? ""),
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
    resolvedCols.push({
      columnId: boardColumn.id,
      kind: targetKind,
      options: mergedOptions,
      sourceIndex: spec.sourceIndex,
    });
  }

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    for (const r of resolvedCols) {
      const value = textToCell(r.kind, row[r.sourceIndex] ?? "", r.options);
      if (value !== null) cells.push({ columnId: r.columnId, value });
    }
    return cells;
  };

  const itemIds = resolved.items.map(() => crypto.randomUUID());

  return {
    groups: resolved.groups.map((g, i) => ({
      id: groupIdByKey.get(g.key)!,
      existingGroupId: g.existingGroupId,
      name: g.name,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      position: i,
    })),
    newColumns,
    optionAdditions,
    items: resolved.items.map((item, i) => ({
      id: itemIds[i],
      groupId: groupIdByKey.get(item.groupKey)!,
      name: item.name,
      position: i,
      cells: buildCells(item.row),
    })),
    subitems: resolved.subitems.map((sub, i) => ({
      id: crypto.randomUUID(),
      parentId: itemIds[sub.parentIndex],
      groupId: groupIdByKey.get(sub.groupKey)!,
      name: sub.name,
      position: i,
      cells: buildCells(sub.row),
    })),
  };
}
