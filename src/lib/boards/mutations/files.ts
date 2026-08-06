"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createAttachment,
  deleteAttachment,
} from "@/lib/collaboration/actions";
import { createClient } from "@/lib/supabase/client";
import { buildColumnFilePath } from "@/lib/collaboration/attachments-path";
import { MAX_FILE_BYTES } from "@/lib/collaboration/use-attachment-mutations";
import {
  prependColumnFile,
  removeColumnFile,
  type BoardCache,
  type CacheAttachment,
} from "@/lib/boards/cache";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { BoardMutationCtx, Ctx } from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

/** Files-column attachment mutations: upload + delete. */
export function useColumnFileMutations(ctx: BoardMutationCtx) {
  const { qc, key, boardId, rollback } = ctx;

  /**
   * Upload a file into a Files-column cell. Client-direct upload to the
   * `attachments` bucket (mirrors `useAttachmentMutations`), then registers the
   * metadata row via `createAttachment` with the column id. On success the real
   * row is constructed from known fields + the returned id and prepended into
   * the board cache; the Realtime INSERT echo is idempotent via
   * `prependColumnFile`. Non-optimistic insert (we wait for the server id), but
   * a failed register cleans up the orphaned object.
   */
  const uploadColumnFileMutation = useMutation<
    { attachment: CacheAttachment },
    Error,
    { itemId: string; columnId: string; file: File }
  >({
    mutationFn: async ({ itemId, columnId, file }) => {
      assertOnline();
      if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 50 MB.");
      if (file.size === 0) throw new Error("File is empty.");

      const cache = qc.getQueryData<BoardCache>(key);
      if (!cache) throw new Error("Board not loaded.");
      const orgId = cache.board.org_id;
      const path = buildColumnFilePath({
        orgId,
        boardId,
        itemId,
        columnId,
        fileName: file.name,
      });
      const mimeType = file.type || "application/octet-stream";

      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, file, { contentType: mimeType });
      if (upErr) throw new Error(upErr.message);

      const res = await createAttachment({
        itemId,
        columnId,
        storagePath: path,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
      if (!res.ok) {
        // Best-effort orphan cleanup if the register failed.
        await supabase.storage.from("attachments").remove([path]);
        throw new Error(res.error);
      }

      // Resolve the uploader for the cache row (create returns only the id).
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const attachment: CacheAttachment = {
        id: res.data.attachmentId,
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: columnId,
        update_id: null,
        uploaded_by: user?.id ?? "",
        storage_path: path,
        file_name: file.name,
        mime_type: mimeType,
        size_bytes: file.size,
        created_at: new Date().toISOString(),
      } as CacheAttachment;
      return { attachment };
    },
    onSuccess: ({ attachment }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? prependColumnFile(prev, attachment) : prev,
      );
    },
    onError: (err) => {
      showMutationError("Couldn't upload the file.", err);
    },
  });

  /** Delete a Files-column attachment. Optimistic remove; rollback on error. */
  const deleteColumnFileMutation = useMutation<
    unknown,
    Error,
    { attachmentId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await deleteAttachment(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return {};
      const prior = previous.attachments.find(
        (a) => a.id === vars.attachmentId,
      );
      qc.setQueryData<BoardCache>(
        key,
        removeColumnFile(previous, vars.attachmentId),
      );
      return { rollback: (c) => (prior ? prependColumnFile(c, prior) : c) };
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError("Couldn't delete the file — it was restored.", err);
    },
  });

  return { uploadColumnFileMutation, deleteColumnFileMutation };
}
