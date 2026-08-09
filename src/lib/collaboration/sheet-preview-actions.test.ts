import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const createSignedUrl = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

const parseWorkbookSheets = vi.fn();
vi.mock("@/lib/boards/spreadsheet/parse-workbook", () => ({
  parseWorkbookSheets: (...a: unknown[]) => parseWorkbookSheets(...a),
}));

import { getAttachmentSheetPreview } from "@/lib/collaboration/sheet-preview-actions";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://signed.example/x" },
    error: null,
  });
  global.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

describe("getAttachmentSheetPreview", () => {
  it("rejects an attachment that is not a spreadsheet", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "application/pdf",
        file_name: "a.pdf",
        size_bytes: 10,
      },
      error: null,
    });
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects a missing row without signing", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("truncates each sheet to PREVIEW_GRID_ROWS but reports the true rowCount", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "text/csv",
        file_name: "a.csv",
        size_bytes: 100,
      },
      error: null,
    });
    const grid = Array.from({ length: 250 }, (_, i) => [`r${i}`, "b"]);
    parseWorkbookSheets.mockResolvedValue([{ name: "Sheet1", grid }]);

    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [sheet] = res.data.sheets;
    expect(sheet.name).toBe("Sheet1");
    expect(sheet.rowCount).toBe(250);
    expect(sheet.colCount).toBe(2);
    expect(sheet.grid).toHaveLength(200); // PREVIEW_GRID_ROWS
  });

  it("surfaces a parser failure as a failed ActionResult", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "text/csv",
        file_name: "a.csv",
        size_bytes: 100,
      },
      error: null,
    });
    parseWorkbookSheets.mockRejectedValue(new Error("empty"));
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
  });

  it("rejects an oversized file before fetching any bytes", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        storage_path: "p",
        mime_type: "text/csv",
        file_name: "a.csv",
        size_bytes: 99_000_000,
      },
      error: null,
    });
    const res = await getAttachmentSheetPreview({ attachmentId: ID });
    expect(res.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
