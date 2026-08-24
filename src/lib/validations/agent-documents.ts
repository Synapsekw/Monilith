import { z } from "zod";
import type { SourceFormat } from "@/lib/documents/extract-text";

/**
 * Kept in lockstep with `SourceFormat` (src/lib/documents/extract-text.ts) via
 * the `satisfies` check below — if that union ever grows or shrinks, this file
 * fails to typecheck instead of silently drifting from the real extractor set.
 */
export const SOURCE_FORMATS = [
  "pasted",
  "markdown",
  "text",
  "pdf",
  "docx",
  "xlsx",
] as const satisfies readonly SourceFormat[];

/** Matches the column check constraints exactly — the DB is the backstop, not
 *  the first line of defence. */
export const documentInputSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200),
  body: z.string().min(1, "A document can't be empty.").max(2_000_000),
  sourceFormat: z.enum(SOURCE_FORMATS),
  sourceFileName: z.string().max(255).nullable().default(null),
});

export const documentUpdateSchema = documentInputSchema
  .partial({ sourceFormat: true, sourceFileName: true })
  .extend({ id: z.string().uuid() });

export const setAgentDocumentsSchema = z.object({
  userAgentId: z.string().uuid(),
  documentIds: z.array(z.string().uuid()).max(50),
});
