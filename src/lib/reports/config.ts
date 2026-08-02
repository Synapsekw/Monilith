import { z } from "zod";

/**
 * The report-config schema version.
 *
 * DO NOT BUMP for a new block type or a new option — those are ADDITIVE and every
 * stored config still parses unchanged. Bumping breaks reads: `v` is a
 * `z.literal(REPORT_CONFIG_VERSION)`, so `v: 2` makes every stored `{"v":1,…}`
 * row fail to parse. Bump ONLY for a breaking reinterpretation of an existing
 * field (a rename, a retype, a changed meaning) — and ship a read-side upgrade
 * step in `parseReportConfig` in the same change.
 */
export const REPORT_CONFIG_VERSION = 1 as const;

export const blockTypeSchema = z.enum([
  "cover",
  "summary",
  "kpis",
  "chart",
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
const chartOptions = z.object({
  variant: z.enum(["donut", "bars"]).default("donut"),
  /**
   * "status"      → late-bound to the board's FIRST status column, resolved at
   *                 render time. Survives column renames and needs no board
   *                 knowledge to default.
   * "board_group" → the board's groups.
   * "column"      → the explicit `columnId` below.
   */
  source: z.enum(["status", "board_group", "column"]).default("status"),
  columnId: z.string().nullable().default(null),
  /** "" → derive "Items by <category name>" at render time. */
  title: z.string().max(120).default(""),
  maxCategories: z.number().int().min(3).max(6).default(6),
});
export type ChartBlockOptions = z.infer<typeof chartOptions>;
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
    type: z.literal("chart"),
    enabled: z.boolean().default(true),
    options: chartOptions.prefault({}),
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

/**
 * Canonical block order. Drives both `defaultReportConfig()` and the backfill's
 * insertion position (a missing block lands right after the last block that
 * precedes it here and is actually present).
 */
const BLOCK_ORDER = blockTypeSchema.options;

/** Where a missing `type` should be inserted into `blocks`. */
function insertPosition(blocks: ReportBlock[], type: BlockType): number {
  const precedes = new Set<string>(
    BLOCK_ORDER.slice(0, BLOCK_ORDER.indexOf(type)),
  );
  let pos = 0;
  blocks.forEach((b, i) => {
    if (precedes.has(b.type)) pos = i + 1;
  });
  return pos;
}

/**
 * Append every block type absent from `blocks`, DISABLED, in canonical position.
 * This is what makes a new block type reachable from reports saved before it
 * existed — without a data migration. Disabled on purpose: an existing saved
 * report's rendered output must not change until the user opts in.
 */
function backfillBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const out = [...blocks];
  for (const type of BLOCK_ORDER) {
    if (out.some((b) => b.type === type)) continue;
    out.splice(
      insertPosition(out, type),
      0,
      blockSchema.parse({ type, enabled: false }),
    );
  }
  return out;
}

const lenientEnvelope = z.object({
  title: z.string().max(200).catch("Status Report").default("Status Report"),
  blocks: z.array(z.unknown()).catch([]).default([]),
});

/**
 * READ path — deliberately lenient, and the ONLY thing that should parse a
 * `reports.config` value out of the database.
 *
 * Blocks that do not match the current union are DROPPED, not thrown on: after
 * a deploy is rolled back, a config saved by the newer build would otherwise
 * take down the whole reports list page, not just one report. Missing block
 * types are backfilled (disabled) so newly-shipped blocks reach old reports.
 *
 * The WRITE path (`saveReport`) keeps the strict `reportConfigSchema` — junk
 * never enters the database.
 */
export function parseReportConfig(raw: unknown): ReportConfig {
  const env = lenientEnvelope.safeParse(
    raw !== null && typeof raw === "object" ? raw : {},
  );
  const base = env.success ? env.data : { title: "Status Report", blocks: [] };
  const blocks: ReportBlock[] = [];
  for (const b of base.blocks) {
    const parsed = blockSchema.safeParse(b);
    if (parsed.success) blocks.push(parsed.data);
  }
  return {
    v: REPORT_CONFIG_VERSION,
    title: base.title,
    blocks: backfillBlocks(blocks),
  };
}

export function defaultReportConfig(): ReportConfig {
  return reportConfigSchema.parse({
    blocks: BLOCK_ORDER.map((type) => ({ type })),
  });
}
