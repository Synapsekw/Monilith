import { z } from "zod";

const TEXT = z.string().trim().min(1, "Update cannot be empty").max(10_000);

export const addUpdateSchema = z.object({
  itemId: z.string().uuid(),
  text: TEXT,
  mentions: z.array(z.string().uuid()).default([]),
});

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid(),
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

const FILE_NAME = z.string().trim().min(1, "File name required").max(255);
const MIME = z.string().trim().min(1).max(255);
const SIZE = z.number().int().positive().max(52_428_800, "File exceeds 50 MB");
const STORAGE_PATH = z.string().min(1).max(1024);

export const createAttachmentSchema = z.object({
  itemId: z.string().uuid(),
  storagePath: STORAGE_PATH,
  fileName: FILE_NAME,
  mimeType: MIME,
  sizeBytes: SIZE,
  // Set for Files-column attachments; omitted for item-level attachments.
  columnId: z.string().uuid().optional(),
});

export const deleteAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const attachmentUrlSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const attachmentUrlsSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).max(60),
  // When set, additionally mint width/height-constrained image-transform URLs
  // (thumbnails) for the image rows — see getAttachmentPreviewUrls.
  thumb: z
    .object({
      width: z.number().int().positive().max(2000),
      height: z.number().int().positive().max(2000),
    })
    .optional(),
});

export const attachmentPdfUrlSchema = z.object({
  attachmentId: z.string().uuid(),
});

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentSchema>;
export type AttachmentUrlInput = z.infer<typeof attachmentUrlSchema>;
export type AttachmentUrlsInput = z.infer<typeof attachmentUrlsSchema>;
export type AttachmentPdfUrlInput = z.infer<typeof attachmentPdfUrlSchema>;
