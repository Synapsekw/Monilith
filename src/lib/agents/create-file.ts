import { z } from "zod";
import { attachFileHandler } from "@/lib/mcp/tools/attach-file";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";

/**
 * The document formats an agent may author, each mapped to the mime type stored
 * on the attachment row. A closed set on purpose: the model picks a format, the
 * server picks the mime type, so a plausible-but-wrong `text/mardown` can never
 * be persisted.
 */
export const FILE_FORMATS = {
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
} as const;

export type FileFormat = keyof typeof FILE_FORMATS;

/** Same ceiling `attach-file.ts` enforces on decoded bytes. Duplicated as a
 *  literal rather than exported-and-shared so this tool can refuse BEFORE the
 *  handler; the handler keeps its own check as the real boundary. */
const MAX_INLINE_BYTES = 131_072;

const createFileInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(200),
  format: z.enum(Object.keys(FILE_FORMATS) as [FileFormat, ...FileFormat[]]),
  content: z.string().min(1),
};

type CreateFileInput = {
  itemId: string;
  columnId?: string;
  fileName: string;
  format: FileFormat;
  content: string;
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Builds the `create_file` descriptor over an injected `attach`.
 *
 * The factory IS the dependency seam: `ToolDescriptor.invoke` takes exactly
 * `(ctx, input)`, so a test cannot pass a fake as a third argument — it builds
 * its own descriptor instead. Production uses `createFileDescriptor` below.
 */
export function makeCreateFileDescriptor(deps: {
  attach: typeof attachFileHandler;
}): ToolDescriptor {
  return {
    name: "create_file",
    title: "Create file",
    description:
      "Author a document and attach it to an item. Write the file's PLAIN " +
      "TEXT in `content` — do not base64-encode it, the server does that. " +
      "`format` picks the extension and mime type (md, txt, csv, html, " +
      "json); it is appended to `fileName` unless you already included it. " +
      "Omit `columnId` for an item-level attachment, or pass a Files " +
      "column's id to write into that cell. Content is limited to 128 KB of " +
      "UTF-8. The result reports the stored byte count — compare it against " +
      "the document you meant to write to catch a truncated generation.",
    inputSchema: createFileInput,
    capability: "files.write",
    scope: "itemId",
    invoke: async (ctx, raw): Promise<ToolResult> => {
      // Validated against `inputSchema` by both transports before we get here.
      const input = raw as CreateFileInput;

      const ext = `.${input.format}`;
      const fileName = input.fileName.toLowerCase().endsWith(ext)
        ? input.fileName
        : `${input.fileName}${ext}`;

      const bytes = Buffer.from(input.content, "utf8");
      // Refuse HERE, with the limit named: handing oversized text to
      // attach-file would surface as an opaque base64-decode failure the model
      // cannot act on.
      if (bytes.byteLength > MAX_INLINE_BYTES)
        return err(
          `That document is ${bytes.byteLength} bytes; create_file accepts ` +
            "up to 128 KB of UTF-8 text. Write a shorter document, or split " +
            "it across several files.",
        );

      const attached = await deps.attach(
        ctx.getClient,
        {
          itemId: input.itemId,
          columnId: input.columnId,
          fileName,
          mimeType: FILE_FORMATS[input.format],
          contentBase64: bytes.toString("base64"),
        },
        ctx.actorId,
      );
      if (attached.isError) return attached;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              fileName,
              bytes: bytes.byteLength,
            }),
          },
        ],
      };
    },
  };
}

export const createFileDescriptor = makeCreateFileDescriptor({
  attach: attachFileHandler,
});
