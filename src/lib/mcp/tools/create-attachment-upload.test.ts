import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import { createAttachmentUploadHandler } from "./create-attachment-upload";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COLUMN = "22222222-2222-4222-8222-222222222222";

describe("createAttachmentUploadHandler", () => {
  it("mints a ticket under the item's org/board prefix", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      fileName: "report.csv",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.storagePath.startsWith(`o1/b1/${ITEM}/`)).toBe(true);
    expect(parsed.expiresInSeconds).toBe(7200);
    expect(parsed.maxBytes).toBe(52_428_800);
    expect(parsed.uploadUrl).toBe("https://example.test/upload/signed");
    expect(calls.getClient).toBe(1);
    expect(calls.storage[0]?.op).toBe("createSignedUploadUrl");
    expect(calls.storage[0]?.bucket).toBe("attachments");
  });

  it("nests the column id for a Files-column attachment", async () => {
    const { getClient } = makeFakeClient({});
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      columnId: COLUMN,
      fileName: "report.csv",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.storagePath.startsWith(`o1/b1/${ITEM}/${COLUMN}/`)).toBe(
      true,
    );
  });

  it("errors when the item is not visible", async () => {
    const { getClient } = makeFakeClient({
      itemScope: { data: null, error: null },
    });
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      fileName: "report.csv",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Item not found.");
  });

  it("errors when the column is not a files column on this board", async () => {
    const { getClient } = makeFakeClient({
      fileColumn: {
        data: { id: COLUMN, kind: "text", board_id: "b1" },
        error: null,
      },
    });
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      columnId: COLUMN,
      fileName: "report.csv",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Invalid file column.");
  });

  it("surfaces a storage failure", async () => {
    const { getClient } = makeFakeClient({
      signedUpload: { data: null, error: { message: "denied" } },
    });
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      fileName: "report.csv",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("denied");
  });
});
