import { z } from "zod";

/** KPI cards the built-in `kpis` section can show. Spec 1 keeps the existing
 *  closed set; column-derived metrics arrive in spec 2 as widget sections. */
export const KPI_KEYS = [
  "complete",
  "gap",
  "overdue",
  "dueThisWeek",
  "blocked",
  "stale",
] as const;
export const kpiKeySchema = z.enum(KPI_KEYS);
export type KpiKey = z.infer<typeof kpiKeySchema>;

export const BUILTIN_PANELS = [
  "kpis",
  "burn",
  "boardStatus",
  "attention",
  "intelligence",
  "milestones",
] as const;
export const builtinPanelSchema = z.enum(BUILTIN_PANELS);
export type BuiltinPanel = z.infer<typeof builtinPanelSchema>;

export const TAB_KINDS = ["canvas", "stages", "boards", "people"] as const;
export const tabKindSchema = z.enum(TAB_KINDS);
export type TabKind = z.infer<typeof tabKindSchema>;

/** Singleton tabs: hideable, never duplicated. */
const SINGLETON_KINDS = ["stages", "boards", "people"] as const;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const label = z.string().trim().min(1).max(24);

/** 12-column rect, same math as `GridRect` in `src/lib/dashboards/cache.ts`.
 *  Spec 1 renders from `x`/`w` (CSS Grid column placement) and stores `y`/`h`
 *  untouched so spec 2's widget canvas inherits a complete rect. */
export const gridRectSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});
export type GridRect = z.infer<typeof gridRectSchema>;

const builtinSectionSchema = z.object({
  id: slug,
  type: z.literal("builtin"),
  panel: builtinPanelSchema,
  title: label.optional(),
  props: z.object({ cards: z.array(kpiKeySchema).min(1).max(6) }).optional(),
  layout: gridRectSchema,
});

const widgetSectionSchema = z.object({
  id: slug,
  type: z.literal("widget"),
  widgetId: z.string().uuid(),
  layout: gridRectSchema,
});

export const sectionSchema = z.discriminatedUnion("type", [
  builtinSectionSchema,
  widgetSectionSchema,
]);
export type LayoutSection = z.infer<typeof sectionSchema>;

export const tabSchema = z.object({
  id: slug,
  label,
  kind: tabKindSchema,
  sections: z.array(sectionSchema).max(24).optional(),
});
export type LayoutTab = z.infer<typeof tabSchema>;

export const folderLayoutConfigSchema = z
  .object({ v: z.literal(1), tabs: z.array(tabSchema).min(1).max(6) })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    const kinds = new Set<string>();
    for (const tab of cfg.tabs) {
      if (ids.has(tab.id))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate tab id: ${tab.id}`,
          path: ["tabs"],
        });
      ids.add(tab.id);
      if ((SINGLETON_KINDS as readonly string[]).includes(tab.kind)) {
        if (kinds.has(tab.kind))
          ctx.addIssue({
            code: "custom",
            message: `Duplicate ${tab.kind} tab`,
            path: ["tabs"],
          });
        kinds.add(tab.kind);
      }
      if (tab.kind !== "canvas" && tab.sections && tab.sections.length > 0)
        ctx.addIssue({
          code: "custom",
          message: "Only canvas tabs hold sections",
          path: ["tabs"],
        });
      const sectionIds = new Set<string>();
      for (const s of tab.sections ?? []) {
        if (sectionIds.has(s.id))
          ctx.addIssue({
            code: "custom",
            message: `Duplicate section id: ${s.id}`,
            path: ["tabs"],
          });
        sectionIds.add(s.id);
        if (s.type !== "builtin") continue;
        if (s.panel === "kpis" && !s.props)
          ctx.addIssue({
            code: "custom",
            message: "kpis section needs props.cards",
            path: ["tabs"],
          });
        if (s.panel !== "kpis" && s.props)
          ctx.addIssue({
            code: "custom",
            message: `${s.panel} section takes no props`,
            path: ["tabs"],
          });
      }
    }
  });
export type FolderLayoutConfig = z.infer<typeof folderLayoutConfigSchema>;

/** Input to the one mutation. `version` is the optimistic-concurrency token the
 *  client read with the payload; 0 means "no row yet, insert". */
export const saveFolderLayoutSchema = z.object({
  folderId: z.string().uuid(),
  version: z.number().int().min(0),
  preset: z.enum(["project", "crm", "support", "blank"]),
  config: folderLayoutConfigSchema,
});
