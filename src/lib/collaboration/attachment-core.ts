import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database } from "@/types/database.types";
import { buildColumnFilePath, buildStoragePath } from "./attachments-path";

/** What registering an attachment needs, already parsed by the caller's Zod boundary. */
export type CreateAttachmentCoreInput = {
  itemId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  columnId?: string;
};

/** The item's denormalized tenancy, read under RLS. `null` when not visible. */
export async function resolveItemScope(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<{ orgId: string; boardId: string } | null> {
  const { data, error } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (error || !data) return null;
  return { orgId: data.org_id, boardId: data.board_id };
}

/**
 * The only object-key prefix an attachment for this item may live under.
 * Files-column attachments nest the column id one level deeper. Pure.
 */
export function attachmentPathPrefix(input: {
  orgId: string;
  boardId: string;
  itemId: string;
  columnId?: string;
}): string {
  return input.columnId
    ? `${input.orgId}/${input.boardId}/${input.itemId}/${input.columnId}/`
    : `${input.orgId}/${input.boardId}/${input.itemId}/`;
}

/**
 * The single implementation of "register an attachment row" for the whole app:
 * re-derives org/board from the item under RLS, rejects any path outside this
 * org/board/item(/column) prefix, verifies a column-scoped attachment targets a
 * `files` column on the same board, and inserts.
 *
 * Both the Supabase client AND the actor are injected, which is the entire
 * point: a cookie-bound Server Action and a bearer-token MCP request produce
 * different clients and resolve their user differently, but must produce
 * identical side effects. This function therefore NEVER calls `supabase.auth.*`
 * — the same discipline as `upsertCellCore`
 * (`src/lib/boards/actions/cell-core.ts`), whose absence caused
 * `vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`.
 *
 * The item re-read here is deliberately NOT skippable by passing in a scope the
 * caller already resolved: re-deriving tenancy from the item IS the path-spoof
 * guard. Storage RLS (`attachments_obj_insert`) is the second, independent
 * layer — an application bug alone cannot cross a tenant boundary.
 *
 * Callers: `createAttachment` (`./actions.ts`, cookie client) and
 * `attachFileHandler` (`src/lib/mcp/tools/attach-file.ts`, bridged OAuth client).
 */
export async function createAttachmentCore(
  supabase: SupabaseClient<Database>,
  input: CreateAttachmentCoreInput,
  actorId: string,
): Promise<ActionResult<{ attachmentId: string }>> {
  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return fail("Item not found.");

  const prefix = attachmentPathPrefix({
    orgId: scope.orgId,
    boardId: scope.boardId,
    itemId: input.itemId,
    columnId: input.columnId,
  });
  if (!input.storagePath.startsWith(prefix))
    return fail("Storage path does not match this item.");

  if (input.columnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("id, kind, board_id")
      .eq("id", input.columnId)
      .maybeSingle();
    if (!col || col.board_id !== scope.boardId || col.kind !== "files")
      return fail("Invalid file column.");
  }

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      org_id: scope.orgId,
      board_id: scope.boardId,
      item_id: input.itemId,
      column_id: input.columnId ?? null,
      uploaded_by: actorId,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
    })
    .select("id")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not register attachment.");
  return { ok: true, data: { attachmentId: data.id } };
}

/** The `attachments` bucket ceiling, mirrored from the bucket + check
 *  constraint. Exported so the one number has one home: the MCP upload-ticket
 *  tool reports it to callers, and this module enforces it. */
export const MAX_ATTACHMENT_BYTES = 52_428_800;

/**
 * Upload bytes the SERVER produced and register them as an attachment.
 *
 * The counterpart to `createAttachmentCore` for callers that hold the bytes
 * rather than a storage path: it owns the whole upload → register → clean-up-on
 * -failure sequence, which is the part a second copy would most plausibly get
 * wrong (an orphaned object in the bucket with no row pointing at it).
 *
 * NOTHING ABOUT THE STORED ROW IS CALLER-ASSERTED except the file name, and
 * that is sanitised into the object key by `attachments-path.ts`. `sizeBytes`
 * is this function's own count of the buffer it uploaded; `mimeType` is chosen
 * by the calling tool from a closed set, never by a model. That is the same
 * property `attach_file` states as "size and type are read from storage, not
 * from you", reached from the other side: we are the writer, so our count IS
 * the storage truth and re-reading it would be a network call to learn a number
 * we just produced.
 *
 * Callers: `attachFileHandler`'s inline branch (`src/lib/mcp/tools/attach-file.ts`)
 * and `create_pdf` (`src/lib/agents/create-pdf.ts`).
 */
export async function uploadAndRegisterAttachment(
  supabase: SupabaseClient<Database>,
  input: {
    itemId: string;
    columnId?: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  },
  actorId: string,
): Promise<
  ActionResult<{ attachmentId: string; storagePath: string; sizeBytes: number }>
> {
  const sizeBytes = input.bytes.byteLength;
  // Both guards run BEFORE any network call: a refusal that costs nothing is
  // the difference between an actionable message and a Storage error the
  // caller cannot interpret.
  if (sizeBytes === 0) return fail("There are no bytes to attach.");
  if (sizeBytes > MAX_ATTACHMENT_BYTES)
    return fail(
      `That file is ${sizeBytes} bytes; the attachments bucket accepts up to 50 MB.`,
    );

  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return fail("Item not found.");

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

  const { error: upErr } = await supabase.storage
    .from("attachments")
    .upload(storagePath, input.bytes, { contentType: input.mimeType });
  if (upErr) return fail(upErr.message);

  const registered = await createAttachmentCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: input.columnId,
      storagePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes,
    },
    actorId,
  );
  if (!registered.ok) {
    // We wrote these bytes, so we own them: leaving them behind would orphan an
    // object no row references and no UI can reach.
    await supabase.storage.from("attachments").remove([storagePath]);
    return fail(registered.error);
  }

  return {
    ok: true,
    data: {
      attachmentId: registered.data.attachmentId,
      storagePath,
      sizeBytes,
    },
  };
}
