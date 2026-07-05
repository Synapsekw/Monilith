import { z } from "zod";
import {
  IMPORTABLE_KINDS,
  MAX_COLS,
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

const columnRole = z.enum(["name", "group", "data"]);

const columnTarget = z.union([
  z.object({ columnId: uuid }),
  z.literal("create"),
  z.literal("skip"),
]);

const columnSpec = z.object({
  sourceIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_COLS - 1),
  name: z.string().trim().min(1).max(100),
  kind: importableKind,
  options: z.array(synthOption).max(200),
  role: columnRole,
  target: columnTarget.optional(),
});

const importGroup = z.object({
  key: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  existingGroupId: uuid.nullable(),
});

const rowStructureEntry = z.object({
  gridIndex: z.number().int().min(0),
  groupKey: z.string().min(1),
  type: z.enum(["item", "subitem"]),
});

const importDestination = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("new"),
    workspaceId: uuid,
    boardName,
  }),
  z.object({
    type: z.literal("existing"),
    boardId: uuid,
  }),
]);

export const exportBoardSchema = z.object({
  boardId: uuid,
  format: importFormat,
});

export const previewImportSchema = z.object({
  fileBase64,
  fileName,
});

export const commitImportSchema = z
  .object({
    fileBase64,
    fileName,
    sheetName: z.string().min(1),
    headerRow: z.number().int().min(0).nullable(),
    excludedRows: z.array(z.number().int().min(0)),
    columns: z.array(columnSpec).min(1),
    groups: z.array(importGroup).min(1),
    structure: z.array(rowStructureEntry),
    destination: importDestination,
  })
  .superRefine((data, ctx) => {
    const nameCount = data.columns.filter((c) => c.role === "name").length;
    if (nameCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: 'Exactly one column must have role "name".',
        path: ["columns"],
      });
    }

    // Grouping is set in the Structure step, never via a column role.
    if (data.columns.some((c) => c.role === "group")) {
      ctx.addIssue({
        code: "custom",
        message:
          'Column role "group" is no longer supported; assign groups in the Structure step.',
        path: ["columns"],
      });
    }

    // Every structure row must reference a declared group key.
    const groupKeys = new Set(data.groups.map((g) => g.key));
    if (data.structure.some((s) => !groupKeys.has(s.groupKey))) {
      ctx.addIssue({
        code: "custom",
        message: "Every structured row must reference a declared group.",
        path: ["structure"],
      });
    }

    if (data.destination.type === "existing") {
      const missingTarget = data.columns.some(
        (c) => c.role === "data" && c.target === undefined,
      );
      if (missingTarget) {
        ctx.addIssue({
          code: "custom",
          message:
            'Every data column must have an explicit target (an existing column, "create", or "skip") when importing into an existing board.',
          path: ["columns"],
        });
      }
    }

    const sourceIndexes = data.columns.map((c) => c.sourceIndex);
    if (new Set(sourceIndexes).size !== sourceIndexes.length) {
      ctx.addIssue({
        code: "custom",
        message: "Column sourceIndexes must be distinct.",
        path: ["columns"],
      });
    }
  });

export type ExportBoardInput = z.infer<typeof exportBoardSchema>;
export type PreviewImportInput = z.infer<typeof previewImportSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
