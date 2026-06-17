import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
const createSignedUrl = vi.fn();
const createSignedUrls = vi.fn();
const remove = vi.fn();
const storageFrom = vi.fn(() => ({
  createSignedUrl,
  createSignedUrls,
  remove,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from,
    auth: { getUser },
    storage: { from: storageFrom },
  }),
}));

import {
  createAttachment,
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrls,
  deleteAttachment,
} from "@/lib/collaboration/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const ATT = "44444444-4444-4444-8444-444444444444";
const USER = "99999999-9999-4999-8999-999999999999";

function mockItemLookup() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { org_id: ORG, board_id: BOARD },
          error: null,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  createSignedUrl.mockReset();
  createSignedUrls.mockReset();
  remove.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});

describe("createAttachment", () => {
  it("rejects a storage_path that is not under the item's org/board/item prefix", async () => {
    from.mockImplementation((t: string) =>
      t === "items" ? (mockItemLookup() as never) : ({} as never),
    );
    const res = await createAttachment({
      itemId: ITEM,
      storagePath: `${ORG}/${BOARD}/SOMEONE-ELSE/abc-x.png`,
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a file over 50 MB before touching the db", async () => {
    const res = await createAttachment({
      itemId: ITEM,
      storagePath: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 52_428_801,
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts the row when the path is under the correct prefix", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: ATT }, error: null }),
      }),
    });
    from.mockImplementation((t: string) => {
      if (t === "items") return mockItemLookup() as never;
      if (t === "attachments") return { insert } as never;
      return {} as never;
    });
    const res = await createAttachment({
      itemId: ITEM,
      storagePath: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG,
        board_id: BOARD,
        item_id: ITEM,
        uploaded_by: USER,
        storage_path: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
        file_name: "x.png",
        mime_type: "image/png",
        size_bytes: 10,
      }),
    );
    expect(res).toEqual({ ok: true, data: { attachmentId: ATT } });
  });
});

describe("getAttachmentDownloadUrl", () => {
  it("mints a signed URL with an attachment-disposition download filename", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              storage_path: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
              file_name: "x.png",
            },
            error: null,
          }),
        }),
      }),
    }));
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed/x" },
      error: null,
    });
    const res = await getAttachmentDownloadUrl({ attachmentId: ATT });
    expect(storageFrom).toHaveBeenCalledWith("attachments");
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
      60,
      { download: "x.png" },
    );
    expect(res).toEqual({ ok: true, data: { url: "https://signed/x" } });
  });
});

describe("getAttachmentPreviewUrls", () => {
  it("mints inline (no-download) URLs only for previewable rows", async () => {
    const PNG = "55555555-5555-4555-8555-555555555555";
    const SVG = "66666666-6666-4666-8666-666666666666";
    from.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: PNG, storage_path: "p/x.png", mime_type: "image/png" },
            { id: SVG, storage_path: "s/x.svg", mime_type: "image/svg+xml" },
          ],
          error: null,
        }),
      }),
    }));
    createSignedUrls.mockResolvedValue({
      data: [{ path: "p/x.png", signedUrl: "https://signed/p" }],
      error: null,
    });
    const res = await getAttachmentPreviewUrls({ attachmentIds: [PNG, SVG] });
    expect(createSignedUrls).toHaveBeenCalledWith(["p/x.png"], 300);
    expect(res).toEqual({
      ok: true,
      data: { urls: { [PNG]: "https://signed/p" } },
    });
  });
});

describe("deleteAttachment", () => {
  it("removes the Storage object BEFORE deleting the row", async () => {
    const order: string[] = [];
    const del = vi.fn(() => ({
      eq: async () => {
        order.push("row");
        return { error: null };
      },
    }));
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: ATT,
              storage_path: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
              uploaded_by: USER,
              org_id: ORG,
            },
            error: null,
          }),
        }),
      }),
      delete: del,
    }));
    remove.mockImplementation(async () => {
      order.push("object");
      return { error: null };
    });
    const res = await deleteAttachment({ attachmentId: ATT });
    expect(order).toEqual(["object", "row"]);
    expect(remove).toHaveBeenCalledWith([`${ORG}/${BOARD}/${ITEM}/abc-x.png`]);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});
