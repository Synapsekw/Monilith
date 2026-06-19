import { z } from "zod";
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
]);

// --- shared option shape (status + dropdown) ---
export const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
});
export type ColumnOption = z.infer<typeof optionSchema>;

// --- per-kind settings ---
export const emptySettingsSchema = z.object({}).strict();
export const statusSettingsSchema = z.object({
  options: z.array(optionSchema).default([]),
});
export const dropdownSettingsSchema = statusSettingsSchema;
export const numbersSettingsSchema = z.object({
  unit: z.string().optional(),
  precision: z.number().int().min(0).max(10).optional(),
});

export function columnSettingsSchema(kind: ColumnKind) {
  switch (kind) {
    case "status":
      return statusSettingsSchema;
    case "dropdown":
      return dropdownSettingsSchema;
    case "numbers":
      return numbersSettingsSchema;
    case "text":
    case "people":
    case "date":
    case "checkbox":
    case "rating":
    case "link":
    case "email":
    case "phone":
    case "files":
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
export const ratingValueSchema = z.object({
  rating: z.number().int().min(1).max(5),
});
export const linkValueSchema = z.object({
  url: z.string().url(),
  text: z.string().optional(),
});
export const emailValueSchema = z.object({ email: z.string().email() });
export const phoneValueSchema = z.object({
  phone: z.string().trim().min(1).max(40),
});
// Files store no cell_values row (content derives from attachments); this case
// exists only to keep the switch exhaustive and is never used by upsertCell.
export const filesValueSchema = z.object({}).strict();

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
  }
}
