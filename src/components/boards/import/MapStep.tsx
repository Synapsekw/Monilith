"use client";

import { useMemo, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import type { SheetPreview } from "@/lib/boards/spreadsheet/types";
import type { BoardColumnRef } from "@/lib/boards/spreadsheet/match-columns";
import {
  deriveSheetState,
  invalidCellMap,
  isEmptySheetState,
  tableFor,
  type SheetState,
} from "./import-wizard-state";
import { MappingGrid } from "./MappingGrid";
import { suggestImportMapping } from "@/lib/ai/import-mapping-actions";
import { applyMappingSuggestions } from "@/lib/ai/import-mapping-schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How many verbatim sample values leave the workspace per column (F12 egress
 * cap). The server re-enforces this; mirrored here so the disclosure is honest. */
const AI_SAMPLES_PER_COLUMN = 5;

const HEADER_ROW_OPTIONS = Array.from({ length: 10 }, (_, i) => i);

export function MapStep({
  sheets,
  activeSheet,
  onSheetChange,
  state,
  onStateChange,
  mode,
  boardColumns,
  rowCapWarning,
}: {
  sheets: SheetPreview[];
  activeSheet: number;
  onSheetChange: (i: number) => void;
  state: SheetState;
  onStateChange: (next: SheetState) => void;
  mode: "new" | "existing";
  /** The existing board's columns to match/target against. Only meaningful
   * (and only passed) when `mode === "existing"`. */
  boardColumns?: BoardColumnRef[];
  rowCapWarning: string | null;
}) {
  const grid = useMemo(
    () => sheets[activeSheet]?.grid ?? [],
    [sheets, activeSheet],
  );

  // A blank sheet carries the zero-column sentinel state; `tableFor` on it
  // would throw the same `Error("empty")` as `deriveSheetState`, so short-
  // circuit to `null` and render an inline message instead of the grid.
  const isEmpty = isEmptySheetState(state);
  const table = useMemo(
    () => (isEmpty ? null : tableFor(grid, state)),
    [grid, state, isEmpty],
  );
  const invalid = useMemo(
    () =>
      table
        ? invalidCellMap(table, state.columns)
        : new Map<number, number[]>(),
    [table, state.columns],
  );

  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  function handleHeaderRowChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    const headerRow = raw === "none" ? null : Number(raw);
    onStateChange(deriveSheetState(grid, headerRow, boardColumns));
  }

  function handleExcludeInvalid() {
    const rowsToExclude = [...invalid.keys()];
    const excluded = Array.from(new Set([...state.excluded, ...rowsToExclude]));
    onStateChange({ ...state, excluded });
  }

  function handleSuggestWithAi() {
    if (!table) return;
    // Assemble the bounded egress payload: each column's header plus a small
    // sample of verbatim cell values. The cap is re-enforced server-side.
    const columns = table.header.map((header, sourceIndex) => {
      const sampleValues: string[] = [];
      for (const row of table.rows) {
        if (sampleValues.length >= AI_SAMPLES_PER_COLUMN) break;
        const value = (row[sourceIndex] ?? "").trim();
        if (value !== "") sampleValues.push(value);
      }
      return { sourceIndex, header, sampleValues };
    });
    const targetColumns = boardColumns?.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as string,
    }));

    setAiError(null);
    setAiWarnings([]);
    startAi(async () => {
      const res = await suggestImportMapping({
        columns,
        boardColumns: targetColumns,
      });
      if (!res.ok) {
        setAiError(res.error);
        return;
      }
      setAiWarnings(res.data.warnings);
      onStateChange(
        applyMappingSuggestions(state, res.data.suggestions, boardColumns),
      );
    });
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

      {isEmpty ? (
        <p className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
          This sheet has no data. Pick another sheet to import.
        </p>
      ) : null}

      {table ? (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1.5"
                onClick={handleSuggestWithAi}
                disabled={aiPending}
              >
                <Sparkles className="text-brand size-4" aria-hidden />
                {aiPending ? "Suggesting…" : "Suggest with AI"}
              </Button>
              <p className="text-muted-foreground text-xs">
                A few sample cell values are sent to suggest mappings.
              </p>
            </div>
            {aiError ? (
              <p role="alert" className="text-destructive text-xs">
                {aiError}
              </p>
            ) : null}
            {aiWarnings.length > 0 ? (
              <ul className="text-muted-foreground list-disc pl-4 text-xs">
                {aiWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
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
              value={
                state.headerRow === null ? "none" : String(state.headerRow)
              }
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
            mode={mode}
            boardColumns={boardColumns}
          />
        </>
      ) : null}
    </div>
  );
}
