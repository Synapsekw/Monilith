import { z } from "zod";
import { currencyCodeSchema } from "@/lib/boards/currency";
import type { Database } from "@/types/database.types";

export type ColumnKind = Database["public"]["Enums"]["column_kind"];

export const columnKindSchema = z.enum([
  "text",
  "status",
  "people",
  "date",
  "numbers",
  "dropdown",
  "checkbox",
  "rating",
  "link",
  "email",
  "phone",
  "files",
  "time_tracking",
  "relation",
  "mirror",
  "percent",
  "currency",
]);

// --- shared option shape (status + dropdown) ---
export const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
});
export type ColumnOption = z.infer<typeof optionSchema>;

// --- aggregation catalogue (6d-3) ---
// Every column may opt into a single column-summary footer aggregation, stored
// snake_case in columns.settings jsonb (no migration — see 6d-3 spec). The set
// below is the full vocabulary; `allowedAggregations(kind)` in
// `@/lib/boards/aggregation` defines which apply to each kind.
export const aggregationSchema = z.enum([
  // count family — universal (presence-based)
  "count",
  "count_filled",
  "count_empty",
  "count_unique",
  // numeric
  "sum",
  "avg",
  "min",
  "max",
  // categorical
  "distribution",
  // checkbox
  "checked_total",
  "percent_checked",
  // date
  "date_range",
  "earliest",
  "latest",
  // time tracking
  "total_tracked",
  "total_over_estimate",
]);
export type AggregationId = z.infer<typeof aggregationSchema>;

// Shared base merged into every per-kind settings schema so any column can carry
// a chosen footer aggregation. Optional + backward-compatible (columns created
// before 6d-3 simply omit it).
export const baseColumnSettingsSchema = z.object({
  summary_aggregation: aggregationSchema.optional(),
});

// --- per-kind settings ---
// `.strict()` is applied AFTER extending the base so the optional
// `summary_aggregation` is accepted while unknown keys are still rejected
// (zod 4's `.strict().merge()` drops strictness — see 6d-3 build notes).
export const emptySettingsSchema = baseColumnSettingsSchema.strict();
export const statusSettingsSchema = baseColumnSettingsSchema.extend({
  options: z.array(optionSchema).default([]),
});
export const dropdownSettingsSchema = statusSettingsSchema;
export const numbersSettingsSchema = baseColumnSettingsSchema.extend({
  unit: z.string().optional(),
  precision: z.number().int().min(0).max(10).optional(),
});
// Currency column: fixed ISO 4217 code per column (never per cell) so sums
// are always single-currency — the summary-row feature depends on this.
// Stored snake_case in columns.settings jsonb, e.g. { "currency": "KWD" }.
// dirham_sign (AED only): show the new U+20C3 dirham sign glyph in rendered
// surfaces. Optional; ABSENT MEANS ON (see dirhamSignEnabled, spec §5.4).
export const currencySettingsSchema = baseColumnSettingsSchema.extend({
  currency: currencyCodeSchema,
  dirham_sign: z.boolean().optional(),
});
// Relation column connects to one target board; cells may link one or many
// items from it. Stored snake_case in columns.settings jsonb.
export const relationSettingsSchema = baseColumnSettingsSchema.extend({
  target_board_id: z.string().uuid(),
  allow_multiple: z.boolean().default(true),
});

// Mirror column rolls up a field from the target board of a relation column on
// this board: it reads `source_relation_column_id`'s links and shows each linked
// item's `target_column_id` value. Read-only; stored snake_case in settings jsonb.
export const mirrorSettingsSchema = baseColumnSettingsSchema.extend({
  source_relation_column_id: z.string().uuid(),
  target_column_id: z.string().uuid(),
});

export function columnSettingsSchema(kind: ColumnKind) {
  switch (kind) {
    case "status":
      return statusSettingsSchema;
    case "dropdown":
      return dropdownSettingsSchema;
    case "numbers":
      return numbersSettingsSchema;
    case "relation":
      return relationSettingsSchema;
    case "mirror":
      return mirrorSettingsSchema;
    case "currency":
      return currencySettingsSchema;
    case "text":
    case "people":
    case "date":
    case "checkbox":
    case "rating":
    case "link":
    case "email":
    case "phone":
    case "files":
    case "time_tracking":
    case "percent":
      return emptySettingsSchema;
  }
}

// --- per-kind cell values ---
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date");

export const textValueSchema = z.object({ text: z.string() });
export const statusValueSchema = z.object({
  optionId: z.string().nullable(),
});
export const dropdownValueSchema = z.object({
  optionIds: z.array(z.string()),
});
export const peopleValueSchema = z.object({
  userIds: z.array(z.string()),
});
export const dateValueSchema = z.object({
  date: isoDate,
  end: isoDate.optional(),
});
export const numbersValueSchema = z.object({
  n: z.number().finite(),
});
export const checkboxValueSchema = z.object({ checked: z.boolean() });
// Percent cells store a manually-set completion 0..100. Parent rows roll up the
// average of their subitems' percent values when collapsed (see rollupCell).
export const percentValueSchema = z.object({
  percent: z.number().min(0).max(100),
});
// Currency cells store a plain decimal amount; the editor rounds to the
// column currency's minor units at commit (roundToCurrency), so stored
// values never carry sub-minor-unit precision. See spec §3.2.
export const currencyValueSchema = z.object({
  amount: z.number().finite(),
});
export const ratingValueSchema = z.object({
  rating: z.number().int().min(1).max(5),
});
/**
 * `z.string().url()` and `new URL()` both accept `javascript:`, `mailto:`, etc.
 * Link cells render an `<a href>` that any board viewer can click, so the scheme
 * MUST be restricted to http(s) to prevent stored XSS (spec §3.1).
 */
export function isHttpUrl(u: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
}
export const linkValueSchema = z.object({
  url: z.string().url().refine(isHttpUrl, "URL must be http or https"),
  text: z.string().optional(),
});
export const emailValueSchema = z.object({ email: z.string().email() });
export const phoneValueSchema = z.object({
  phone: z.string().trim().min(1).max(40),
});
// Files store no cell_values row (content derives from attachments); this case
// exists only to keep the switch exhaustive and is never used by upsertCell.
export const filesValueSchema = z.object({}).strict();

// Time-tracking cells store only the optional per-item estimate; the tracked
// total derives from the time_entries table (not from cell_values).
export const timeTrackingValueSchema = z.object({
  estimateSeconds: z.number().int().positive(),
});

// Relation cells store no cell_values row (content derives from relation_links);
// this case exists only to keep the switch exhaustive and is never used by upsertCell.
export const relationValueSchema = z.object({}).strict();

// Mirror cells store no cell_values row (content derives from relation_links +
// the target board's cell_values); this case exists only to keep the switch
// exhaustive and is never used by upsertCell.
export const mirrorValueSchema = z.object({}).strict();

export function cellValueSchema(kind: ColumnKind) {
  switch (kind) {
    case "text":
      return textValueSchema;
    case "status":
      return statusValueSchema;
    case "dropdown":
      return dropdownValueSchema;
    case "people":
      return peopleValueSchema;
    case "date":
      return dateValueSchema;
    case "numbers":
      return numbersValueSchema;
    case "checkbox":
      return checkboxValueSchema;
    case "percent":
      return percentValueSchema;
    case "currency":
      return currencyValueSchema;
    case "rating":
      return ratingValueSchema;
    case "link":
      return linkValueSchema;
    case "email":
      return emailValueSchema;
    case "phone":
      return phoneValueSchema;
    case "files":
      return filesValueSchema;
    case "time_tracking":
      return timeTrackingValueSchema;
    case "relation":
      return relationValueSchema;
    case "mirror":
      return mirrorValueSchema;
  }
}
