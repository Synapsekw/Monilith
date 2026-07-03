import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const title = z.string().trim().max(100);

export const widgetKindSchema = z.enum([
  "number",
  "chart",
  "battery",
  "list",
  "completion",
  "health",
]);

// ── per-kind config (D1 implements `number`; others are placeholders for D2/D3) ──
export const numberConfigSchema = z
  .object({
    agg: z.enum(["count", "sum", "avg"]),
    valueColumnId: uuid.optional(),
    display: z.enum(["plain", "gauge"]).default("plain"),
    target: z.number().positive().optional(),
  })
  .refine((c) => c.agg === "count" || !!c.valueColumnId, {
    message: "Sum and average need a numbers column.",
    path: ["valueColumnId"],
  });

export type NumberConfig = z.infer<typeof numberConfigSchema>;

export const chartTypeSchema = z.enum([
  "bar",
  "stackedBar",
  "groupedBar",
  "line",
  "area",
  "combo",
  "pie",
  "donut",
  "radial",
]);
export type ChartType = z.infer<typeof chartTypeSchema>;

export const seriesDimensionSchema = z.object({
  kind: z.enum(["status", "dropdown", "people", "date"]),
  columnId: uuid.optional(), // omitted for date-on-created_at
  bucket: z.enum(["day", "week", "month"]).optional(), // date only
});
export type SeriesDimension = z.infer<typeof seriesDimensionSchema>;

export const measureSchema = z
  .object({
    agg: z.enum(["count", "sum", "avg"]),
    valueColumnId: uuid.optional(),
  })
  .refine((m) => m.agg === "count" || !!m.valueColumnId, {
    message: "Sum and average need a numbers column.",
    path: ["valueColumnId"],
  });
export type Measure = z.infer<typeof measureSchema>;

export const chartConfigSchema = z.object({
  chartType: chartTypeSchema,
  primary: seriesDimensionSchema,
  series: seriesDimensionSchema.optional(),
  measure: measureSchema.default({ agg: "count" }),
  comboMap: z.record(z.string(), z.enum(["bar", "line"])).optional(),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

export const batteryConfigSchema = z.object({ groupColumnId: uuid });
export type BatteryConfig = z.infer<typeof batteryConfigSchema>;

// Completion widget: % complete per board group. percent mode averages a
// percent column; status mode measures the share of items whose status is in
// the "counts as done" option set (precedent: goals doneColumnId/doneOptionIds).
export const completionConfigSchema = z
  .object({
    mode: z.enum(["percent", "status"]),
    percentColumnId: uuid.optional(),
    statusColumnId: uuid.optional(),
    doneOptionIds: z.array(uuid).max(50).default([]),
  })
  .refine((c) => c.mode !== "percent" || !!c.percentColumnId, {
    message: "Percent mode needs a percent column.",
    path: ["percentColumnId"],
  })
  .refine((c) => c.mode !== "status" || !!c.statusColumnId, {
    message: "Status mode needs a status column.",
    path: ["statusColumnId"],
  })
  .refine((c) => c.mode !== "status" || c.doneOptionIds.length > 0, {
    message: "Pick at least one status that counts as done.",
    path: ["doneOptionIds"],
  });
export type CompletionConfig = z.infer<typeof completionConfigSchema>;

// Health summary widget: zero config beyond the source board — the structural-
// completeness/overdue rule is fixed (spec: 2026-07-03-health-summary-design.md).
export const healthConfigSchema = z.object({});
export type HealthConfig = z.infer<typeof healthConfigSchema>;

export const filterOperatorSchema = z.enum([
  "is",
  "is_not", // status
  "contains",
  "eq", // text
  "num_eq",
  "num_ne",
  "gt",
  "lt", // numbers
  "before",
  "after",
  "on", // date
  "is_empty",
  "not_empty", // any kind
]);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const filterConditionSchema = z.object({
  columnId: uuid,
  operator: filterOperatorSchema,
  // unused for is_empty / not_empty
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const listFilterSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(filterConditionSchema).max(10).default([]),
});
export type ListFilter = z.infer<typeof listFilterSchema>;

export const listConfigSchema = z.object({
  columnIds: z.array(uuid).max(8).default([]),
  limit: z.number().int().min(1).max(100).default(25),
  filter: listFilterSchema.optional(),
});
export type ListConfig = z.infer<typeof listConfigSchema>;

// Structural gate for the jsonb column; kind-specific shape is enforced in the
// action via configSchemaForKind(kind).
const configObject = z.record(z.string(), z.unknown());

export function configSchemaForKind(kind: z.infer<typeof widgetKindSchema>) {
  switch (kind) {
    case "number":
      return numberConfigSchema;
    case "chart":
      return chartConfigSchema;
    case "battery":
      return batteryConfigSchema;
    case "list":
      return listConfigSchema;
    case "completion":
      return completionConfigSchema;
    case "health":
      return healthConfigSchema;
    default:
      return configObject;
  }
}

// ── action inputs ──
export const createDashboardSchema = z.object({ workspaceId: uuid, name });
export const renameDashboardSchema = z.object({ dashboardId: uuid, name });
export const deleteDashboardSchema = z.object({ dashboardId: uuid });
export const duplicateDashboardSchema = z.object({ dashboardId: uuid });

export const createWidgetSchema = z.object({
  dashboardId: uuid,
  kind: widgetKindSchema,
  sourceBoardId: uuid,
  title: title.default(""),
  config: configObject,
});

export const updateWidgetConfigSchema = z.object({
  widgetId: uuid,
  title: title.optional(),
  sourceBoardId: uuid.optional(),
  config: configObject.optional(),
});

export const deleteWidgetSchema = z.object({ widgetId: uuid });

const gridRect = z.object({
  id: uuid,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

export const saveLayoutSchema = z.object({
  dashboardId: uuid,
  layouts: z.array(gridRect).max(100),
});

export const getWidgetDataSchema = z.object({ widgetId: uuid });

// Batched widget-data fetch: one round-trip for a whole dashboard's widgets.
// Bounded at 100 (matches saveLayout's cap) — the client only sends ids; RLS +
// a server-side re-read of the rows is the authorization boundary.
export const getWidgetsDataSchema = z.object({
  widgetIds: z.array(uuid).max(100),
});
