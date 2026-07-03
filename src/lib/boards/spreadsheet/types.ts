export const SUBTASK_MARKER = "↳ ";
export const GROUP_HEADER = "Group";
export const NAME_HEADER = "Name";
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const MAX_COLS = 40;
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
export type ImportPreview = {
  boardName: string;
  columns: DetectedColumn[];
  rowCount: number;
  sampleRows: string[][];
  droppedSheets: string[];
};
