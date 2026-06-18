"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  operatorsForKind,
  valueControlFor,
  OPERATOR_LABEL,
} from "@/lib/dashboards/filter-meta";
import type {
  FilterCondition,
  FilterOperator,
  ListFilter,
} from "@/lib/validations/dashboards";

export type FilterColumn = {
  id: string;
  name: string;
  kind: string;
  options: { id: string; label: string; color?: string }[];
};

// Matches the selectClass pattern from AddWidgetDialog — bg-background +
// hairline border, 4px grid padding, text-sm density.
const selectClass =
  "bg-background w-full rounded-md border px-2 py-1.5 text-sm";

export function FilterBuilder({
  columns,
  value,
  onChange,
}: {
  columns: FilterColumn[];
  value: ListFilter;
  onChange: (next: ListFilter) => void;
}) {
  const conditions = value.conditions ?? [];

  function update(next: Partial<ListFilter>) {
    onChange({ combinator: value.combinator ?? "and", conditions, ...next });
  }

  function addCondition() {
    const first = columns[0];
    if (!first) return;
    const op = operatorsForKind(first.kind)[0];
    update({
      conditions: [...conditions, { columnId: first.id, operator: op }],
    });
  }

  function patchAt(i: number, patch: Partial<FilterCondition>) {
    update({
      conditions: conditions.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    });
  }

  function removeAt(i: number) {
    update({ conditions: conditions.filter((_, idx) => idx !== i) });
  }

  if (columns.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This board has no columns to filter on.
      </p>
    );
  }

  return (
    <fieldset className="text-sm">
      <legend className="mb-1">Filter</legend>

      {/* Combinator toggle — only shown when ≥ 2 conditions */}
      {conditions.length >= 2 ? (
        <div className="mb-2 inline-flex overflow-hidden rounded-md border text-xs">
          {(["and", "or"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={
                value.combinator === c
                  ? "bg-primary text-primary-foreground px-2.5 py-1"
                  : "hover:bg-accent px-2.5 py-1"
              }
              onClick={() => update({ combinator: c })}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {conditions.map((cond, i) => {
          const col = columns.find((c) => c.id === cond.columnId);
          const kind = col?.kind ?? "text";
          const control = valueControlFor(kind, cond.operator);
          return (
            <div key={i} className="flex items-center gap-1.5">
              {/* Column picker */}
              <select
                aria-label="Filter column"
                className={selectClass}
                value={cond.columnId}
                onChange={(e) => {
                  const nextCol = columns.find((c) => c.id === e.target.value)!;
                  patchAt(i, {
                    columnId: nextCol.id,
                    operator: operatorsForKind(nextCol.kind)[0],
                    value: undefined,
                  });
                }}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {/* Operator picker */}
              <select
                aria-label="Filter operator"
                className={selectClass}
                value={cond.operator}
                onChange={(e) =>
                  patchAt(i, {
                    operator: e.target.value as FilterOperator,
                    value: undefined,
                  })
                }
              >
                {operatorsForKind(kind).map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABEL[op]}
                  </option>
                ))}
              </select>

              {/* Value control — hidden for is_empty / not_empty */}
              {control === "none" ? null : control === "option" ? (
                <select
                  aria-label="Filter value"
                  className={selectClass}
                  value={typeof cond.value === "string" ? cond.value : ""}
                  onChange={(e) => patchAt(i, { value: e.target.value })}
                >
                  <option value="">Select…</option>
                  {(col?.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  aria-label="Filter value"
                  type={
                    control === "number"
                      ? "number"
                      : control === "date"
                        ? "date"
                        : "text"
                  }
                  value={
                    cond.value === undefined || cond.value === null
                      ? ""
                      : String(cond.value)
                  }
                  onChange={(e) =>
                    patchAt(i, {
                      value:
                        control === "number"
                          ? e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}

              {/* Remove button — icon-only with accessible label */}
              <button
                type="button"
                aria-label="Remove condition"
                className="text-muted-foreground hover:text-foreground shrink-0 p-1"
                onClick={() => removeAt(i)}
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={addCondition}
      >
        <Plus className="mr-1.5 size-4" /> Add condition
      </Button>
    </fieldset>
  );
}
