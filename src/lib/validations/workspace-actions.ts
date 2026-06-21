import { z } from "zod";

const name = z.string().trim().min(1).max(100);
const uuid = z.string().uuid();

export const createWorkspaceSchema = z.object({ name });
export const renameWorkspaceSchema = z.object({ workspaceId: uuid, name });
export const deleteWorkspaceSchema = z.object({ workspaceId: uuid });
