import type { ParsedSheet, ColumnMapping } from "./types";
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
