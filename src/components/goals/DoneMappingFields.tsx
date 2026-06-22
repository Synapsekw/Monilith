"use client";

import type { StatusColumn } from "@/lib/portfolios/queries";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const DONE_RE = /done|complete|closed|shipped/i;
const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30";

/** Default "done" option ids for a status column, guessed by option label. */
export function defaultDoneOptionIds(
  column: StatusColumn | undefined,
): string[] {
  if (!column) return [];
  return column.options.filter((o) => DONE_RE.test(o.label)).map((o) => o.id);
}

export type DoneMappingFieldsProps = {
  idPrefix: string;
  columns: StatusColumn[];
  loading?: boolean;
  doneColumnId: string | null;
  doneOptionIds: string[];
  onColumnChange: (columnId: string | null) => void;
  onToggleOption: (optionId: string) => void;
};

export function DoneMappingFields({
  idPrefix,
  columns,
  loading = false,
  doneColumnId,
  doneOptionIds,
  onColumnChange,
  onToggleOption,
}: DoneMappingFieldsProps) {
  const selectId = `${idPrefix}-status-column`;
  const activeColumn = columns.find((c) => c.id === doneColumnId) ?? null;

  if (loading) {
    return (
      <p className="text-muted-foreground text-xs">Loading status columns…</p>
    );
  }
  if (columns.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This board has no status columns — progress will show as n/a.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={selectId}>Completion status</Label>
      <select
        id={selectId}
        className={SELECT_CLASS}
        value={doneColumnId ?? ""}
        onChange={(e) =>
          onColumnChange(e.target.value === "" ? null : e.target.value)
        }
      >
        <option value="">No mapping (progress n/a)</option>
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {activeColumn ? (
        <fieldset className="mt-1 flex flex-col gap-1.5">
          <legend className="text-muted-foreground mb-1 text-xs">
            Statuses that count as done
          </legend>
          {activeColumn.options.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No statuses defined on this column.
            </p>
          ) : (
            activeColumn.options.map((o) => {
              const checked = doneOptionIds.includes(o.id);
              return (
                <label
                  key={o.id}
                  className={cn(
                    "hover:bg-accent/40 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    checked && "bg-accent/50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    checked={checked}
                    onChange={() => onToggleOption(o.id)}
                  />
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: o.color }}
                  />
                  {o.label}
                </label>
              );
            })
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
