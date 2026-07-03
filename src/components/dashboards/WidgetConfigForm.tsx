"use client";

import { Input } from "@/components/ui/input";
import { FilterBuilder } from "@/components/dashboards/FilterBuilder";
import {
  MULTI_SERIES_TYPES,
  DATE_PRIMARY_TYPES,
} from "@/lib/dashboards/chart-config";
import type {
  ChartType,
  ListFilter,
  SeriesDimension,
} from "@/lib/validations/dashboards";

export type BoardOption = {
  id: string;
  name: string;
  numbersColumns: { id: string; name: string }[];
  statusColumns: { id: string; name: string }[];
  dateColumns: { id: string; name: string }[];
  peopleColumns: { id: string; name: string }[];
  dropdownColumns: { id: string; name: string }[];
  percentColumns: { id: string; name: string }[];
  allColumns: {
    id: string;
    name: string;
    kind: string;
    options: { id: string; label: string; color?: string }[];
  }[];
};

export type WidgetDraft = {
  kind: "number" | "chart" | "battery" | "list" | "completion" | "health";
  sourceBoardId: string;
  title: string;
  config: Record<string, unknown>;
};

const selectClass =
  "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "stackedBar", label: "Stacked bar" },
  { value: "groupedBar", label: "Grouped bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "combo", label: "Combo (bar + line)" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "radial", label: "Radial" },
];

function columnsFor(board: BoardOption | undefined, kind: string) {
  if (!board) return [];
  if (kind === "status") return board.statusColumns;
  if (kind === "dropdown") return board.dropdownColumns;
  if (kind === "people") return board.peopleColumns;
  if (kind === "date") return board.dateColumns;
  return [];
}

/** Dimension picker shared by primary + series axes. Declared at module scope
 *  so it is stable across renders (avoids react-hooks/static-components lint). */
function DimensionPicker({
  label,
  dim,
  onPick,
  allowDate,
  allowNone,
  board,
}: {
  label: string;
  dim: SeriesDimension | undefined;
  onPick: (d: SeriesDimension | undefined) => void;
  allowDate: boolean;
  allowNone: boolean;
  board: BoardOption | undefined;
}) {
  const kind = dim?.kind ?? (allowNone ? "none" : "status");
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-sm">
        {label}
        <select
          aria-label={label}
          className={selectClass}
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === "none") return onPick(undefined);
            if (k === "date") return onPick({ kind: "date", bucket: "month" });
            onPick({ kind: k as SeriesDimension["kind"], columnId: undefined });
          }}
        >
          {allowNone ? <option value="none">None</option> : null}
          <option value="status">Status</option>
          <option value="dropdown">Dropdown</option>
          <option value="people">People</option>
          {allowDate ? <option value="date">Date</option> : null}
        </select>
      </label>
      {dim && dim.kind === "date" ? (
        <label className="text-sm">
          Bucket
          <select
            aria-label={`${label} bucket`}
            className={selectClass}
            value={dim.bucket ?? "month"}
            onChange={(e) =>
              onPick({
                ...dim,
                bucket: e.target.value as "day" | "week" | "month",
              })
            }
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      ) : dim ? (
        <label className="text-sm">
          Column
          <select
            aria-label={`${label} column`}
            className={selectClass}
            value={dim.columnId ?? ""}
            onChange={(e) => onPick({ ...dim, columnId: e.target.value })}
          >
            <option value="">Select…</option>
            {columnsFor(board, dim.kind).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function WidgetConfigForm({
  boards,
  value,
  onChange,
}: {
  boards: BoardOption[];
  value: WidgetDraft;
  onChange: (next: WidgetDraft) => void;
}) {
  const board = boards.find((b) => b.id === value.sourceBoardId);
  const cfg = value.config;

  function patch(next: Partial<WidgetDraft>) {
    onChange({ ...value, ...next });
  }
  function patchConfig(next: Record<string, unknown>) {
    onChange({ ...value, config: { ...value.config, ...next } });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">
        Widget type
        <select
          className={selectClass}
          value={value.kind}
          onChange={(e) =>
            patch({
              kind: e.target.value as WidgetDraft["kind"],
              config: defaultConfig(e.target.value as WidgetDraft["kind"]),
            })
          }
        >
          <option value="number">Number</option>
          <option value="chart">Chart</option>
          <option value="battery">Battery</option>
          <option value="list">List</option>
          <option value="completion">Completion</option>
          <option value="health">Health summary</option>
        </select>
      </label>

      <label className="text-sm">
        Source board
        <select
          className={selectClass}
          value={value.sourceBoardId}
          onChange={(e) =>
            patch({
              sourceBoardId: e.target.value,
              config: defaultConfig(value.kind),
            })
          }
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        Title
        <Input
          className="mt-1"
          value={value.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="e.g. By status"
        />
      </label>

      {value.kind === "chart" ? (
        <>
          <label className="text-sm">
            Chart type
            <select
              aria-label="Chart type"
              className={selectClass}
              value={(cfg.chartType as string) ?? "bar"}
              onChange={(e) => {
                const next = e.target.value as ChartType;
                const isDate = DATE_PRIMARY_TYPES.includes(next);
                patchConfig({
                  chartType: next,
                  primary: isDate
                    ? { kind: "date", bucket: "month" }
                    : (cfg.primary ?? { kind: "status" }),
                  ...(MULTI_SERIES_TYPES.includes(next)
                    ? {}
                    : { series: undefined }),
                });
              }}
            >
              {CHART_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <DimensionPicker
            label="Group by"
            dim={cfg.primary as SeriesDimension}
            onPick={(d) => patchConfig({ primary: d })}
            allowDate={DATE_PRIMARY_TYPES.includes(cfg.chartType as ChartType)}
            allowNone={false}
            board={board}
          />

          {MULTI_SERIES_TYPES.includes(cfg.chartType as ChartType) ? (
            <DimensionPicker
              label="Split series by"
              dim={cfg.series as SeriesDimension | undefined}
              onPick={(d) => patchConfig({ series: d })}
              allowDate={false}
              allowNone
              board={board}
            />
          ) : null}

          <MeasureFields board={board} cfg={cfg} patchConfig={patchConfig} />
        </>
      ) : value.kind === "number" ? (
        <NumberFields board={board} cfg={cfg} patchConfig={patchConfig} />
      ) : value.kind === "battery" ? (
        <label className="text-sm">
          Group by (status column)
          <select
            className={selectClass}
            value={(cfg.groupColumnId as string) ?? ""}
            onChange={(e) => patchConfig({ groupColumnId: e.target.value })}
          >
            <option value="">Select…</option>
            {(board?.statusColumns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : value.kind === "completion" ? (
        <CompletionFields board={board} cfg={cfg} patchConfig={patchConfig} />
      ) : value.kind === "health" ? (
        <p className="text-muted-foreground text-xs">
          Shows overall progress plus overdue, incomplete, and new-item counts
          for the source board — no extra configuration. Incomplete = missing
          owner or date on an unfinished item.
        </p>
      ) : (
        <ListFields board={board} cfg={cfg} patchConfig={patchConfig} />
      )}
    </div>
  );
}

export function defaultConfig(
  kind: WidgetDraft["kind"],
): Record<string, unknown> {
  switch (kind) {
    case "number":
      return { agg: "count", display: "plain" };
    case "chart":
      return {
        chartType: "bar",
        primary: { kind: "status" },
        measure: { agg: "count" },
      };
    case "battery":
      return {};
    case "list":
      return { columnIds: [], limit: 25 };
    case "completion":
      // Status mode default: every board template ships a status column;
      // percent columns are opt-in.
      return { mode: "status", doneOptionIds: [] };
    case "health":
      // Fixed rule — nothing to configure beyond the source board.
      return {};
  }
}

function MeasureFields({
  board,
  cfg,
  patchConfig,
}: {
  board: BoardOption | undefined;
  cfg: Record<string, unknown>;
  patchConfig: (n: Record<string, unknown>) => void;
}) {
  const measure = (cfg.measure ?? { agg: "count" }) as {
    agg: string;
    valueColumnId?: string;
  };
  const numbers = board?.numbersColumns ?? [];
  const hasNumbers = numbers.length > 0;
  // Sum/Average are impossible without a number column — only offer them when
  // one exists, and coerce the display to Count otherwise so the select never
  // shows a value it can't satisfy.
  const agg = hasNumbers ? measure.agg : "count";
  return (
    <>
      <label className="text-sm">
        Measure
        <select
          className={selectClass}
          value={agg}
          onChange={(e) => {
            const next = e.target.value;
            // Switching to sum/avg auto-selects the first number column so the
            // measure is always savable — the server rejects sum/avg with no
            // valueColumnId ("Sum and average need a numbers column.").
            patchConfig({
              measure:
                next === "count"
                  ? { agg: "count" }
                  : {
                      agg: next,
                      valueColumnId: measure.valueColumnId ?? numbers[0]?.id,
                    },
            });
          }}
        >
          <option value="count">Count of items</option>
          {hasNumbers ? (
            <>
              <option value="sum">Sum of a number column</option>
              <option value="avg">Average of a number column</option>
            </>
          ) : null}
        </select>
      </label>
      {!hasNumbers ? (
        <p className="text-muted-foreground text-xs">
          Add a Number column to this board to use Sum or Average.
        </p>
      ) : null}
      {hasNumbers && agg !== "count" ? (
        <label className="text-sm">
          Number column
          <select
            className={selectClass}
            value={measure.valueColumnId ?? numbers[0]?.id ?? ""}
            onChange={(e) =>
              patchConfig({
                measure: { ...measure, valueColumnId: e.target.value },
              })
            }
          >
            {numbers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}

function NumberFields({
  board,
  cfg,
  patchConfig,
}: {
  board: BoardOption | undefined;
  cfg: Record<string, unknown>;
  patchConfig: (n: Record<string, unknown>) => void;
}) {
  const numbers = board?.numbersColumns ?? [];
  const hasNumbers = numbers.length > 0;
  const agg = hasNumbers ? ((cfg.agg as string) ?? "count") : "count";
  const display = (cfg.display as string) ?? "plain";
  return (
    <>
      <label className="text-sm">
        Metric
        <select
          className={selectClass}
          value={agg}
          onChange={(e) => {
            const next = e.target.value;
            // Auto-select the first number column for sum/avg so the metric is
            // always savable (server rejects sum/avg without a numbers column).
            patchConfig(
              next === "count"
                ? { agg: "count" }
                : {
                    agg: next,
                    valueColumnId:
                      (cfg.valueColumnId as string) ?? numbers[0]?.id,
                  },
            );
          }}
        >
          <option value="count">Count of items</option>
          {hasNumbers ? (
            <>
              <option value="sum">Sum of a number column</option>
              <option value="avg">Average of a number column</option>
            </>
          ) : null}
        </select>
      </label>
      {!hasNumbers ? (
        <p className="text-muted-foreground text-xs">
          Add a Number column to this board to use Sum or Average.
        </p>
      ) : null}
      {hasNumbers && agg !== "count" ? (
        <label className="text-sm">
          Number column
          <select
            className={selectClass}
            value={(cfg.valueColumnId as string) ?? numbers[0]?.id ?? ""}
            onChange={(e) => patchConfig({ valueColumnId: e.target.value })}
          >
            {numbers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-sm">
        Display
        <select
          className={selectClass}
          value={display}
          onChange={(e) => patchConfig({ display: e.target.value })}
        >
          <option value="plain">Plain number</option>
          <option value="gauge">Gauge (vs target)</option>
        </select>
      </label>
      {display === "gauge" ? (
        <label className="text-sm">
          Target
          <Input
            type="number"
            min={1}
            className="mt-1"
            value={(cfg.target as number) ?? ""}
            onChange={(e) =>
              patchConfig({ target: Number(e.target.value) || undefined })
            }
          />
        </label>
      ) : null}
    </>
  );
}

/** Config fields for the Completion widget: pick the completion semantics
 *  (percent column average vs. status done-set share) and the column(s) it
 *  reads. Picking a status column pre-checks done-looking options — an
 *  editable head start, never a hidden rule. Module scope for a stable
 *  identity (react-hooks/static-components), like NumberFields. */
function CompletionFields({
  board,
  cfg,
  patchConfig,
}: {
  board: BoardOption | undefined;
  cfg: Record<string, unknown>;
  patchConfig: (n: Record<string, unknown>) => void;
}) {
  const mode = (cfg.mode as string) ?? "status";
  const statusCols = board?.statusColumns ?? [];
  const percentCols = board?.percentColumns ?? [];
  const statusColumnId = (cfg.statusColumnId as string) ?? "";
  const options =
    board?.allColumns.find((c) => c.id === statusColumnId)?.options ?? [];
  const doneOptionIds = (cfg.doneOptionIds as string[]) ?? [];

  return (
    <>
      <label className="text-sm">
        Completion source
        <select
          aria-label="Completion source"
          className={selectClass}
          value={mode}
          onChange={(e) =>
            patchConfig(
              e.target.value === "percent"
                ? {
                    mode: "percent",
                    statusColumnId: undefined,
                    doneOptionIds: [],
                  }
                : { mode: "status", percentColumnId: undefined },
            )
          }
        >
          <option value="status">Status (done options)</option>
          <option value="percent">Percent column</option>
        </select>
      </label>

      {mode === "percent" ? (
        <>
          <label className="text-sm">
            Percent column
            <select
              aria-label="Percent column"
              className={selectClass}
              value={(cfg.percentColumnId as string) ?? ""}
              onChange={(e) => patchConfig({ percentColumnId: e.target.value })}
            >
              <option value="">Select…</option>
              {percentCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {percentCols.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Add a Percent column to this board to use percent mode.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <label className="text-sm">
            Status column
            <select
              aria-label="Status column"
              className={selectClass}
              value={statusColumnId}
              onChange={(e) => {
                const colId = e.target.value;
                const opts =
                  board?.allColumns.find((c) => c.id === colId)?.options ?? [];
                // Pre-check done-like options; the user can edit the set.
                const preset = opts
                  .filter((o) => /done|complete|finished/i.test(o.label))
                  .map((o) => o.id);
                patchConfig({ statusColumnId: colId, doneOptionIds: preset });
              }}
            >
              <option value="">Select…</option>
              {statusCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {statusCols.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Add a Status column to this board to use status mode.
            </p>
          ) : null}
          {statusColumnId ? (
            <fieldset className="text-sm">
              <legend className="mb-1">Counts as done</legend>
              <div className="flex flex-col gap-1 rounded-md border p-2">
                {options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-primary size-4"
                      checked={doneOptionIds.includes(o.id)}
                      onChange={(e) =>
                        patchConfig({
                          doneOptionIds: e.target.checked
                            ? [...doneOptionIds, o.id]
                            : doneOptionIds.filter((id) => id !== o.id),
                        })
                      }
                    />
                    <span
                      className="size-2.5 rounded-sm"
                      style={{
                        backgroundColor: o.color ?? "var(--muted-foreground)",
                      }}
                      aria-hidden
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </>
      )}
    </>
  );
}

function ListFields({
  board,
  cfg,
  patchConfig,
}: {
  board: BoardOption | undefined;
  cfg: Record<string, unknown>;
  patchConfig: (n: Record<string, unknown>) => void;
}) {
  const columnIds = (cfg.columnIds as string[]) ?? [];
  const limit = (cfg.limit as number) ?? 25;
  const filter = (cfg.filter as ListFilter) ?? {
    combinator: "and",
    conditions: [],
  };
  return (
    <>
      <fieldset className="text-sm">
        <legend className="mb-1">Columns to show</legend>
        <div className="flex flex-col gap-1 rounded-md border p-2">
          {(board?.allColumns ?? []).length === 0 ? (
            <span className="text-muted-foreground text-xs">
              This board has no columns.
            </span>
          ) : (
            board?.allColumns.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={columnIds.includes(c.id)}
                  onChange={(e) =>
                    patchConfig({
                      columnIds: e.target.checked
                        ? [...columnIds, c.id]
                        : columnIds.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.name}
              </label>
            ))
          )}
        </div>
      </fieldset>
      <label className="text-sm">
        Max rows
        <Input
          type="number"
          min={1}
          max={100}
          className="mt-1"
          value={limit}
          onChange={(e) =>
            patchConfig({
              limit: Math.min(Math.max(Number(e.target.value) || 1, 1), 100),
            })
          }
        />
      </label>
      <FilterBuilder
        columns={board?.allColumns ?? []}
        value={filter}
        onChange={(f) => patchConfig({ filter: f })}
      />
    </>
  );
}
