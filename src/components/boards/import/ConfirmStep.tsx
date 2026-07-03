"use client";

import { Button } from "@/components/ui/button";
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

/** Sentinel `<option>` value standing in for "create a new group". */
const NEW_GROUP_VALUE = "__new__";

export type ConfirmStepProps = {
  table: ParsedTable;
  state: SheetState;
  destination:
    | {
        type: "new";
        boardName: string;
        onBoardNameChange: (v: string) => void;
      }
    | {
        type: "existing";
        groups: { id: string; name: string }[];
        groupChoice: { groupId: string } | { newGroupName: string };
        onGroupChange: (
          c: { groupId: string } | { newGroupName: string },
        ) => void;
      };
  error: string | null;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
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

/** Existing-board arm: a group picker plus a "New group…" name input.
 * Wiring goes live in a later task — this renders purely from props. */
function ExistingGroupFields({
  destination,
}: {
  destination: Extract<ConfirmStepProps["destination"], { type: "existing" }>;
}) {
  const selectValue =
    "groupId" in destination.groupChoice
      ? destination.groupChoice.groupId
      : NEW_GROUP_VALUE;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-group-select">Group</Label>
        <select
          id="import-group-select"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            destination.onGroupChange(
              v === NEW_GROUP_VALUE ? { newGroupName: "" } : { groupId: v },
            );
          }}
          className="border-input focus:border-ring focus:ring-ring/50 h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus:ring-2"
        >
          {destination.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value={NEW_GROUP_VALUE}>New group…</option>
        </select>
      </div>

      {"newGroupName" in destination.groupChoice ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-new-group-name">New group name</Label>
          <Input
            id="import-new-group-name"
            value={destination.groupChoice.newGroupName}
            onChange={(e) =>
              destination.onGroupChange({ newGroupName: e.target.value })
            }
            placeholder="New group"
          />
        </div>
      ) : null}
    </div>
  );
}

export function ConfirmStep({
  table,
  state,
  destination,
  error,
  pending,
  onBack,
  onConfirm,
}: ConfirmStepProps) {
  const summary = summarize(table, state);

  const dataColumns = state.columns.filter(
    (c) => c.include && c.role === "data" && c.target !== "skip",
  );
  const previewRows = table.rows.slice(0, MAX_PREVIEW_ROWS);

  const confirmDisabled =
    pending ||
    (destination.type === "new" && destination.boardName.trim() === "");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {summary.items} items · {summary.subitems} subtasks · {summary.columns}{" "}
        columns · {summary.invalid} invalid cells → empty
      </p>

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
      ) : (
        <ExistingGroupFields destination={destination} />
      )}

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" disabled={confirmDisabled} onClick={onConfirm}>
          {pending ? "Importing…" : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
