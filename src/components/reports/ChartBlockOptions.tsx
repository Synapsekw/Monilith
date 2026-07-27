"use client";
import type { Column } from "@/lib/boards/queries";
import type { ChartBlockOptions } from "@/lib/reports/config";
import { isChartableColumn } from "@/lib/reports/chart-data";
import { selectClass } from "@/components/boards/automations/builder-utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const VARIANTS = [
  { value: "donut", label: "Donut" },
  { value: "bars", label: "Bars" },
] as const;

/**
 * The source `<select>` flattens three config shapes into one control:
 *   "status"      → late-bound to the board's first status column
 *   "board_group" → the board's groups
 *   <column id>   → source: "column", columnId: <id>
 */
export function ChartBlockOptionsEditor({
  options,
  columns,
  onChange,
}: {
  options: ChartBlockOptions;
  columns: Column[];
  onChange: (next: ChartBlockOptions) => void;
}) {
  const chartable = columns.filter(isChartableColumn);
  const sourceValue =
    options.source === "column" ? (options.columnId ?? "") : options.source;

  function pickSource(value: string) {
    if (value === "status" || value === "board_group") {
      onChange({ ...options, source: value, columnId: null });
      return;
    }
    onChange({ ...options, source: "column", columnId: value });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">
        Chart source
        <select
          aria-label="Chart source"
          className={selectClass}
          value={sourceValue}
          onChange={(e) => pickSource(e.target.value)}
        >
          <option value="status">Status (first status column)</option>
          <option value="board_group">Groups</option>
          {chartable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        Chart style
        <select
          aria-label="Chart style"
          className={selectClass}
          value={options.variant}
          onChange={(e) =>
            onChange({
              ...options,
              variant: e.target.value as ChartBlockOptions["variant"],
            })
          }
        >
          {VARIANTS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        Max categories
        <select
          aria-label="Max categories"
          className={selectClass}
          value={String(options.maxCategories)}
          onChange={(e) =>
            onChange({ ...options, maxCategories: Number(e.target.value) })
          }
        >
          {[3, 4, 5, 6].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground mt-1 block text-xs">
          Extra categories fold into a neutral “Other”.
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-chart-title">Chart title</Label>
        <Input
          id="report-chart-title"
          aria-label="Chart title"
          value={options.title}
          onChange={(e) => onChange({ ...options, title: e.target.value })}
          placeholder="Items by …"
        />
      </div>
    </div>
  );
}
