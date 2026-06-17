import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const title = z.string().trim().max(100);

export const widgetKindSchema = z.enum(["number", "chart", "battery", "list"]);

// ── per-kind config (D1 implements `number`; others are placeholders for D2/D3) ──
export const numberConfigSchema = z
  .object({
    agg: z.enum(["count", "sum", "avg"]),
    valueColumnId: uuid.optional(),
  })
  .refine((c) => c.agg === "count" || !!c.valueColumnId, {
    message: "Sum and average need a numbers column.",
    path: ["valueColumnId"],
  });

export type NumberConfig = z.infer<typeof numberConfigSchema>;

// Structural gate for the jsonb column; kind-specific shape is enforced in the
// action via configSchemaForKind(kind).
const configObject = z.record(z.string(), z.unknown());

export function configSchemaForKind(kind: z.infer<typeof widgetKindSchema>) {
  switch (kind) {
    case "number":
      return numberConfigSchema;
    // D2/D3 add chart/battery/list; until then accept any object.
    default:
      return configObject;
  }
}

// ── action inputs ──
export const createDashboardSchema = z.object({ workspaceId: uuid, name });
export const renameDashboardSchema = z.object({ dashboardId: uuid, name });
export const deleteDashboardSchema = z.object({ dashboardId: uuid });

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
