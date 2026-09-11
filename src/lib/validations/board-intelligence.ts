import { z } from "zod";

/** Server Action input boundary for touchBoardVisit(boardId). */
export const touchBoardVisitSchema = z.object({
  boardId: z.string().uuid(),
});

/** A single before-value captured by `apply_intelligence_cells` for Undo. */
export const beforeValueSchema = z.object({
  itemId: z.string().uuid(),
  columnId: z.string().uuid(),
  value: z.unknown(),
});

/** Server Action input boundary for applySuggestion(...). */
export const applySuggestionSchema = z.object({
  runId: z.string().uuid(),
  suggestionId: z.string().min(1).max(8),
  actionIndex: z.number().int().min(0).max(1),
});

/** Server Action input boundary for revertSuggestion(...). */
export const revertSuggestionSchema = z.object({
  runId: z.string().uuid(),
  suggestionId: z.string().min(1).max(8),
  before: z.array(beforeValueSchema).max(50),
  updateIds: z.array(z.string().uuid()).max(5),
});
