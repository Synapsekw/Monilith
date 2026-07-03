import type { ParsedTable } from "./types";

export function columnLabel(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `Column ${s}`;
}

export function selectRows(
  grid: string[][],
  headerRow: number | null,
  excludedRows: number[],
): ParsedTable {
  const excluded = new Set(excludedRows);
  let header: string[];
  let firstDataRow: number;

  if (headerRow !== null) {
    const raw = grid[headerRow];
    if (!raw) throw new Error("empty");
    let len = raw.length;
    while (len > 0 && raw[len - 1].trim() === "") len--;
    if (len === 0) throw new Error("empty");
    header = raw.slice(0, len);
    firstDataRow = headerRow + 1;
  } else {
    let width = 0;
    for (const row of grid) {
      let len = row.length;
      while (len > 0 && row[len - 1].trim() === "") len--;
      width = Math.max(width, len);
    }
    if (width === 0) throw new Error("empty");
    header = Array.from({ length: width }, (_, i) => columnLabel(i));
    firstDataRow = 0;
  }

  const rows: string[][] = [];
  const rowIndices: number[] = [];
  for (let i = firstDataRow; i < grid.length; i++) {
    if (excluded.has(i)) continue;
    const raw = grid[i] ?? [];
    const row = Array.from({ length: header.length }, (_, c) => raw[c] ?? "");
    if (row.every((cell) => cell.trim() === "")) continue;
    rows.push(row);
    rowIndices.push(i);
  }
  return { header, rows, rowIndices };
}
