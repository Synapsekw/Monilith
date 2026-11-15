import * as z from "zod";

const uuid = z.string().uuid();
const level = z.enum(["viewer", "editor"]);

export const folderAccessSchema = z.object({ folderId: uuid });
export const shareFolderSchema = z.object({
  folderId: uuid,
  userId: uuid,
  level,
});
export const unshareFolderSchema = z.object({ folderId: uuid, userId: uuid });
export const inviteToFolderSchema = z.object({
  folderId: uuid,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { message: "Enter a valid email address" })
    .email({ message: "Enter a valid email address" }),
  level,
});
export const revokeFolderInvitationSchema = z.object({
  folderId: uuid,
  invitationId: uuid,
});
