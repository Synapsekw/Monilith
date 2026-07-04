import type {
  ParsedSheet,
  ColumnMapping,
  ParsedTable,
  ColumnSpec,
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
