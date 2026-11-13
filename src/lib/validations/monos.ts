import * as z from "zod";

export const monoInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give your Mono a name.")
    .max(40, "Keep the name under 40 characters."),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour.")
    .transform((c) => c.toLowerCase()),
});
export type MonoInput = z.infer<typeof monoInputSchema>;

export const boardIdInputSchema = z.object({ boardId: z.string().uuid() });
