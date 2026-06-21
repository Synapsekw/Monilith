import { z } from "zod";

export const shareBoardSchema = z.object({
  boardId: z.string().uuid(),
  userId: z.string().uuid(),
  access: z.enum(["viewer", "editor"]),
});

export const unshareBoardSchema = z.object({
  boardId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type ShareBoardInput = z.infer<typeof shareBoardSchema>;
export type UnshareBoardInput = z.infer<typeof unshareBoardSchema>;
