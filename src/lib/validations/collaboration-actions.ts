import { z } from "zod";

const TEXT = z.string().trim().min(1, "Update cannot be empty").max(10_000);

export const addUpdateSchema = z.object({
  itemId: z.string().uuid(),
  text: TEXT,
});

export const editUpdateSchema = z.object({
  updateId: z.string().uuid(),
  text: TEXT,
});

export const deleteUpdateSchema = z.object({
  updateId: z.string().uuid(),
});

export type AddUpdateInput = z.infer<typeof addUpdateSchema>;
export type EditUpdateInput = z.infer<typeof editUpdateSchema>;
export type DeleteUpdateInput = z.infer<typeof deleteUpdateSchema>;
