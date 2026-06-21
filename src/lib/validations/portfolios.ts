import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);

export const prioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const healthSchema = z.enum(["on_track", "at_risk", "off_track"]);
export const doneOptionIdsSchema = z.array(z.string().min(1)).max(50);

export const createPortfolioSchema = z.object({ name });
export const renamePortfolioSchema = z.object({ portfolioId: uuid, name });
export const deletePortfolioSchema = z.object({ portfolioId: uuid });

export const addBoardSchema = z.object({
  portfolioId: uuid,
  boardId: uuid,
  doneColumnId: uuid.nullable(),
  doneOptionIds: doneOptionIdsSchema,
});

export const removePlacementSchema = z.object({ placementId: uuid });

export const updatePlacementSchema = z.object({
  placementId: uuid,
  ownerUserId: uuid.nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  budget: z.number().finite().nonnegative().nullable().optional(),
  healthOverride: healthSchema.nullable().optional(),
  statusNote: z.string().trim().max(280).nullable().optional(),
});

export const updateMappingSchema = z.object({
  placementId: uuid,
  doneColumnId: uuid.nullable(),
  doneOptionIds: doneOptionIdsSchema,
});
