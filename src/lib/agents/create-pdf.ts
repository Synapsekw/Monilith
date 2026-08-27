import { z } from "zod";
import type { PdfOptions } from "@/lib/reports/pdf";
import {
  resolveItemScope,
  uploadAndRegisterAttachment,
} from "@/lib/collaboration/attachment-core";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";
import { buildAgentPdfHtml } from "./pdf-document";

/** Server-chosen, never model-supplied — the same closed-set discipline
 *  `FILE_FORMATS` applies in `create-file.ts`. */
const PDF_MIME = "application/pdf";

/**
 * The ceiling on the MARKDOWN SOURCE, and it is the same 131_072 as
 * `create-file.ts:25` for the same reason, duplicated as a literal for the
 * reason stated there: it bounds what one tool call carries and what a
 * proposal row stores for up to seven days.
 *
 * It is deliberately NOT a ceiling on the PDF. Those bytes are produced by
 * Chromium inside this invocation, never emitted by a model and never carried
 * across a tool boundary, so they cost no context; they are bounded instead by
 * `MAX_ATTACHMENT_BYTES` (the bucket's own 50 MB) inside
 * `uploadAndRegisterAttachment`. Two quantities, two ceilings, two rationales.
 */
const MAX_SOURCE_BYTES = 131_072;

/**
 * How long one render may take before this tool gives up.
 *
 * The agent run route inherits the platform's function timeout; this bound sits
 * inside it so a pathological document degrades ONE STEP (`tools.ts` turns the
 * refusal into `{ error }` and the loop continues) instead of killing an
 * unattended 07:00 run that still has a briefing to write and send.
 */
const RENDER_TIMEOUT_MS = 45_000;

export type RenderPdf = (html: string, opts: PdfOptions) => Promise<Buffer>;

const createPdfInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1),
};

type CreatePdfInput = {
  itemId: string;
  columnId?: string;
  fileName: string;
  content: string;
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

const TIMED_OUT = Symbol("pdf-render-timeout");

/**
 * Resolve `work`, or `TIMED_OUT` if it takes longer than `ms`.
 *
 * The losing promise is NOT cancellable — Chromium keeps going until its own
 * `finally` closes the browser — so it gets a no-op catch: a rejection landing
 * after the race has been decided would otherwise be an unhandled rejection,
 * which in Node can take the process with it. The timer is `unref`'d and
 * cleared so it can never hold the function open on the success path.
 */
async function raceTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Builds the `create_pdf` descriptor over an injected renderer and attacher.
 *
 * The factory IS the dependency seam, exactly as in `create-file.ts:65-74`:
 * `ToolDescriptor.invoke` takes `(ctx, input)` and nothing else, so a test
 * builds its own descriptor rather than passing a fake third argument — which
 * is what keeps headless Chromium out of the unit suite entirely.
 */
export function makeCreatePdfDescriptor(deps: {
  render: RenderPdf;
  attach: typeof uploadAndRegisterAttachment;
}): ToolDescriptor {
  return {
    name: "create_pdf",
    title: "Create PDF",
    description:
      "Write a report as a PDF and attach it to an item. Put the document's " +
      "MARKDOWN in `content` — headings (#, ##, ###), paragraphs, bullet and " +
      "numbered lists, > quotes, **bold**, *italic*, `code` and [links]" +
      "(https://…). Do NOT write HTML: any tag you type appears in the PDF as " +
      "literal text. Tables and images are not supported — use headings and " +
      "lists instead of a table. The server renders the document to A4 " +
      "portrait and stores it; `.pdf` is appended to `fileName` unless you " +
      "already included it. Omit `columnId` for an item-level attachment, or " +
      "pass a Files column's id to write into that cell. Source is limited " +
      "to 128 KB of Markdown. The result reports the new attachment's " +
      "`attachmentId` — use it to refer to this file in any later call — and " +
      "the stored PDF's byte count.",
    inputSchema: createPdfInput,
    capability: "files.write",
    scope: "itemId",
    invoke: async (ctx, raw): Promise<ToolResult> => {
      // Validated against `inputSchema` by both transports before we get here.
      const input = raw as CreatePdfInput;

      const fileName = input.fileName.toLowerCase().endsWith(".pdf")
        ? input.fileName
        : `${input.fileName}.pdf`;

      const sourceBytes = Buffer.byteLength(input.content, "utf8");
      // Refuse HERE, with the limit named, and before anything expensive.
      if (sourceBytes > MAX_SOURCE_BYTES)
        return err(
          `That document is ${sourceBytes} bytes; create_pdf accepts up to ` +
            "128 KB of Markdown source. Write a shorter document, or split " +
            "it across several files.",
        );

      // Exactly once per invocation (shared.ts:11-14): each call charges the
      // rate limit and rotates the OAuth bridge secret.
      const supabase = await ctx.getClient();

      // The id is MODEL-CHOSEN and may not exist. One indexed PK read here is
      // far cheaper than discovering it after a 5-45s browser launch — and the
      // read is the same one `uploadAndRegisterAttachment` and
      // `createAttachmentCore` each repeat, which is not skippable there
      // (attachment-core.ts:59-62: re-deriving tenancy IS the spoof guard).
      const scope = await resolveItemScope(supabase, input.itemId);
      if (!scope) return err("Item not found.");

      // MARKDOWN IN, ESCAPED HTML OUT. The model never authors markup that
      // reaches Chromium: `parseMarkdown`'s AST has no image, script or
      // raw-HTML node, so a `<img src="http://169.254.169.254/…">` in the
      // source is text by the time `setContent` sees it. That is the property
      // that makes it safe to render model-authored content in a browser that
      // waits for `networkidle`.
      const html = buildAgentPdfHtml(input.content);

      let pdf: Buffer;
      try {
        const rendered = await raceTimeout(
          // Portrait A4 always: the supported Markdown has no wide block, and
          // fixing it here keeps `src/lib/reports/pdf.ts` — shared with report
          // export — untouched by this feature.
          deps.render(html, { landscape: false }),
          RENDER_TIMEOUT_MS,
        );
        if (rendered === TIMED_OUT)
          return err(
            "Rendering that document took longer than 45 seconds. Try a " +
              "shorter document.",
          );
        pdf = rendered;
      } catch (e) {
        return err(
          e instanceof Error ? e.message : "Could not render the PDF.",
        );
      }

      const registered = await deps.attach(
        supabase,
        {
          itemId: input.itemId,
          columnId: input.columnId,
          fileName,
          mimeType: PDF_MIME,
          bytes: pdf,
        },
        ctx.actorId,
      );
      if (!registered.ok) return err(registered.error);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              attachmentId: registered.data.attachmentId,
              fileName,
              // The REAL stored size, straight off the typed result — this path
              // never stringifies the id, so it needs no defensive re-parse of
              // its own output the way `create_file` does.
              bytes: registered.data.sizeBytes,
            }),
          },
        ],
      };
    },
  };
}

export const createPdfDescriptor = makeCreatePdfDescriptor({
  /**
   * LAZY on purpose. `AGENT_ONLY_DESCRIPTORS` is imported by
   * `proposal-actions.ts` and `proposal-targets.ts`, which `/settings/agents`
   * renders; a static import would pull `playwright-core` and
   * `@sparticuz/chromium` into that route's module graph for a page that never
   * renders a PDF. Same reason `export-html.tsx:14-18` defers
   * `react-dom/server`. The `PdfOptions` import above is type-only and erased.
   */
  render: async (html, opts) =>
    (await import("@/lib/reports/pdf")).renderHtmlToPdf(html, opts),
  attach: uploadAndRegisterAttachment,
});
