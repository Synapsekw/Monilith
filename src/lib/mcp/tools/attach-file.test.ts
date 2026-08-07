import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import { attachFileHandler } from "./attach-file";

const ACTOR = "99999999-9999-4999-8999-999999999999";
const ITEM = "11111111-1111-4111-8111-111111111111";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("attachFileHandler — inline base64 branch", () => {
  it("uploads, registers, and reports the decoded size", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "notes.txt",
        mimeType: "text/plain",
        contentBase64: b64("hello world"),
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.attachmentId).toBe("a1");
    expect(parsed.sizeBytes).toBe(11);
    expect(calls.getClient).toBe(1);
    expect(calls.storage.map((s) => s.op)).toEqual(["upload"]);
    expect(calls.attachments).toHaveLength(1);
  });

  it("defaults a missing mimeType to application/octet-stream", async () => {
    const { getClient, calls } = makeFakeClient({});
    await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "blob.bin", contentBase64: b64("x") },
      ACTOR,
    );
    expect(calls.attachments[0]).toMatchObject({
      mime_type: "application/octet-stream",
    });
  });

  it("rejects content over the 128 KB inline cap", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "big.bin",
        contentBase64: "A".repeat(200_000),
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("128 KB");
    expect(calls.storage).toHaveLength(0);
  });

  it("rejects empty content", async () => {
    const { getClient } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "empty.txt", contentBase64: "" },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });

  it("removes the uploaded object when registering fails", async () => {
    const { getClient, calls } = makeFakeClient({
      attachmentInsert: { data: null, error: { message: "denied" } },
    });
    const result = await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "notes.txt", contentBase64: b64("hi") },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(calls.storage.map((s) => s.op)).toEqual(["upload", "remove"]);
  });
});

describe("attachFileHandler — storagePath branch", () => {
  it("takes size and mime from Storage, not the caller", async () => {
    const { getClient, calls } = makeFakeClient({
      info: {
        data: { size: 4096, contentType: "application/pdf" },
        error: null,
      },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        mimeType: "text/plain",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    expect(calls.attachments[0]).toMatchObject({
      size_bytes: 4096,
      mime_type: "application/pdf",
    });
  });

  it("rejects a path outside this item before touching Storage", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `other-org/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Storage path does not match this item.",
    );
    expect(calls.storage).toHaveLength(0);
  });

  it("errors when the object is missing (PUT never landed)", async () => {
    const { getClient, calls } = makeFakeClient({
      info: { data: null, error: { message: "Object not found" } },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No uploaded object");
    expect(calls.attachments).toHaveLength(0);
  });

  it("errors when Storage reports no size", async () => {
    const { getClient } = makeFakeClient({
      info: { data: { contentType: "application/pdf" }, error: null },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });

  // A failed register here must NOT delete the agent's object: the bytes are
  // already uploaded and the agent can simply retry attach_file with the same
  // storagePath. Deleting would turn a retryable failure into lost work.
  it("does NOT remove the object when registering fails", async () => {
    const { getClient, calls } = makeFakeClient({
      attachmentInsert: { data: null, error: { message: "denied" } },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(calls.storage.map((s) => s.op)).toEqual(["info"]);
  });
});

describe("attachFileHandler — input guards", () => {
  it("rejects supplying both byte sources", async () => {
    const { getClient } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "x.txt",
        storagePath: `o1/b1/${ITEM}/abc-x.txt`,
        contentBase64: b64("hi"),
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });

  it("rejects supplying neither byte source", async () => {
    const { getClient } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "x.txt" },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });
});
