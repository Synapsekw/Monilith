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
  }
}
