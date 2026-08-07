import type {
  ParsedTable,
  ColumnSpec,
  ImportFormat,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import { textToCell } from "./cell-codec";
import type { TemplatePayload } from "@/lib/boards/template-payload";
import type { Json } from "@/types/database.types";
import { GROUP_COLORS } from "@/lib/boards/group-colors";

export type SubitemSeed = {
  id: string;
  parentId: string;
  groupId: string;
  name: string;
  position: number;
  cells: { columnId: string; value: Json }[];
};

export type ImportPayload = {
  templatePayload: TemplatePayload;
  subitems: SubitemSeed[];
};

export type ResolvedItem = {
  groupKey: string;
  name: string;
  row: string[];
  position: number;
};

export type ResolvedSubitem = {
  parentIndex: number; // index into ResolvedStructure.items
  groupKey: string;
  name: string;
  row: string[];
  position: number;
};

export type ResolvedStructure = {
  groups: ImportGroup[];
  items: ResolvedItem[];
  subitems: ResolvedSubitem[];
};

/**
 * Resolve explicit per-row structure into items + subitems. Replaces the
 * old marker-driven row split: item/subitem type and group come from
 * `structure` (keyed by original grid index), not from a `↳` name prefix or a
 * group column. A subitem attaches to the nearest preceding item in the SAME
 * group; an orphan subitem (none exists) is promoted to an item — the client
 * blocks that case, and Task 7's action validates it for a friendly error, so
 * this stays total (never throws). Empty groups are dropped.
 */
export function resolveStructuredRows(
  table: ParsedTable,
  nameIndex: number,
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): ResolvedStructure {
  const byGrid = new Map(structure.map((s) => [s.gridIndex, s]));
  const fallbackKey = groups[0]?.key ?? "";

  const items: ResolvedItem[] = [];
  const subitems: ResolvedSubitem[] = [];
  const lastItemIndexByGroup = new Map<string, number>();

  table.rows.forEach((row, r) => {
    const gridIndex = table.rowIndices[r];
    const entry = byGrid.get(gridIndex);
    const groupKey = entry?.groupKey ?? fallbackKey;
    const type = entry?.type ?? "item";
    const name = (row[nameIndex] ?? "").trim();

    const parentIndex = lastItemIndexByGroup.get(groupKey);
    if (type === "subitem" && parentIndex !== undefined) {
      subitems.push({
        parentIndex,
        groupKey,
        name,
        row,
        position: subitems.length,
      });
      return;
    }
    lastItemIndexByGroup.set(groupKey, items.length);
    items.push({ groupKey, name, row, position: items.length });
  });

  const usedKeys = new Set(items.map((i) => i.groupKey));
  return {
    groups: groups.filter((g) => usedKeys.has(g.key)),
    items,
    subitems,
  };
}

export function buildImportPayloadV3(
  table: ParsedTable,
  specs: ColumnSpec[],
  groups: ImportGroup[],
  structure: RowStructureEntry[],
  /** The uploaded file's format — scopes the CSV formula-guard undo in
   *  `textToCell`'s "text" case to CSV imports only (see cell-codec.ts).
   *  Defaults to "csv" (prior behavior) for the handful of test callers that
   *  don't care about the guard either way. */
  format: ImportFormat = "csv",
): ImportPayload {
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

  // New board => every group is freshly minted.
  const groupIdByKey = new Map(
    resolved.groups.map((g) => [g.key, crypto.randomUUID()] as const),
  );
  const columnIds = dataSpecs.map(() => crypto.randomUUID());
  const itemIds = resolved.items.map(() => crypto.randomUUID());

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    dataSpecs.forEach((spec, i) => {
      const value = textToCell(
        spec.kind,
        row[spec.sourceIndex] ?? "",
        spec.options,
        format,
      );
      if (value !== null) cells.push({ columnId: columnIds[i], value });
    });
    return cells;
  };

  return {
    templatePayload: {
      groups: resolved.groups.map((g, i) => ({
        id: groupIdByKey.get(g.key)!,
        name: g.name,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        position: i,
      })),
      columns: dataSpecs.map((spec, i) => ({
        id: columnIds[i],
        kind: spec.kind,
        name: spec.name,
        settings:
          spec.options.length > 0
            ? ({ options: spec.options } as Json)
            : ({} as Json),
        position: i,
      })),
      items: resolved.items.map((item, i) => ({
        id: itemIds[i],
        groupId: groupIdByKey.get(item.groupKey)!,
        name: item.name,
        position: i,
        cells: buildCells(item.row),
      })),
    },
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
