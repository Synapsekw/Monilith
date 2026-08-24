import { describe, it, expect, vi, beforeEach } from "vitest";

const parseWorkbookSheets = vi.fn();
vi.mock("@/lib/boards/spreadsheet/parse-workbook", () => ({
  parseWorkbookSheets: (...a: unknown[]) => parseWorkbookSheets(...a),
}));

import { extractSheetText } from "./sheet-extract-actions";

const b64 = (s: string) => Buffer.from(s).toString("base64");

beforeEach(() => parseWorkbookSheets.mockReset());

describe("extractSheetText", () => {
  it("flattens sheets to tab-delimited rows with a sheet heading", async () => {
    parseWorkbookSheets.mockResolvedValue([
      {
        name: "Vendors",
        grid: [
          ["Name", "Tier"],
          ["Acme", "A"],
        ],
      },
    ]);
    const r = await extractSheetText({ fileName: "v.xlsx", bytes: b64("x") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.text).toBe("## Vendors\n\nName\tTier\nAcme\tA");
    }
  });

  it("separates multiple sheets", async () => {
    parseWorkbookSheets.mockResolvedValue([
      { name: "A", grid: [["1"]] },
      { name: "B", grid: [["2"]] },
    ]);
    const r = await extractSheetText({ fileName: "v.xlsx", bytes: b64("x") });
    if (r.ok) expect(r.data.text).toBe("## A\n\n1\n\n## B\n\n2");
  });

  it("fails on a non-spreadsheet filename", async () => {
    const r = await extractSheetText({ fileName: "a.png", bytes: b64("x") });
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(/spreadsheet/i),
    });
    expect(parseWorkbookSheets).not.toHaveBeenCalled();
  });

  it("fails when the workbook yields no text", async () => {
    parseWorkbookSheets.mockResolvedValue([{ name: "Empty", grid: [] }]);
    const r = await extractSheetText({ fileName: "v.xlsx", bytes: b64("x") });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/no text/i) });
  });

  it("turns a parser throw into a failure, never an exception", async () => {
    // mockRejectedValueOnce, not mockRejectedValue: the persistent variant's
    // implementation stays installed after this test and — combined with
    // `mockReset()` in beforeEach — produced a flaky spurious "unhandled
    // rejection" failure attributed to this test (verified against a dozen
    // reruns; the codebase's other mockReset+reject suites all use the Once
    // form for the same reason, e.g. src/lib/ai/actions.test.ts).
    parseWorkbookSheets.mockRejectedValueOnce(new Error("zip bomb"));
    const r = await extractSheetText({ fileName: "v.xlsx", bytes: b64("x") });
    expect(r.ok).toBe(false);
  });

  it("rejects bytes over MAX_BYTES before parsing", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024).toString("base64");
    const r = await extractSheetText({ fileName: "v.xlsx", bytes: big });
    expect(r.ok).toBe(false);
    expect(parseWorkbookSheets).not.toHaveBeenCalled();
  });
});
