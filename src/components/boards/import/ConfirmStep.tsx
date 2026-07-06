"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cellToText, textToCell } from "@/lib/boards/spreadsheet/cell-codec";
import {
  summarize,
  type ColumnState,
  type SheetState,
} from "@/components/boards/import/import-wizard-state";
import type { ParsedTable, SynthOption } from "@/lib/boards/spreadsheet/types";

/** Only the first N rows are rendered in the confirm preview grid. */
const MAX_PREVIEW_ROWS = 50;

export type ConfirmStepProps = {
  table: ParsedTable;
  state: SheetState;
  /** The sheet's TRUE total grid row count from the server parse. The commit
   * re-parses the full file, so this — not the previewed slice — is what
   * gets imported. */
  rowCount: number;
  /** How many grid rows the preview actually carries (the server slices to
   * PREVIEW_GRID_ROWS). When `rowCount` exceeds this, the summary counts
   * above only reflect the slice and a caveat line is rendered. */
  previewedRowCount: number;
  destination:
    | {
        type: "new";
        boardName: string;
        onBoardNameChange: (v: string) => void;
      }
    | { type: "existing" };
  error: string | null;
};

/** The one sanctioned place option color appears: a small dot next to the label. */
function OptionPill({ option }: { option: SynthOption }) {
  return (
    <span className="bg-surface-muted inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-0.5 text-xs">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: option.color }}
      />
      {option.label}
    </span>
  );
}

/** One preview-grid cell: parses the raw string under the column's kind and
 * renders a typed representation, or the raw text with a warning tint when
 * it fails to parse. */
function ConfirmCell({ column, raw }: { column: ColumnState; raw: string }) {
  if (raw.trim() === "") return null;

  const value = textToCell(column.kind, raw, column.options);

  if (value === null) {
    return (
      <span
        className="text-status-yellow"
        title={`Can't parse as ${column.kind} — will import empty`}
      >
        {raw}
      </span>
    );
  }

  if (column.kind === "checkbox") {
    const checked = (value as { checked: boolean }).checked;
    return <span>{checked ? "✓" : "—"}</span>;
  }

  if (column.kind === "status") {
    const optionId = (value as { optionId: string }).optionId;
    const option = column.options.find((o) => o.id === optionId);
    return option ? <OptionPill option={option} /> : null;
  }

  if (column.kind === "dropdown") {
    const optionIds = (value as { optionIds: string[] }).optionIds;
    const options = optionIds
      .map((id) => column.options.find((o) => o.id === id))
      .filter((o): o is SynthOption => o != null);
    return (
      <span className="flex flex-wrap gap-1">
        {options.map((o) => (
          <OptionPill key={o.id} option={o} />
        ))}
      </span>
    );
  }

  return <>{cellToText(column.kind, value, { options: column.options })}</>;
}

export function ConfirmStep({
  table,
  state,
  rowCount,
  previewedRowCount,
  destination,
  error,
}: ConfirmStepProps) {
  const summary = summarize(table, state);
  // The preview grid is a server-side slice; when the sheet is bigger than
  // the slice, the counts above undercount what the commit will import.
  const previewTruncated = rowCount > previewedRowCount;

  const dataColumns = state.columns.filter(
    (c) => c.include && c.role === "data" && c.target !== "skip",
  );
  const previewRows = table.rows.slice(0, MAX_PREVIEW_ROWS);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {summary.items} items · {summary.subitems} subtasks · {summary.groups}{" "}
        groups · {summary.columns} columns · {summary.invalid} invalid cells →
        empty
      </p>

      {previewTruncated ? (
        <p className="border-status-yellow/40 bg-status-yellow/10 text-foreground rounded-md border px-3 py-2 text-xs">
          These counts reflect only the first {previewedRowCount} previewed rows
          — the import itself reads the whole sheet, so all {rowCount} rows will
          be imported.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-muted border-b">
              {dataColumns.map((col) => (
                <th
                  key={col.sourceIndex}
                  className="px-3 py-2 text-left font-medium"
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={table.rowIndices[i]} className="border-b last:border-0">
                {dataColumns.map((col) => (
                  <td key={col.sourceIndex} className="px-3 py-2">
                    <ConfirmCell
                      column={col}
                      raw={row[col.sourceIndex] ?? ""}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {destination.type === "new" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-board-name">Board name</Label>
          <Input
            id="import-board-name"
            value={destination.boardName}
            onChange={(e) => destination.onBoardNameChange(e.target.value)}
            placeholder="My board"
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
