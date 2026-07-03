"use client";

import { ChevronDown } from "lucide-react";
import {
  IMPORTABLE_KINDS,
  type ImportableKind,
  type ParsedTable,
} from "@/lib/boards/spreadsheet/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ColumnState, SheetState } from "./import-wizard-state";

const MAX_VISIBLE_ROWS = 100;

const ROLE_LABEL: Record<ColumnState["role"], string> = {
  name: "Item name",
  group: "Group",
  data: "Data",
};

export function MappingGrid({
  grid,
  state,
  table,
  invalid,
  onStateChange,
}: {
  grid: string[][];
  state: SheetState;
  table: ParsedTable;
  invalid: Map<number, number[]>;
  onStateChange: (next: SheetState) => void;
}) {
  void grid; // reserved for future preview affordances; the rendered rows come from `table`

  const visibleRows = table.rows.slice(0, MAX_VISIBLE_ROWS);
  const truncated = table.rows.length > MAX_VISIBLE_ROWS;

  function updateColumn(index: number, patch: Partial<ColumnState>) {
    const columns = state.columns.map((c, i) =>
      i === index ? { ...c, ...patch } : c,
    );
    onStateChange({ ...state, columns });
  }

  function setRole(index: number, role: ColumnState["role"]) {
    const columns = state.columns.map((c) => ({ ...c }));

    // Reassigning a structural role demotes whoever currently holds it back
    // to a regular data column, restoring its frozen detected kind.
    if (role !== "data") {
      const prevIndex = columns.findIndex(
        (c, i) => c.role === role && i !== index,
      );
      if (prevIndex !== -1) {
        columns[prevIndex] = {
          ...columns[prevIndex],
          role: "data",
          kind: columns[prevIndex].detectedKind,
        };
      }
    }

    columns[index] = {
      ...columns[index],
      role,
      kind: role === "data" ? columns[index].detectedKind : "text",
    };

    onStateChange({ ...state, columns });
  }

  function toggleRow(gridIndex: number) {
    const isExcluded = state.excluded.includes(gridIndex);
    const excluded = isExcluded
      ? state.excluded.filter((r) => r !== gridIndex)
      : [...state.excluded, gridIndex];
    onStateChange({ ...state, excluded });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted border-b">
              <th className="w-8 px-2 py-2" aria-hidden />
              {state.columns.map((col, i) => (
                <th
                  key={col.sourceIndex}
                  className={cn(
                    "min-w-44 px-2 py-2 text-left align-top font-medium",
                    !col.include && "opacity-50",
                  )}
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Include ${col.name}`}
                        checked={col.include}
                        onChange={(e) =>
                          updateColumn(i, { include: e.target.checked })
                        }
                        className="border-input accent-primary size-3.5 shrink-0 rounded-sm"
                      />
                      <Input
                        value={col.name}
                        onChange={(e) =>
                          updateColumn(i, { name: e.target.value })
                        }
                        className="h-7 text-xs font-normal"
                      />
                    </div>
                    <select
                      aria-label={`Column type for ${col.name}`}
                      value={col.kind}
                      disabled={col.role !== "data"}
                      onChange={(e) =>
                        updateColumn(i, {
                          kind: e.target.value as ImportableKind,
                        })
                      }
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-7 w-full rounded-md border bg-transparent px-1.5 text-xs font-normal outline-none focus-visible:ring-2 disabled:opacity-50"
                    >
                      {IMPORTABLE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-6 w-full justify-between px-1.5 text-xs font-normal"
                        >
                          {ROLE_LABEL[col.role]}
                          <ChevronDown className="size-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setRole(i, "name")}>
                          Use as item name
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRole(i, "group")}>
                          Use as group
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRole(i, "data")}>
                          Regular column
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, r) => {
              const gridIndex = table.rowIndices[r];
              const offenders = invalid.get(gridIndex);
              return (
                <tr key={gridIndex} className="border-b last:border-0">
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Include row ${gridIndex + 1}`}
                      checked={!state.excluded.includes(gridIndex)}
                      onChange={() => toggleRow(gridIndex)}
                      className="border-input accent-primary size-3.5 shrink-0 rounded-sm"
                    />
                  </td>
                  {state.columns.map((col) => {
                    const isInvalid = offenders?.includes(col.sourceIndex);
                    return (
                      <td
                        key={col.sourceIndex}
                        title={
                          isInvalid
                            ? `Can't parse as ${col.kind} — will import empty`
                            : undefined
                        }
                        className={cn(
                          "text-foreground px-2 py-1.5 align-top",
                          !col.include && "opacity-50",
                          isInvalid && "bg-status-yellow/15 text-status-yellow",
                        )}
                      >
                        {row[col.sourceIndex]}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p className="text-muted-foreground text-xs">
          Showing first {MAX_VISIBLE_ROWS} of {table.rows.length} rows
        </p>
      ) : null}
    </div>
  );
}
