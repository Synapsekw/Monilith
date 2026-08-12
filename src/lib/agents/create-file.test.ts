import { describe, expect, it, vi } from "vitest";
import type { attachFileHandler } from "@/lib/mcp/tools/attach-file";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import { FILE_FORMATS, makeCreateFileDescriptor } from "./create-file";

/** Local fixtures. `ctx` is never dereferenced by create_file itself — it is
 *  forwarded whole to the injected `attach`, so a client that would throw on
 *  any use is the right stub. */
const ctx: ToolInvokeContext = {
  getClient: async () => ({}) as never,
  actorId: "00000000-0000-4000-8000-000000000001",
};
const ITEM = "11111111-1111-4111-8111-111111111111";

type Attach = typeof attachFileHandler;

const okAttach: Attach = async () => ({
  content: [{ type: "text" as const, text: "{}" }],
});
const spyAttach = () => vi.fn<Attach>(okAttach);

describe("create_file", () => {
  it("encodes plain text server-side and delegates to attachFileHandler", async () => {
    const attach = spyAttach();
    await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "brief",
      format: "md",
      content: "# Hello",
    });
    // attachFileHandler(getClient, input, actorId) — input is argument 2.
    const passed = attach.mock.calls[0][1];
    expect(passed.fileName).toBe("brief.md");
    expect(passed.mimeType).toBe("text/markdown");
    expect(Buffer.from(passed.contentBase64 ?? "", "base64").toString()).toBe(
      "# Hello",
    );
    // The actor and the client resolver are forwarded untouched: create_file
    // adds no identity of its own, so attach-file's RLS story is unchanged.
    expect(attach.mock.calls[0][0]).toBe(ctx.getClient);
    expect(attach.mock.calls[0][2]).toBe(ctx.actorId);
  });

  it("passes columnId through so a Files column can be targeted", async () => {
    const attach = spyAttach();
    const column = "22222222-2222-4222-8222-222222222222";
    await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      columnId: column,
      fileName: "b",
      format: "csv",
      content: "a,b",
    });
    expect(attach.mock.calls[0][1]).toMatchObject({
      columnId: column,
      mimeType: "text/csv",
    });
  });

  it("reports the byte count so truncation is detectable", async () => {
    const r = await makeCreateFileDescriptor({ attach: okAttach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "b",
      format: "txt",
      content: "abcde",
    });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('"bytes":5');
  });

  it("counts UTF-8 bytes, not characters", async () => {
    const attach = spyAttach();
    const r = await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "b",
      format: "txt",
      // 3 bytes in UTF-8, 1 character.
      content: "€",
    });
    expect(r.content[0].text).toContain('"bytes":3');
  });

  it("refuses content over the 128 KB inline ceiling with a usable message", async () => {
    const attach = spyAttach();
    const r = await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "b",
      format: "txt",
      content: "x".repeat(131073),
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/128 KB/);
    // Refused BEFORE the handler, so attach-file's strict base64 decode never
    // turns an oversized document into an opaque failure.
    expect(attach).not.toHaveBeenCalled();
  });

  it("accepts content exactly at the ceiling", async () => {
    const attach = spyAttach();
    const r = await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "b",
      format: "txt",
      content: "x".repeat(131072),
    });
    expect(r.isError).toBeUndefined();
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("does not double-append an extension the caller already supplied", async () => {
    const attach = spyAttach();
    await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "brief.md",
      format: "md",
      content: "x",
    });
    expect(attach.mock.calls[0][1].fileName).toBe("brief.md");
  });

  it("treats an upper-case extension as already supplied", async () => {
    const attach = spyAttach();
    await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "BRIEF.MD",
      format: "md",
      content: "x",
    });
    expect(attach.mock.calls[0][1].fileName).toBe("BRIEF.MD");
  });

  it("surfaces the handler's failure verbatim", async () => {
    const attach: Attach = async () => ({
      content: [{ type: "text" as const, text: "Item not found." }],
      isError: true,
    });
    const r = await makeCreateFileDescriptor({ attach }).invoke(ctx, {
      itemId: ITEM,
      fileName: "b",
      format: "txt",
      content: "x",
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Item not found.");
  });

  it("maps every declared format to a mime type", async () => {
    for (const [format, mime] of Object.entries(FILE_FORMATS)) {
      const attach = spyAttach();
      await makeCreateFileDescriptor({ attach }).invoke(ctx, {
        itemId: ITEM,
        fileName: "b",
        format,
        content: "x",
      });
      expect(attach.mock.calls[0][1].mimeType).toBe(mime);
      expect(attach.mock.calls[0][1].fileName).toBe(`b.${format}`);
    }
  });
});
