import { selectRows } from "@/lib/boards/spreadsheet/select-rows";
import {
  detectAllColumns,
  proposeRoles,
} from "@/lib/boards/spreadsheet/detect";
import { textToCell } from "@/lib/boards/spreadsheet/cell-codec";
import {
  autoMatchColumns,
  type BoardColumnRef,
} from "@/lib/boards/spreadsheet/match-columns";
import {
  SUBTASK_MARKER,
  type ParsedTable,
  type ColumnSpec,
  type ColumnRole,
  type ColumnTarget,
  type ImportableKind,
  type SynthOption,
  type ImportGroup,
  type RowStructureEntry,
} from "@/lib/boards/spreadsheet/types";

/**
 * Pure client-state layer for the 3-step import wizard. No React, no server
 * imports — this module is a straight composition of the spreadsheet libs
 * (`selectRows`, `detectAllColumns`/`proposeRoles`,
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
  /** Target groups for the Structure step (ordered). Empty until seeded. */
  groups: ImportGroup[];
  /** Per-row structure keyed by grid row index. Empty until seeded. */
  structure: Record<number, { groupKey: string; type: "item" | "subitem" }>;
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
 * `boardColumns` is optional and only passed for the existing-board wizard
 * mode. When present:
 * - the proposed "group" role is never assigned — existing boards append
 *   every row into ONE chosen group (picked in the confirm step), so the
 *   column that would otherwise be treated as "group" is demoted to a
 *   regular "data" column instead.
 * - every "data" column gets its `target` auto-filled via
 *   `autoMatchColumns`: a name+kind match on `boardColumns` resolves to
 *   `{ columnId }`, otherwise it defaults to `"create"`.
 *
 * Throws whatever `selectRows` throws (an `Error("empty")` for an empty
 * sheet) — that's passed straight through to the caller.
 */
export function deriveSheetState(
  grid: string[][],
  headerRow: number | null,
  boardColumns?: BoardColumnRef[],
): SheetState {
  const table = selectRows(grid, headerRow, []);
  const { nameIndex } = proposeRoles(table.header);

  const detectionRows = table.rows.filter(
    (row) => !(row[nameIndex] ?? "").trim().startsWith(SUBTASK_MARKER),
  );
  const detected = detectAllColumns(table.header, detectionRows);

  const matches = boardColumns
    ? autoMatchColumns(
        table.header.map((name, i) => ({ name, kind: detected[i].kind })),
        boardColumns,
      )
    : null;

  const columns: ColumnState[] = table.header.map((name, sourceIndex) => {
    // Grouping is owned by the Structure step, never a column role — the
    // commit schema rejects role:"group", and a "Group"-headed column (exactly
    // what the board export emits) must round-trip cleanly. So collapse to
    // name-or-data and never originate the vestigial "group" role here.
    const role: ColumnRole = sourceIndex === nameIndex ? "name" : "data";
    const detectedKind = detected[sourceIndex].kind;
    const kind: ImportableKind = role === "data" ? detectedKind : "text";

    const target: ColumnTarget | null =
      boardColumns && role === "data"
        ? matches![sourceIndex]
          ? { columnId: matches![sourceIndex] as string }
          : "create"
        : null;

    return {
      sourceIndex,
      include: true,
      name,
      kind,
      options: detected[sourceIndex].options,
      role,
      detectedKind,
      target,
    };
  });

  return { headerRow, excluded: [], columns, groups: [], structure: {} };
}

/**
 * Like `deriveSheetState`, but a blank sheet (where `selectRows` throws
 * `Error("empty")`) yields a zero-column sentinel state instead of throwing —
 * `parseWorkbookSheets` keeps empty worksheets in the preview, and switching
 * to one must not crash the wizard. Detect the sentinel with
 * `isEmptySheetState` and render an inline "no data" message instead of the
 * mapping grid (`tableFor` on it would throw the same `"empty"`).
 */
export function deriveSheetStateSafe(
  grid: string[][],
  headerRow: number | null,
  boardColumns?: BoardColumnRef[],
): SheetState {
  try {
    return deriveSheetState(grid, headerRow, boardColumns);
  } catch (err) {
    if (err instanceof Error && err.message === "empty") {
      return {
        headerRow: null,
        excluded: [],
        columns: [],
        groups: [],
        structure: {},
      };
    }
    throw err;
  }
}

/** True for the sentinel state `deriveSheetStateSafe` mints for a blank
 * sheet. A non-empty grid always yields at least one header column, so
 * zero columns ⇔ empty sheet. */
export function isEmptySheetState(state: SheetState): boolean {
  return state.columns.length === 0;
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
  groups: number;
  columns: number;
  invalid: number;
} {
  const orphans = new Set(orphanGridIndices(table, state));
  let items = 0;
  let subitems = 0;
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    const s = state.structure[gridIndex];
    if (s?.type === "subitem" && !orphans.has(gridIndex)) subitems += 1;
    else items += 1;
  }

  const dataColumns = state.columns.filter(
    (c) => c.include && c.role === "data" && c.target !== "skip",
  );
  const invalid = invalidCellMap(table, state.columns);
  const invalidCount = [...invalid.values()].reduce(
    (sum, o) => sum + o.length,
    0,
  );

  return {
    items,
    subitems,
    columns: dataColumns.length,
    groups: buildCommitGroups(state).length,
    invalid: invalidCount,
  };
}

/**
 * Seed the structure model from a freshly-parsed table: one default group
 * (either a brand-new "Imported" group, or the board's first existing group
 * in "existing" mode) with every non-excluded row assigned to it as an
 * "item". Idempotent — a sheet that's already been organized (groups.length
 * > 0) is returned unchanged, so re-deriving the table (e.g. after toggling
 * the header row) doesn't clobber the user's structure choices.
 */
export function seedStructure(
  state: SheetState,
  table: ParsedTable,
  mode: "new" | "existing",
  existingGroups: { id: string; name: string }[],
): SheetState {
  // Idempotent: don't reseed if the user already organized this sheet.
  if (state.groups.length > 0) return state;

  const first: ImportGroup =
    mode === "existing" && existingGroups[0]
      ? {
          key: crypto.randomUUID(),
          name: existingGroups[0].name,
          existingGroupId: existingGroups[0].id,
        }
      : { key: crypto.randomUUID(), name: "Imported", existingGroupId: null };

  const structure: SheetState["structure"] = {};
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    structure[gridIndex] = { groupKey: first.key, type: "item" };
  }

  return { ...state, groups: [first], structure };
}

/** Append a new editable group (not tied to any existing board group). */
export function addGroup(state: SheetState): SheetState {
  const next: ImportGroup = {
    key: crypto.randomUUID(),
    name: `Group ${state.groups.length + 1}`,
    existingGroupId: null,
  };
  return { ...state, groups: [...state.groups, next] };
}

/** Rename a group in place, identified by its stable `key`. */
export function renameGroup(
  state: SheetState,
  key: string,
  name: string,
): SheetState {
  return {
    ...state,
    groups: state.groups.map((g) => (g.key === key ? { ...g, name } : g)),
  };
}

/** Reference an existing board group in the group list, adding it if absent.
 * Returns the (possibly new) group's key so a caller can immediately assign
 * rows to it. */
export function referenceExistingGroup(
  state: SheetState,
  existing: { id: string; name: string },
): { state: SheetState; key: string } {
  const found = state.groups.find((g) => g.existingGroupId === existing.id);
  if (found) return { state, key: found.key };
  const g: ImportGroup = {
    key: crypto.randomUUID(),
    name: existing.name,
    existingGroupId: existing.id,
  };
  return { state: { ...state, groups: [...state.groups, g] }, key: g.key };
}

function patchRows(
  state: SheetState,
  gridIndices: number[],
  patch: Partial<{ groupKey: string; type: "item" | "subitem" }>,
): SheetState {
  const structure = { ...state.structure };
  const fallbackKey = state.groups[0]?.key ?? "";
  for (const gi of gridIndices) {
    const cur = structure[gi] ?? { groupKey: fallbackKey, type: "item" };
    structure[gi] = { ...cur, ...patch };
  }
  return { ...state, structure };
}

/** Bulk-set the item/subitem type for the given grid rows only. */
export function bulkSetType(
  state: SheetState,
  gridIndices: number[],
  type: "item" | "subitem",
): SheetState {
  return patchRows(state, gridIndices, { type });
}

/** Bulk-assign the given grid rows to a group only. */
export function bulkSetGroup(
  state: SheetState,
  gridIndices: number[],
  groupKey: string,
): SheetState {
  return patchRows(state, gridIndices, { groupKey });
}

/** Grid indices of subitem rows that have no item above them in their group
 * (source order) — these block the Structure step. */
export function orphanGridIndices(
  table: ParsedTable,
  state: SheetState,
): number[] {
  const fallbackKey = state.groups[0]?.key ?? "";
  const seenItemInGroup = new Set<string>();
  const orphans: number[] = [];
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    const s = state.structure[gridIndex] ?? {
      groupKey: fallbackKey,
      type: "item" as const,
    };
    if (s.type === "subitem") {
      if (!seenItemInGroup.has(s.groupKey)) orphans.push(gridIndex);
    } else {
      seenItemInGroup.add(s.groupKey);
    }
  }
  return orphans;
}

/** Groups that actually hold ≥1 row, in list order — the commit's `groups`. */
export function buildCommitGroups(state: SheetState): ImportGroup[] {
  const usedKeys = new Set(
    Object.values(state.structure).map((s) => s.groupKey),
  );
  return state.groups.filter((g) => usedKeys.has(g.key));
}

/** One structure entry per non-excluded grid row (defaults applied). */
export function buildCommitStructure(
  table: ParsedTable,
  state: SheetState,
): RowStructureEntry[] {
  const fallbackKey = state.groups[0]?.key ?? "";
  const out: RowStructureEntry[] = [];
  for (const gridIndex of table.rowIndices) {
    if (state.excluded.includes(gridIndex)) continue;
    const s = state.structure[gridIndex] ?? {
      groupKey: fallbackKey,
      type: "item" as const,
    };
    out.push({ gridIndex, groupKey: s.groupKey, type: s.type });
  }
  return out;
}
