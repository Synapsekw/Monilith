"use client";

import { useMemo } from "react";
import type { SheetPreview } from "@/lib/boards/spreadsheet/types";
import {
  deriveSheetState,
  invalidCellMap,
  tableFor,
  type SheetState,
} from "./import-wizard-state";
import { MappingGrid } from "./MappingGrid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HEADER_ROW_OPTIONS = Array.from({ length: 10 }, (_, i) => i);

export function MapStep({
  sheets,
  activeSheet,
  onSheetChange,
  state,
  onStateChange,
  mode,
  rowCapWarning,
  onBack,
  onNext,
}: {
  sheets: SheetPreview[];
  activeSheet: number;
  onSheetChange: (i: number) => void;
  state: SheetState;
  onStateChange: (next: SheetState) => void;
  mode: "new" | "existing";
  rowCapWarning: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const grid = useMemo(
    () => sheets[activeSheet]?.grid ?? [],
    [sheets, activeSheet],
  );

  const table = useMemo(() => tableFor(grid, state), [grid, state]);
  const invalid = useMemo(
    () => invalidCellMap(table, state.columns),
    [table, state.columns],
  );

  function handleHeaderRowChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    const headerRow = raw === "none" ? null : Number(raw);
    onStateChange(deriveSheetState(grid, headerRow));
  }

  function handleExcludeInvalid() {
    const rowsToExclude = [...invalid.keys()];
    const excluded = Array.from(new Set([...state.excluded, ...rowsToExclude]));
    onStateChange({ ...state, excluded });
  }

  return (
    <div data-import-mode={mode} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1" role="tablist">
        {sheets.map((sheet, i) => (
          <Button
            key={sheet.name}
            type="button"
            variant="ghost"
            size="sm"
            role="tab"
            aria-selected={i === activeSheet}
            className={cn(i === activeSheet && "bg-muted text-foreground")}
            onClick={() => onSheetChange(i)}
          >
            {sheet.name}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="import-header-row"
          className="text-foreground text-sm font-medium"
        >
          Header row
        </label>
        <select
          id="import-header-row"
          value={state.headerRow === null ? "none" : String(state.headerRow)}
          onChange={handleHeaderRowChange}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-8 w-fit rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3"
        >
          {HEADER_ROW_OPTIONS.map((i) => (
            <option key={i} value={i}>
              Row {i + 1}
            </option>
          ))}
          <option value="none">No header row</option>
        </select>
        <p className="text-muted-foreground text-xs">
          Changing the header row resets column edits for this sheet.
        </p>
      </div>

      {rowCapWarning ? (
        <p className="border-status-yellow/40 bg-status-yellow/10 text-foreground rounded-md border px-3 py-2 text-xs">
          {rowCapWarning}
        </p>
      ) : null}

      {invalid.size > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={handleExcludeInvalid}
        >
          Exclude {invalid.size} rows with invalid cells
        </Button>
      ) : null}

      <MappingGrid
        grid={grid}
        state={state}
        table={table}
        invalid={invalid}
        onStateChange={onStateChange}
      />

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
