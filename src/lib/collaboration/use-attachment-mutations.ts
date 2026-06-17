"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  createAttachment,
  deleteAttachment,
} from "@/lib/collaboration/actions";
import { buildStoragePath } from "@/lib/collaboration/attachments-path";
import {
  prependAttachment,
  removeAttachment,
  type Attachment,
  type AttachmentsCache,
} from "@/lib/collaboration/attachments-cache";
import { itemAttachmentsKey } from "@/lib/collaboration/use-item-attachments";

export const MAX_FILE_BYTES = 52_428_800; // 50 MB

type UploadVars = { file: File };
type UploadCtx = {
  previous?: AttachmentsCache;
  optimisticId?: string;
  path?: string;
};
type RemoveVars = { attachmentId: string };
type RemoveCtx = { previous?: AttachmentsCache };

export function useAttachmentMutations(
  itemId: string,
  uploaderId: string,
  ctx: { orgId: string; boardId: string },
) {
  const qc = useQueryClient();
  const key = itemAttachmentsKey(itemId);

  const upload = useMutation<
    { attachmentId: string },
    Error,
    UploadVars,
    UploadCtx
  >({
    mutationFn: async ({ file }) => {
      if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 50 MB.");
      if (file.size === 0) throw new Error("File is empty.");
      const path = buildStoragePath({
        orgId: ctx.orgId,
        boardId: ctx.boardId,
        itemId,
        fileName: file.name,
      });
      // Client-direct upload (authorized by the Storage INSERT policy).
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (upErr) throw new Error(upErr.message);
      // Register the metadata row.
      const res = await createAttachment({
        itemId,
        storagePath: path,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!res.ok) {
        // Best-effort orphan cleanup if the register failed.
        await supabase.storage.from("attachments").remove([path]);
        throw new Error(res.error);
      }
      return res.data;
    },
    onMutate: async ({ file }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AttachmentsCache>(key);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const path = buildStoragePath({
        orgId: ctx.orgId,
        boardId: ctx.boardId,
        itemId,
        fileName: file.name,
      });
      const optimistic: Attachment = {
        id: optimisticId,
        org_id: ctx.orgId,
        board_id: ctx.boardId,
        item_id: itemId,
        update_id: null,
        uploaded_by: uploaderId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        created_at: new Date().toISOString(),
      } as Attachment;
      qc.setQueryData<AttachmentsCache>(
        key,
        prependAttachment(previous ?? { attachments: [] }, optimistic),
      );
      return { previous, optimisticId, path };
    },
    onError: (_e, _v, c) => {
      qc.setQueryData<AttachmentsCache>(key, (prev) =>
        c?.optimisticId && prev ? removeAttachment(prev, c.optimisticId) : prev,
      );
    },
    onSuccess: () => {
      // Refetch authoritative list rather than swap the optimistic id — the
      // Realtime INSERT echo can prepend the real row first and the id-swap
      // would duplicate it (staleTime: Infinity would never heal). Same
      // reasoning as use-update-mutations.
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const remove = useMutation<void, Error, RemoveVars, RemoveCtx>({
    mutationFn: async ({ attachmentId }) => {
      const res = await deleteAttachment({ attachmentId });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async ({ attachmentId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AttachmentsCache>(key);
      if (previous)
        qc.setQueryData<AttachmentsCache>(
          key,
          removeAttachment(previous, attachmentId),
        );
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
  });

  return {
    uploadFile: (file: File) => upload.mutate({ file }),
    deleteAttachment: (attachmentId: string) => remove.mutate({ attachmentId }),
    isUploading: upload.isPending,
    uploadError: upload.error?.message ?? null,
  };
}
