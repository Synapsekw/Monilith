import type {
  ParsedSheet,
  ColumnMapping,
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import { SUBTASK_MARKER } from "./types";
import { textToCell } from "./cell-codec";
import { splitRows } from "./detect";
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

export function buildImportPayload(
  parsed: ParsedSheet,
  mappings: ColumnMapping[],
): ImportPayload {
  const { groups, items, subitems, dataHeaders } = splitRows(
    parsed.header,
    parsed.rows,
  );

  // Mint one uuid per group
  const groupIds: string[] = groups.map(() => crypto.randomUUID());

  // Mint one uuid per data column (aligned to mappings/dataHeaders)
  const columnIds: string[] = dataHeaders.map(() => crypto.randomUUID());

  // Mint one uuid per top-level item
  const itemIds: string[] = items.map(() => crypto.randomUUID());

  // Mint one uuid per subitem
  const subitemIds: string[] = subitems.map(() => crypto.randomUUID());

  // Build templatePayload.groups
  const templateGroups: TemplatePayload["groups"] = groups.map((name, i) => ({
    id: groupIds[i],
    name,
    color: GROUP_COLORS[i % GROUP_COLORS.length],
    position: i,
  }));

  // Build templatePayload.columns
  const templateColumns: TemplatePayload["columns"] = mappings.map(
    (mapping, i) => ({
      id: columnIds[i],
      kind: mapping.kind,
      name: mapping.header,
      settings:
        mapping.options.length > 0
          ? ({ options: mapping.options } as Json)
          : ({} as Json),
      position: i,
    }),
  );

  // Helper: build cells for a row's cell array (aligned to dataHeaders/mappings)
  function buildCells(cells: string[]): { columnId: string; value: Json }[] {
    const result: { columnId: string; value: Json }[] = [];
    for (let i = 0; i < mappings.length; i++) {
      const rawValue = cells[i] ?? "";
      const value = textToCell(mappings[i].kind, rawValue, mappings[i].options);
      if (value !== null) {
        result.push({ columnId: columnIds[i], value });
      }
    }
    return result;
  }

  // Build templatePayload.items (top-level)
  const templateItems: TemplatePayload["items"] = items.map((item, i) => {
    const groupIdx = groups.indexOf(item.group);
    return {
      id: itemIds[i],
      groupId: groupIds[groupIdx],
      name: item.name,
      position: i,
      cells: buildCells(item.cells),
    };
  });

  // Build subitems
  const subitemSeeds: SubitemSeed[] = subitems.map((sub, i) => {
    const parentItem = items[sub.parentIndex];
    const parentGroupIdx = groups.indexOf(parentItem.group);
    return {
      id: subitemIds[i],
      parentId: itemIds[sub.parentIndex],
      groupId: groupIds[parentGroupIdx],
      name: sub.name,
      position: i,
      cells: buildCells(sub.cells),
    };
  });

  return {
    templatePayload: {
      groups: templateGroups,
      columns: templateColumns,
      items: templateItems,
    },
    subitems: subitemSeeds,
  };
}

export type Split2 = {
  groups: string[];
  items: { group: string; name: string; row: string[] }[];
  subitems: { parentIndex: number; name: string; row: string[] }[];
};

export function splitRows2(
  rows: string[][],
  nameIndex: number,
  groupIndex: number | null,
): Split2 {
  const groups: string[] = [];
  const items: Split2["items"] = [];
  const subitems: Split2["subitems"] = [];
  const lastItemIndexByGroup = new Map<string, number>();

  for (const row of rows) {
    const group =
      groupIndex !== null
        ? (row[groupIndex] ?? "").trim() || "Imported"
        : "Imported";
    const rawName = (row[nameIndex] ?? "").trim();
    const isSubtask = rawName.startsWith(SUBTASK_MARKER);

    if (isSubtask && lastItemIndexByGroup.has(group)) {
      subitems.push({
        parentIndex: lastItemIndexByGroup.get(group)!,
        name: rawName.slice(SUBTASK_MARKER.length),
        row,
      });
    } else {
      if (!groups.includes(group)) groups.push(group);
      const name = isSubtask ? rawName.slice(SUBTASK_MARKER.length) : rawName;
      lastItemIndexByGroup.set(group, items.length);
      items.push({ group, name, row });
    }
  }
  return { groups, items, subitems };
}

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
 * marker-driven `splitRows2`: item/subitem type and group come from
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

export function buildImportPayloadV2(
  table: ParsedTable,
  specs: ColumnSpec[],
): ImportPayload {
  const nameSpec = specs.find((s) => s.role === "name");
  if (!nameSpec) throw new Error("no name column");
  const groupSpec = specs.find((s) => s.role === "group") ?? null;
  const dataSpecs = specs.filter(
    (s) => s.role === "data" && s.target !== "skip",
  );

  const split = splitRows2(
    table.rows,
    nameSpec.sourceIndex,
    groupSpec?.sourceIndex ?? null,
  );

  const groupIds = split.groups.map(() => crypto.randomUUID());
  const columnIds = dataSpecs.map(() => crypto.randomUUID());
  const itemIds = split.items.map(() => crypto.randomUUID());

  const buildCells = (row: string[]) => {
    const cells: { columnId: string; value: Json }[] = [];
    dataSpecs.forEach((spec, i) => {
      const value = textToCell(
        spec.kind,
        row[spec.sourceIndex] ?? "",
        spec.options,
      );
      if (value !== null) cells.push({ columnId: columnIds[i], value });
    });
    return cells;
  };

  return {
    templatePayload: {
      groups: split.groups.map((name, i) => ({
        id: groupIds[i],
        name,
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
      items: split.items.map((item, i) => ({
        id: itemIds[i],
        groupId: groupIds[split.groups.indexOf(item.group)],
        name: item.name,
        position: i,
        cells: buildCells(item.row),
      })),
    },
    subitems: split.subitems.map((sub, i) => ({
      id: crypto.randomUUID(),
      parentId: itemIds[sub.parentIndex],
      groupId:
        groupIds[split.groups.indexOf(split.items[sub.parentIndex].group)],
      name: sub.name,
      position: i,
      cells: buildCells(sub.row),
    })),
  };
}

export function buildImportPayloadV3(
  table: ParsedTable,
  specs: ColumnSpec[],
  groups: ImportGroup[],
  structure: RowStructureEntry[],
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
