"use client";

import { useMemo, useState } from "react";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";
import {
  addGroup,
  renameGroup,
  referenceExistingGroup,
  bulkSetType,
  bulkSetGroup,
  orphanGridIndices,
  type SheetState,
} from "./import-wizard-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const NEW_GROUP_VALUE = "__new__";

export function StructureStep({
  table,
  state,
  mode,
  existingGroups,
  onStateChange,
}: {
  table: ParsedTable;
  state: SheetState;
  mode: "new" | "existing";
  /** Board groups available to target in existing-board mode. */
  existingGroups: { id: string; name: string }[];
  onStateChange: (next: SheetState) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const nameCol = state.columns.find((c) => c.role === "name");
  const nameIndex = nameCol?.sourceIndex ?? 0;
  const fallbackKey = state.groups[0]?.key ?? "";

  const orphans = useMemo(
    () => new Set(orphanGridIndices(table, state)),
    [table, state],
  );

  const rows = table.rows
    .map((row, r) => ({ row, gridIndex: table.rowIndices[r] }))
    .filter(({ gridIndex }) => !state.excluded.includes(gridIndex));

  function toggleSelect(gridIndex: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gridIndex)) next.delete(gridIndex);
      else next.add(gridIndex);
      return next;
    });
  }

  function setRowType(gridIndex: number, type: "item" | "subitem") {
    onStateChange(bulkSetType(state, [gridIndex], type));
  }

  function setRowGroup(gridIndex: number, value: string) {
    if (value === NEW_GROUP_VALUE) {
      const withGroup = addGroup(state);
      const key = withGroup.groups[withGroup.groups.length - 1].key;
      onStateChange(bulkSetGroup(withGroup, [gridIndex], key));
      return;
    }
    // value is a group key OR an existing-board group id (prefixed "ex:")
    if (value.startsWith("ex:")) {
      const ex = existingGroups.find((g) => g.id === value.slice(3));
      if (!ex) return;
      const { state: s2, key } = referenceExistingGroup(state, ex);
      onStateChange(bulkSetGroup(s2, [gridIndex], key));
      return;
    }
    onStateChange(bulkSetGroup(state, [gridIndex], value));
  }

  const selectedList = [...selected];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onStateChange(addGroup(state))}
        >
          + Add group
        </Button>
        {selectedList.length > 0 ? (
          <>
            <span className="text-muted-foreground text-xs">
              Selected {selectedList.length}:
            </span>
            <select
              aria-label="Bulk set type"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                onStateChange(
                  bulkSetType(
                    state,
                    selectedList,
                    e.target.value as "item" | "subitem",
                  ),
                );
                e.target.value = "";
              }}
              className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
            >
              <option value="">Set type…</option>
              <option value="item">Item</option>
              <option value="subitem">Subitem</option>
            </select>
            <select
              aria-label="Bulk move to group"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                onStateChange(
                  bulkSetGroup(state, selectedList, e.target.value),
                );
                e.target.value = "";
              }}
              className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
            >
              <option value="">Move to group…</option>
              {state.groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>

      {/* Editable group names */}
      <div className="flex flex-wrap gap-2">
        {state.groups.map((g) => (
          <Input
            key={g.key}
            aria-label={`Group name ${g.name}`}
            value={g.name}
            disabled={g.existingGroupId !== null}
            onChange={(e) =>
              onStateChange(renameGroup(state, g.key, e.target.value))
            }
            className="h-7 w-40 text-xs"
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted border-b">
              <th className="w-8 px-2 py-2" aria-hidden />
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Group</th>
              <th className="px-2 py-2 text-left font-medium">Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, gridIndex }) => {
              const s = state.structure[gridIndex] ?? {
                groupKey: fallbackKey,
                type: "item" as const,
              };
              const isOrphan = orphans.has(gridIndex);
              return (
                <tr key={gridIndex} className="border-b last:border-0">
                  <td className="px-2 py-1.5 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Select row ${gridIndex + 1}`}
                      checked={selected.has(gridIndex)}
                      onChange={() => toggleSelect(gridIndex)}
                      className="accent-primary size-3.5"
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <select
                      aria-label={`Type for row ${gridIndex + 1}`}
                      value={s.type}
                      onChange={(e) =>
                        setRowType(
                          gridIndex,
                          e.target.value as "item" | "subitem",
                        )
                      }
                      className={cn(
                        "h-7 rounded-md border bg-transparent px-1.5 text-xs",
                        isOrphan && "border-destructive text-destructive",
                      )}
                    >
                      <option value="item">Item</option>
                      <option value="subitem">Subitem</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <select
                      aria-label={`Group for row ${gridIndex + 1}`}
                      value={s.groupKey}
                      onChange={(e) => setRowGroup(gridIndex, e.target.value)}
                      className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
                    >
                      {state.groups.map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.name}
                        </option>
                      ))}
                      {mode === "existing"
                        ? existingGroups
                            .filter(
                              (ex) =>
                                !state.groups.some(
                                  (g) => g.existingGroupId === ex.id,
                                ),
                            )
                            .map((ex) => (
                              <option key={ex.id} value={`ex:${ex.id}`}>
                                {ex.name} (board)
                              </option>
                            ))
                        : null}
                      <option value={NEW_GROUP_VALUE}>New group…</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    <span className={cn(s.type === "subitem" && "pl-4")}>
                      {s.type === "subitem" ? "↳ " : ""}
                      {row[nameIndex]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {orphans.size > 0 ? (
        <p role="alert" className="text-destructive text-xs">
          {orphans.size} subitem row(s) have no item above them in their group.
          Make them items or move them under an item to continue.
        </p>
      ) : null}
    </div>
  );
}
