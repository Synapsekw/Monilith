import { z } from "zod";

/** Server Action input boundary for touchBoardVisit(boardId). */
export const touchBoardVisitSchema = z.object({
  boardId: z.string().uuid(),
});
