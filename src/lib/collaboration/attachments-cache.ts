import type { Tables } from "@/types/database.types";

export type Attachment = Tables<"attachments">;
export type AttachmentsCache = { attachments: Attachment[] };

export function prependAttachment(
  c: AttachmentsCache,
  row: Attachment,
): AttachmentsCache {
  if (c.attachments.some((x) => x.id === row.id)) return c;
  return { attachments: [row, ...c.attachments] };
}

export function removeAttachment(
  c: AttachmentsCache,
  id: string,
): AttachmentsCache {
  return { attachments: c.attachments.filter((x) => x.id !== id) };
}
