import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildColumnFilePath,
  buildStoragePath,
} from "@/lib/collaboration/attachments-path";
import {
  attachmentPathPrefix,
  createAttachmentCore,
  resolveItemScope,
} from "@/lib/collaboration/attachment-core";
import type { GetClient, ToolResult } from "./shared";

/** Decoded-bytes ceiling for the inline branch. Base64 costs ~1.37 tokens/byte,
 *  so 128 KB is ~44k tokens in one tool call — the point where a bigger file
 *  should go through create_attachment_upload instead. */
const MAX_INLINE_BYTES = 131_072;
const DEFAULT_MIME = "application/octet-stream";

const attachFileInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255).optional(),
  storagePath: z.string().min(1).max(1024).optional(),
  contentBase64: z.string().optional(),
};

type AttachFileInput = {
  itemId: string;
  columnId?: string;
  fileName: string;
  mimeType?: string;
  storagePath?: string;
  contentBase64?: string;
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Strict base64: `Buffer.from` silently ignores junk, which would let a
 *  malformed body through as a shorter file than the agent intended. */
function decodeBase64(raw: string): Buffer | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  return Buffer.from(cleaned, "base64");
}

export async function attachFileHandler(
  getClient: GetClient,
  input: AttachFileInput,
  actorId: string,
): Promise<ToolResult> {
  const hasPath = input.storagePath !== undefined;
  const hasInline = input.contentBase64 !== undefined;
  if (hasPath === hasInline)
    return err(
      "Provide exactly one of `storagePath` (after uploading to a " +
        "create_attachment_upload URL) or `contentBase64` (files under 128 KB).",
    );

  const supabase = await getClient();

  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return err("Item not found.");

  const prefix = attachmentPathPrefix({
    orgId: scope.orgId,
    boardId: scope.boardId,
    itemId: input.itemId,
    columnId: input.columnId,
  });

  let storagePath: string;
  let sizeBytes: number;
  let mimeType: string;
  // Only the inline branch owns the bytes it wrote, so only it cleans up.
  let cleanupOnFailure = false;

  if (hasInline) {
    const bytes = decodeBase64(input.contentBase64 ?? "");
    if (!bytes || bytes.byteLength === 0)
      return err("`contentBase64` is empty or not valid base64.");
    if (bytes.byteLength > MAX_INLINE_BYTES)
      return err(
        `Inline content is ${bytes.byteLength} bytes; the limit is 128 KB. ` +
          "Use create_attachment_upload for larger files.",
      );

    storagePath = input.columnId
      ? buildColumnFilePath({
          orgId: scope.orgId,
          boardId: scope.boardId,
          itemId: input.itemId,
          columnId: input.columnId,
          fileName: input.fileName,
        })
      : buildStoragePath({
          orgId: scope.orgId,
          boardId: scope.boardId,
          itemId: input.itemId,
          fileName: input.fileName,
        });
    mimeType = input.mimeType ?? DEFAULT_MIME;
    sizeBytes = bytes.byteLength;

    const { error: upErr } = await supabase.storage
      .from("attachments")
      .upload(storagePath, bytes, { contentType: mimeType });
    if (upErr) return err(upErr.message);
    cleanupOnFailure = true;
  } else {
    storagePath = input.storagePath ?? "";
    // Guard before touching Storage so a spoofed path costs nothing.
    if (!storagePath.startsWith(prefix))
      return err("Storage path does not match this item.");

    const { data: info, error: infoErr } = await supabase.storage
      .from("attachments")
      .info(storagePath);
    if (infoErr || !info)
      return err(
        "No uploaded object at that storagePath. Upload the bytes to the " +
          "`uploadUrl` from create_attachment_upload first (tickets expire " +
          "after 2 hours).",
      );
    if (typeof info.size !== "number" || info.size <= 0)
      return err("Uploaded object reports no size.");
    sizeBytes = info.size;
    mimeType = info.contentType ?? input.mimeType ?? DEFAULT_MIME;
  }

  const registered = await createAttachmentCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: input.columnId,
      storagePath,
      fileName: input.fileName,
      mimeType,
      sizeBytes,
    },
    actorId,
  );

  if (!registered.ok) {
    if (cleanupOnFailure) {
      await supabase.storage.from("attachments").remove([storagePath]);
    }
    return err(registered.error);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          attachmentId: registered.data.attachmentId,
          storagePath,
          fileName: input.fileName,
          sizeBytes,
          mimeType,
        }),
      },
    ],
  };
}

export function registerAttachFileTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "attach_file",
    {
      title: "Attach file",
      description:
        "Attach a file to an item. Provide EITHER `contentBase64` (files under " +
        "128 KB, uploaded inline) OR `storagePath` returned by " +
        "create_attachment_upload after you PUT the bytes to its `uploadUrl`. " +
        "Omit `columnId` for an item-level attachment; pass a Files column's id " +
        "to attach into that cell. Size and type are read from storage, not " +
        "from you. Attachments cannot be deleted through this server.",
      inputSchema: attachFileInput,
    },
    async (input) => attachFileHandler(getClient, input, actorId),
  );
}
