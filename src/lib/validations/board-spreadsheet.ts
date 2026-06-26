import { z } from "zod";
import {
  IMPORTABLE_KINDS,
  type ImportableKind,
} from "@/lib/boards/spreadsheet/types";

const uuid = z.string().uuid();
const boardName = z.string().trim().min(1).max(100);
const fileBase64 = z.string().min(1);
const fileName = z.string().min(1);
const importFormat = z.enum(["xlsx", "csv"]);

// Zod 4: z.enum requires a tuple literal, not a plain array
const importableKindValues = IMPORTABLE_KINDS as [
  ImportableKind,
  ...ImportableKind[],
];
const importableKind = z.enum(importableKindValues);

const synthOption = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
});

const columnMapping = z.object({
  header: z.string(),
  kind: importableKind,
  options: z.array(synthOption),
});

export const exportBoardSchema = z.object({
  boardId: uuid,
  format: importFormat,
});

export const previewImportSchema = z.object({
  fileBase64,
  fileName,
});

export const commitImportSchema = z.object({
  fileBase64,
  fileName,
  workspaceId: uuid,
  boardName,
  columnMappings: z.array(columnMapping).min(1),
});

export type ExportBoardInput = z.infer<typeof exportBoardSchema>;
export type PreviewImportInput = z.infer<typeof previewImportSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
