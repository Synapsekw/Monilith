import { z } from "zod";

export const REPORT_CONFIG_VERSION = 1 as const;

export const blockTypeSchema = z.enum([
  "cover",
  "summary",
  "kpis",
  "table",
  "group_summaries",
  "spotlight",
  "notes",
  "appendix",
]);
export type BlockType = z.infer<typeof blockTypeSchema>;

const coverOptions = z.object({
  showLogo: z.boolean().default(true),
  preparedFor: z.string().max(200).default(""),
  preparedBy: z.string().max(200).default(""),
  dateRangeLabel: z.string().max(120).default(""),
});
const summaryOptions = z.object({
  text: z.string().max(8000).default(""),
  aiGenerated: z.boolean().default(false),
});
const tableOptions = z.object({
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  // null = include all columns (the default per the spec)
  columnIds: z.array(z.string()).nullable().default(null),
});
const spotlightOptions = z.object({
  itemIds: z.array(z.string()).default([]),
});
const notesOptions = z.object({
  text: z.string().max(8000).default(""),
});
const noOptions = z.object({});

export const blockSchema = z.discriminatedUnion("type", [
  // Zod 4: `.default({})` types its arg as the object's OUTPUT (required-after-
  // default fields), so `{}` fails to typecheck. `.prefault({})` takes an INPUT-
  // typed value and parses it, filling each field's inner default — same result,
  // typed correctly. Empty-option blocks keep `.default({})` (output is `{}`).
  z.object({
    type: z.literal("cover"),
    enabled: z.boolean().default(true),
    options: coverOptions.prefault({}),
  }),
  z.object({
    type: z.literal("summary"),
    enabled: z.boolean().default(true),
    options: summaryOptions.prefault({}),
  }),
  z.object({
    type: z.literal("kpis"),
    enabled: z.boolean().default(true),
    options: noOptions.default({}),
  }),
  z.object({
    type: z.literal("table"),
    enabled: z.boolean().default(true),
    options: tableOptions.prefault({}),
  }),
  z.object({
    type: z.literal("group_summaries"),
    enabled: z.boolean().default(true),
    options: noOptions.default({}),
  }),
  z.object({
    type: z.literal("spotlight"),
    enabled: z.boolean().default(false),
    options: spotlightOptions.prefault({}),
  }),
  z.object({
    type: z.literal("notes"),
    enabled: z.boolean().default(false),
    options: notesOptions.prefault({}),
  }),
  z.object({
    type: z.literal("appendix"),
    enabled: z.boolean().default(false),
    options: noOptions.default({}),
  }),
]);
export type ReportBlock = z.infer<typeof blockSchema>;

export const reportConfigSchema = z.object({
  v: z.literal(REPORT_CONFIG_VERSION).default(REPORT_CONFIG_VERSION),
  title: z.string().max(200).default("Status Report"),
  blocks: z.array(blockSchema).default([]),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

export function defaultReportConfig(): ReportConfig {
  return reportConfigSchema.parse({
    blocks: [
      { type: "cover" },
      { type: "summary" },
      { type: "kpis" },
      { type: "table" },
      { type: "group_summaries" },
      { type: "spotlight" },
      { type: "notes" },
      { type: "appendix" },
    ],
  });
}
