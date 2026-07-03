export const SUBTASK_MARKER = "↳ ";
export const GROUP_HEADER = "Group";
export const NAME_HEADER = "Name";
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const MAX_COLS = 40;
export const PREVIEW_GRID_ROWS = 200;
export type ImportFormat = "xlsx" | "csv";
export type ImportableKind =
  | "text"
  | "numbers"
  | "percent"
  | "currency"
  | "status"
  | "dropdown"
  | "date"
  | "checkbox"
  | "rating"
  | "email"
  | "link"
  | "phone"
  | "priority";
export const IMPORTABLE_KINDS: ImportableKind[] = [
  "text",
  "numbers",
  "percent",
  "currency",
  "status",
  "dropdown",
  "date",
  "checkbox",
  "rating",
  "email",
  "link",
  "phone",
  "priority",
];
export type SynthOption = { id: string; label: string; color: string };
export type DetectedColumn = {
  header: string;
  kind: ImportableKind;
  options: SynthOption[];
  sampleValues: string[];
};
export type ColumnMapping = {
  header: string;
  kind: ImportableKind;
  options: SynthOption[];
};
export type ParsedSheet = {
  header: string[];
  rows: string[][];
  droppedSheets: string[];
};
export type RawSheet = { name: string; grid: string[][] };
export type SheetPreview = {
  name: string;
  rowCount: number;
  colCount: number;
  grid: string[][];
};
export type ImportPreview = {
  fileName: string;
  boardName: string;
  sheets: SheetPreview[];
};
export type ParsedTable = {
  header: string[];
  rows: string[][];
  rowIndices: number[];
};
export type ColumnRole = "name" | "group" | "data";
export type ColumnTarget = { columnId: string } | "create" | "skip";
export type ColumnSpec = {
  sourceIndex: number;
  name: string;
  kind: ImportableKind;
  options: SynthOption[];
  role: ColumnRole;
  target?: ColumnTarget;
};
export type ImportDestination =
  | { type: "new"; workspaceId: string; boardName: string }
  | {
      type: "existing";
      boardId: string;
      group: { groupId: string } | { newGroupName: string };
    };
