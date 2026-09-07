import { z } from "zod";
import type { ColumnKind } from "@/lib/validations/boards";
import type { ToolDescriptor } from "./descriptor";
import { parseAction } from "./shared";

/**
 * What an agent must know before it can WRITE structure.
 *
 * `column-meta.ts` already tells an agent the value shape each column kind
 * accepts in a CELL. This is its sibling for the column itself, the view, the
 * widget and the report: the `settings` JSON a create takes. A model cannot
 * guess that a status column's options carry ids it chooses, or that a relation
 * column needs `target_board_id`, and a tool description carrying all of it
 * would be paid for on every request by every client. So it is fetched once, on
 * demand, by a tool that costs nothing to call.
 *
 * STATIC BY CONSTRUCTION — no client, no query. That is what lets it be
 * capability-free.
 */
export const SCHEMA_TOPICS = [
  "all",
  "column_kinds",
  "view_types",
  "widget_kinds",
  "report_shapes",
] as const;
export type SchemaTopic = (typeof SCHEMA_TOPICS)[number];

export type SchemaEntry = {
  /** The shape of the `settings` object this kind accepts. */
  settings: string;
  /** A minimal object that really works, so the model has a starting point. */
  example?: Record<string, unknown>;
  /** A constraint the shape alone cannot express. */
  note?: string;
};

/** One entry per `columnKindSchema` option. Derived from
 *  `columnSettingsSchema(kind)` in `src/lib/validations/boards.ts` and
 *  `defaultColumn` in `src/lib/boards/column-defaults.ts`. The test above
 *  fails until every kind is present, so this list cannot ship partial.
 *
 *  Most kinds route through `emptySettingsSchema` (just the universal,
 *  internal `summary_aggregation` footer key — not surfaced here, same
 *  allow-list discipline as `column-meta.ts`'s `SETTINGS_KEYS`), so their
 *  create-time settings really are `{}`. */
export const COLUMN_KIND_SCHEMA: Record<ColumnKind, SchemaEntry> = {
  text: { settings: "{}" },
  status: {
    settings: "{ options: [{ id: string, label: string, color: string }] }",
    example: {
      options: [
        { id: "todo", label: "To Do", color: "gray" },
        { id: "doing", label: "In Progress", color: "blue" },
        { id: "done", label: "Done", color: "green" },
      ],
    },
    note: "Option ids are yours to choose; a cell stores one optionId.",
  },
  people: { settings: "{}" },
  date: { settings: "{}" },
  numbers: {
    settings: "{ unit?: string, precision?: number }",
    example: { unit: "$", precision: 2 },
  },
  dropdown: {
    settings: "{ options: [{ id: string, label: string, color: string }] }",
    example: {
      options: [
        { id: "opt1", label: "Option 1", color: "blue" },
        { id: "opt2", label: "Option 2", color: "purple" },
      ],
    },
    note: "Same shape as status; a cell may select multiple option ids (optionIds[]).",
  },
  checkbox: { settings: "{}" },
  rating: { settings: "{}", note: "Cell values are an integer 1-5." },
  link: { settings: "{}" },
  email: { settings: "{}" },
  phone: { settings: "{}" },
  files: {
    settings: "{}",
    note: "Content lives in attachments, not settings — use the attach_file tool.",
  },
  time_tracking: { settings: "{}" },
  relation: {
    settings: "{ target_board_id: string, allow_multiple?: boolean }",
    note: "The target board must be one you can read. allow_multiple defaults to true. Link rows with the item tools, not with a cell value.",
  },
  mirror: {
    settings: "{ source_relation_column_id: string, target_column_id: string }",
    note: "Read-only: rolls up target_column_id's value from the item(s) linked via source_relation_column_id, which must be a relation column on this board.",
  },
  percent: { settings: "{}", note: "Cell values are a number 0-100." },
  currency: {
    settings: "{ currency: string, dirham_sign?: boolean }",
    example: { currency: "USD" },
    note: 'One currency per column (not per cell) so sums stay single-currency. currency must be one of a curated ISO 4217 list (majors + GCC + common regionals). dirham_sign only matters when currency is "AED"; absent means on.',
  },
  priority: {
    settings: "{}",
    note: 'Cell values are "normal" or "critical".',
  },
};

/** One entry per `viewKindSchema` option, derived from `configSchemaForKind(kind)`
 *  in `src/lib/validations/view-actions.ts`. Not anti-drift tested (view
 *  creation isn't wired to an MCP tool yet), but kept honest to the real
 *  per-kind config schema: field names are the snake_case jsonb keys
 *  `updateBoardView`'s `config` accepts, not a guessed camelCase shape. */
export const VIEW_TYPE_SCHEMA: Record<string, SchemaEntry> = {
  table: { settings: "{}", note: "The default view; config may be empty." },
  kanban: {
    settings: "{ group_column_id?: string | null }",
    note: "Should name a status or dropdown column on the same board; omitted or null means no grouping.",
  },
  calendar: {
    settings: "{ date_column_id?: string | null }",
    note: "Should name a date column on the same board.",
  },
  timeline: {
    settings:
      '{ date_column_id?: string | null, end_column_id?: string | null, color_column_id?: string | null, zoom?: "week" | "month" | "quarter" | "year" }',
    note: 'date_column_id/end_column_id accept a date column id, or the sentinel "__created_at__" / "__updated_at__" to plot the item timestamp instead of a column; color_column_id should be a status or dropdown column.',
  },
};

/** Six kinds: number, chart, battery, list, completion, health. Derived from
 *  `configSchemaForKind(kind)` in `src/lib/validations/dashboards.ts`. The
 *  test fails until all six are here. */
export const WIDGET_KIND_SCHEMA: Record<string, SchemaEntry> = {
  number: {
    settings: '{ agg: "count" | "sum" | "avg", valueColumnId?: string }',
    example: { agg: "count" },
    note: "valueColumnId is required for sum and avg, and must be a numbers column.",
  },
  chart: {
    settings:
      '{ chartType: "bar" | "stackedBar" | "groupedBar" | "line" | "area" | "combo" | "pie" | "donut" | "radial", ' +
      'primary: { kind: "status" | "dropdown" | "people" | "date", columnId?: string, bucket?: "day" | "week" | "month" }, ' +
      "series?: <same shape as primary>, " +
      'measure?: { agg: "count" | "sum" | "avg", valueColumnId?: string }, ' +
      'comboMap?: { [seriesValue: string]: "bar" | "line" } }',
    example: {
      chartType: "bar",
      primary: { kind: "status" },
      measure: { agg: "count" },
    },
    note: 'primary.columnId (and series.columnId) is required except when kind is "date", which defaults to created_at; bucket only applies to "date". measure.valueColumnId is required for sum/avg and defaults to { agg: "count" }. comboMap only applies when chartType is "combo".',
  },
  battery: {
    settings: "{ groupColumnId: string }",
    note: "groupColumnId is required and should be a status or dropdown column; the widget shows one bar per option, counting items.",
  },
  list: {
    settings:
      '{ columnIds?: string[], limit?: number, filter?: { combinator?: "and" | "or", conditions?: [{ columnId: string, operator: string, value?: string | number | null }] } }',
    example: { limit: 10 },
    note: 'columnIds picks up to 8 columns to show as sub-values on each row. limit is 1-100 (default 25). filter.conditions is capped at 10; operator is one of "is", "is_not", "contains", "eq", "num_eq", "num_ne", "gt", "lt", "before", "after", "on", "is_empty", "not_empty" — applicability depends on the column\'s kind, and value is unused for is_empty/not_empty.',
  },
  completion: {
    settings:
      '{ mode: "percent" | "status", percentColumnId?: string, statusColumnId?: string, doneOptionIds?: string[] }',
    example: { mode: "percent", percentColumnId: "<a percent column id>" },
    note: '"percent" mode requires percentColumnId (a percent column). "status" mode requires statusColumnId plus at least one id in doneOptionIds naming which of that column\'s options count as done.',
  },
  health: {
    settings: "{}",
    note: "No configurable settings; the completeness/overdue rule is fixed.",
  },
};

/** The four values of `ReportScope` (`src/lib/reports/queries.ts`) and the
 *  id each one requires alongside it. */
export const REPORT_SHAPE_SCHEMA: Record<string, SchemaEntry> = {
  board: {
    settings: '{ scope: "board", boardId: string }',
    example: { scope: "board", boardId: "<a board id>" },
  },
  boards: {
    settings: '{ scope: "boards", boardIds: string[] }',
    note: "Every board must be one you can read.",
  },
  portfolio: {
    settings: '{ scope: "portfolio", portfolioId: string }',
  },
  template: {
    settings: '{ scope: "template" }',
    note: "A saved shape with no bound data; bind it when you create from it.",
  },
};

const TOPIC_DATA: Record<Exclude<SchemaTopic, "all">, unknown> = {
  column_kinds: COLUMN_KIND_SCHEMA,
  view_types: VIEW_TYPE_SCHEMA,
  widget_kinds: WIDGET_KIND_SCHEMA,
  report_shapes: REPORT_SHAPE_SCHEMA,
};

const describeSchemaInput = {
  topic: z.enum(SCHEMA_TOPICS).optional(),
};

const describeSchemaArgs = z.object({
  topic: z.enum(SCHEMA_TOPICS).optional(),
});

export const describeSchemaDescriptor: ToolDescriptor = {
  name: "describe_schema",
  title: "Describe schema",
  description:
    "Look up the settings shape and a working example for each column kind, " +
    "view type, widget kind and report shape. Call this before creating " +
    "columns, views, widgets or reports — the settings each one accepts " +
    "cannot be guessed. Reads no data and costs nothing.",
  inputSchema: describeSchemaInput,
  capability: null,
  scope: "none",
  invoke: async (_ctx, input) => {
    const parsed = parseAction(describeSchemaArgs, input);
    if (!parsed.ok) return parsed.result;
    const topic = parsed.value.topic ?? "all";
    const payload =
      topic === "all"
        ? TOPIC_DATA
        : { [topic]: TOPIC_DATA[topic as Exclude<SchemaTopic, "all">] };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  },
};
