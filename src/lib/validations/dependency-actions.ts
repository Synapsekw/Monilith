import { z } from "zod";

const uuid = z.string().uuid();

export const createDependencySchema = z.object({
  predecessorId: uuid,
  successorId: uuid,
});

export const deleteDependencySchema = z.object({ dependencyId: uuid });
