import { selectRows } from "@/lib/boards/spreadsheet/select-rows";
import {
  detectAllColumns,
  proposeRoles,
} from "@/lib/boards/spreadsheet/detect";
import { splitRows2 } from "@/lib/boards/spreadsheet/build-import-payload";
import { textToCell } from "@/lib/boards/spreadsheet/cell-codec";
import {
  SUBTASK_MARKER,
  type ParsedTable,
  type ColumnSpec,
  type ColumnRole,
  type ColumnTarget,
  type ImportableKind,
  type SynthOption,
} from "@/lib/boards/spreadsheet/types";

/**
 * Pure client-state layer for the 3-step import wizard. No React, no server
 * imports — this module is a straight composition of the spreadsheet libs
 * (`selectRows`, `detectAllColumns`/`proposeRoles`, `splitRows2`,
 * `textToCell`) into the shape the wizard's step components consume.
 */

export type ColumnState = {
  sourceIndex: number;
  include: boolean;
  name: string;
  kind: ImportableKind;
  options: SynthOption[];
  role: ColumnRole;
  /** Frozen detection result, restored when a role demotes back to "data". */
  detectedKind: ImportableKind;
  /** Stays null in new-board mode (M2 fills it for existing-board mode). */
  target: ColumnTarget | null;
};

export type SheetState = {
  headerRow: number | null;
  excluded: number[];
  columns: ColumnState[];
};

/**
 * Derive the initial wizard state from a raw grid: select the data rows,
 * detect a kind per column, propose the name/group structural roles, and
 * build one `ColumnState` per header column.
 *
 * Kind detection samples only top-level rows (rows whose proposed name cell
 * doesn't carry the subtask marker) so an occasional malformed subtask value
 * (e.g. a non-numeric estimate on a "↳ " row) doesn't drag the whole column's
 * inferred kind down to "text" — those rows still get flagged later via
 * `invalidCellMap` once the column kind is fixed.
 *
 * Throws whatever `selectRows` throws (an `Error("empty")` for an empty
 * sheet) — that's passed straight through to the caller.
 */
export function deriveSheetState(
  grid: string[][],
  headerRow: number | null,
): SheetState {
  const table = selectRows(grid, headerRow, []);
  const { nameIndex, groupIndex } = proposeRoles(table.header);

  const detectionRows = table.rows.filter(
    (row) => !(row[nameIndex] ?? "").trim().startsWith(SUBTASK_MARKER),
  );
  const detected = detectAllColumns(table.header, detectionRows);

  const columns: ColumnState[] = table.header.map((name, sourceIndex) => {
    const role: ColumnRole =
      sourceIndex === nameIndex
        ? "name"
        : sourceIndex === groupIndex
          ? "group"
          : "data";
    const detectedKind = detected[sourceIndex].kind;
    const kind: ImportableKind = role === "data" ? detectedKind : "text";

    return {
      sourceIndex,
      include: true,
      name,
      kind,
      options: detected[sourceIndex].options,
      role,
      detectedKind,
      target: null,
    };
  });

  return { headerRow, excluded: [], columns };
}

/** Re-run row selection against the current header/exclusion state. */
export function tableFor(grid: string[][], state: SheetState): ParsedTable {
  return selectRows(grid, state.headerRow, state.excluded);
}

/**
 * Map original grid row index → sorted offending source column indexes,
 * for included "data" columns (not skipped) whose raw cell is non-empty but
 * fails to parse under the column's current kind.
 */
export function invalidCellMap(
  table: ParsedTable,
  columns: ColumnState[],
): Map<number, number[]> {
  const dataColumns = columns.filter(
    (c) => c.include && c.role === "data" && c.target !== "skip",
  );

  const map = new Map<number, number[]>();
  table.rows.forEach((row, rowPos) => {
    const offending: number[] = [];
    for (const col of dataColumns) {
      const raw = row[col.sourceIndex] ?? "";
      if (raw.trim() === "") continue;
      if (textToCell(col.kind, raw, col.options) === null) {
        offending.push(col.sourceIndex);
      }
    }
    if (offending.length > 0) {
      offending.sort((a, b) => a - b);
      map.set(table.rowIndices[rowPos], offending);
    }
  });

  return map;
}

/**
 * Included columns only, shaped as `ColumnSpec`s for the commit step.
 * Options are only meaningful (and kept) for "status"/"dropdown" kinds.
 */
export function buildCommitColumns(state: SheetState): ColumnSpec[] {
  return state.columns
    .filter((c) => c.include)
    .map((c) => ({
      sourceIndex: c.sourceIndex,
      name: c.name,
      kind: c.kind,
      options: c.kind === "status" || c.kind === "dropdown" ? c.options : [],
      role: c.role,
      target: c.target ?? undefined,
    }));
}

/** Summary counters shown throughout the wizard. */
export function summarize(
  table: ParsedTable,
  state: SheetState,
): {
  items: number;
  subitems: number;
  columns: number;
  invalid: number;
} {
  const nameCol = state.columns.find((c) => c.role === "name");
  const groupCol = state.columns.find((c) => c.role === "group") ?? null;

  const split = nameCol
    ? splitRows2(table.rows, nameCol.sourceIndex, groupCol?.sourceIndex ?? null)
    : { groups: [], items: [], subitems: [] };

  const dataColumns = state.columns.filter(
    (c) => c.include && c.role === "data" && c.target !== "skip",
  );

  const invalid = invalidCellMap(table, state.columns);
  const invalidCount = [...invalid.values()].reduce(
    (sum, offenders) => sum + offenders.length,
    0,
  );

  return {
    items: split.items.length,
    subitems: split.subitems.length,
    columns: dataColumns.length,
    invalid: invalidCount,
  };
}
