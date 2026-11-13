// Client-safe (no server-only): imported by the stream protocol, the tool
// trace schema and the confirm card.
import { z } from "zod";

/** Hard cap on staged changes in one assistant turn. */
export const MAX_STAGED_CALLS = 50;

export const stagedCallSchema = z.object({
  /** Server-minted UUID. Unique within a turn. */
  id: z.string().min(1).max(200),
  tool: z.string().min(1).max(100),
  input: z.record(z.string(), z.unknown()),
  /** Plain-language description shown on the card. */
  summary: z.string().max(500),
  destructive: z.boolean(),
  /** The board this call addresses, when it addresses one. */
  boardId: z.string().uuid().nullable(),
});
export type StagedCall = z.infer<typeof stagedCallSchema>;

export const stagedResultSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  /** True when the user unticked the row. Not a failure. */
  skipped: z.boolean().optional(),
  error: z.string().optional(),
});
export type StagedResult = z.infer<typeof stagedResultSchema>;
