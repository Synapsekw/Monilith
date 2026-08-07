import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildColumnFilePath,
  buildStoragePath,
} from "@/lib/collaboration/attachments-path";
import { resolveItemScope } from "@/lib/collaboration/attachment-core";
import type { GetClient, ToolResult } from "./shared";

/** The `attachments` bucket ceiling, mirrored from the bucket + check constraint. */
const MAX_BYTES = 52_428_800;
/** Fixed by @supabase/storage-js: createSignedUploadUrl takes only { upsert }. */
const SIGNED_UPLOAD_TTL_SECONDS = 7200;

const createAttachmentUploadInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Takes no `actorId`: minting a ticket writes nothing, so there is no side
 * effect to attribute. The actor is stamped by `attach_file`, which does the
 * insert. Do not add an unused parameter here for symmetry with the write
 * tools — `pnpm lint` rejects unused parameters.
 */
export async function createAttachmentUploadHandler(
  getClient: GetClient,
  input: { itemId: string; columnId?: string; fileName: string },
): Promise<ToolResult> {
  const supabase = await getClient();

  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return err("Item not found.");

  // Validate the column BEFORE minting a ticket, so an agent never uploads
  // bytes it will not be allowed to register.
  if (input.columnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("id, kind, board_id")
      .eq("id", input.columnId)
      .maybeSingle();
    if (!col || col.board_id !== scope.boardId || col.kind !== "files")
      return err("Invalid file column.");
  }

  const storagePath = input.columnId
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

  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUploadUrl(storagePath);
  if (error || !data) return err(error?.message ?? "Could not create upload.");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          uploadUrl: data.signedUrl,
          token: data.token,
          storagePath,
          expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
          maxBytes: MAX_BYTES,
        }),
      },
    ],
  };
}

export function registerCreateAttachmentUploadTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "create_attachment_upload",
    {
      title: "Create attachment upload",
      description:
        "Start a file upload for an item. Returns a signed `uploadUrl` valid " +
        "for 2 hours and the `storagePath` to pass to `attach_file` after you " +
        "PUT the bytes. Omit `columnId` for an item-level attachment; pass a " +
        "Files column's id to attach into that cell. Max 50 MB. For files " +
        "under 128 KB you can skip this and pass `contentBase64` to " +
        "`attach_file` directly.",
      inputSchema: createAttachmentUploadInput,
    },
    async (input) => createAttachmentUploadHandler(getClient, input),
  );
}
