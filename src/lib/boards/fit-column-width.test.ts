import { describe, expect, it, vi } from "vitest";
import { formatCurrency } from "@/lib/boards/currency";
import {
  COLUMN_FIT_DEFAULT,
  COLUMN_FIT_MAX,
  COLUMN_FIT_MIN,
  fitBoardColumns,
  fitColumnWidth,
  type FitMeasure,
} from "./fit-column-width";

// Stub measurer (jsdom's canvas measures nothing): 6px per character for the
// header kicker, 7px for every other font.
const measure: FitMeasure = (text, font) =>
  text.length * (font === "header" ? 6 : 7);

/** headerFloor for a label: 6px/char + 1.2px tracking/char + 48 chrome. */
const floor = (name: string) => name.length * 6 + name.length * 1.2 + 48;

const col = (kind: string, name = "Notes", settings: unknown = {}) => ({
  kind,
  name,
  settings,
});

describe("fitColumnWidth — measured text kinds", () => {
  it("text: widest value at the cell font plus the cell padding", () => {
    const values = [{ text: "short" }, { text: "hello world" }];
    // 11 chars × 7 = 77, + 16 = 93 (beats the 84 header floor for "Notes")
    expect(fitColumnWidth(col("text"), values, measure)).toBe(93);
  });

  it("text: measures the Markdown-stripped text the cell shows", () => {
    const values = [{ text: `**${"x".repeat(20)}**` }];
    expect(fitColumnWidth(col("text"), values, measure)).toBe(20 * 7 + 16);
  });

  it("link: measures the label, falling back to the URL", () => {
    const labelled = [
      { url: "https://example.com/a/very/long/path", text: "Docs" },
    ];
    // 4 × 7 + 16 = 44, under the floor for "Link" (4×6 + 4.8 + 48 = 76.8 → 77)
    expect(fitColumnWidth(col("link", "Link"), labelled, measure)).toBe(77);
    const bare = [{ url: "https://example.com/abc" }]; // 23 chars
    expect(fitColumnWidth(col("link", "Link"), bare, measure)).toBe(
      23 * 7 + 16,
    );
  });

  it("email and phone: widest value", () => {
    expect(
      fitColumnWidth(
        col("email", "E"),
        [{ email: "ada@example.com" }],
        measure,
      ),
    ).toBe(15 * 7 + 16);
    expect(
      fitColumnWidth(
        col("phone", "P"),
        [{ phone: "+971 50 123 4567" }],
        measure,
      ),
    ).toBe(16 * 7 + 16);
  });

  it("numbers: widest formatted value, with precision and unit", () => {
    const column = col("numbers", "Qty", { precision: 2, unit: "kg" });
    // "1234.50 kg" = 10 chars × 7 + 16 = 86
    expect(fitColumnWidth(column, [{ n: 1234.5 }, { n: 2 }], measure)).toBe(86);
  });

  it("currency: widest formatted amount in the column's currency", () => {
    const column = col("currency", "Cost", { currency: "USD" });
    const widest = formatCurrency(1234567.5, "USD");
    expect(
      fitColumnWidth(column, [{ amount: 12 }, { amount: 1234567.5 }], measure),
    ).toBe(widest.length * 7 + 16);
  });
});

describe("fitColumnWidth — option kinds", () => {
  const settings = {
    options: [
      { id: "a", label: "Done", color: "#00c875" },
      { id: "b", label: "Working on it", color: "#fdab3d" },
      { id: "c", label: "An unused and very long option label", color: "#ccc" },
    ],
  };

  it("status: widest label that is IN USE, plus chip and cell padding", () => {
    const values = [{ optionId: "a" }, { optionId: "b" }];
    // "Working on it" 13 × 7 = 91, + 20 chip + 16 cell = 127
    expect(
      fitColumnWidth(col("status", "Status", settings), values, measure),
    ).toBe(127);
  });

  it("status: an unused long option does not widen the column", () => {
    const values = [{ optionId: "a" }];
    // "Done" 28 + 20 + 16 = 64, under the floor for "Status" (91.2 → 91)
    expect(
      fitColumnWidth(col("status", "Status", settings), values, measure),
    ).toBe(91);
  });

  it("dropdown: the widest row of chips, with the gaps between them", () => {
    const values = [{ optionIds: ["a"] }, { optionIds: ["a", "b"] }];
    // (28 + 20) + (91 + 20) + 4 gap = 163, + 16 = 179
    expect(
      fitColumnWidth(col("dropdown", "Tags", settings), values, measure),
    ).toBe(179);
  });

  it("ignores option ids that no longer exist", () => {
    const values = [{ optionId: "gone" }, { optionIds: ["gone", "a"] }];
    expect(
      fitColumnWidth(col("dropdown", "T", settings), values, measure),
    ).toBe(Math.max(COLUMN_FIT_MIN, 28 + 20 + 16));
  });
});

describe("fitColumnWidth — people", () => {
  const members = [
    { userId: "u1", fullName: "Ada Lovelace", email: null },
    { userId: "u2", fullName: null, email: "grace@example.com" },
    {
      userId: "m1",
      fullName: "Scout",
      email: null,
      mono: { color: "#8ea2eb" },
    },
  ];

  it("one assignee: avatar plus the name", () => {
    // 24 + 6 + 12 × 7 = 114, + 16 = 130
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["u1"] }],
        measure,
        members,
      ),
    ).toBe(130);
  });

  it("falls back to the email when there is no full name", () => {
    // 24 + 6 + 17 × 7 = 149, + 16 = 165
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["u2"] }],
        measure,
        members,
      ),
    ).toBe(165);
  });

  it("reserves the Agent chip for a Mono", () => {
    // 24 + 6 + 5 × 7 + 44 = 109, + 16 = 125
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["m1"] }],
        measure,
        members,
      ),
    ).toBe(125);
  });

  it("several assignees: a stack capped at four discs", () => {
    const five = [{ userIds: ["u1", "u2", "m1", "x", "y"] }];
    // 24 + 3 × 16 = 72, + 16 = 88 (beats the 84 header floor for "Owner")
    expect(fitColumnWidth(col("people", "Owner"), five, measure, members)).toBe(
      88,
    );
  });

  it("without a member directory, measures the count label", () => {
    // "2 people" = 8 × 7 = 56, + 16 = 72; floor for "Owner" = 30 + 6 + 48 = 84
    expect(
      fitColumnWidth(
        col("people", "Owner"),
        [{ userIds: ["u1", "u2"] }],
        measure,
      ),
    ).toBe(84);
  });
});

describe("fitColumnWidth — fixed and unmeasured kinds", () => {
  it("date, rating and percent are fixed per type, whatever the values", () => {
    expect(
      fitColumnWidth(col("date", "Due"), [{ date: "2026-11-14" }], measure),
    ).toBe(116);
    expect(fitColumnWidth(col("date", "Due"), [], measure)).toBe(116);
    expect(fitColumnWidth(col("rating", "R"), [{ rating: 5 }], measure)).toBe(
      96,
    );
    expect(
      fitColumnWidth(col("percent", "P"), [{ percent: 50 }], measure),
    ).toBe(120);
    expect(fitColumnWidth(col("priority", "P"), [], measure)).toBe(108);
  });

  it("checkbox is the minimum unless its header label needs more", () => {
    expect(fitColumnWidth(col("checkbox", "OK"), [], measure)).toBe(
      COLUMN_FIT_MIN,
    );
    // "Done?" → 30 + 6 + 48 = 84
    expect(fitColumnWidth(col("checkbox", "Done?"), [], measure)).toBe(84);
  });

  it("files, relation, mirror and time tracking stay at 180 and are not measured", () => {
    const spy = vi.fn(measure);
    for (const kind of ["files", "relation", "mirror", "time_tracking"]) {
      expect(fitColumnWidth(col(kind, "X"), [{ anything: 1 }], spy)).toBe(
        COLUMN_FIT_DEFAULT,
      );
    }
    // Only the header label is ever measured for these.
    expect(spy.mock.calls.every(([, font]) => font === "header")).toBe(true);
  });

  it("an unknown kind falls back to 180", () => {
    expect(fitColumnWidth(col("hologram", "X"), [], measure)).toBe(
      COLUMN_FIT_DEFAULT,
    );
  });
});

describe("fitColumnWidth — header floor, clamps, cost guards", () => {
  it("is never narrower than the header label and its menu button", () => {
    const name = "A very long column header"; // 25 chars
    expect(fitColumnWidth(col("text", name), [{ text: "x" }], measure)).toBe(
      Math.round(floor(name)), // 150 + 30 + 48 = 228
    );
  });

  it("measures the header label uppercased, as the kicker renders it", () => {
    const spy = vi.fn(measure);
    fitColumnWidth(col("text", "Notes"), [], spy);
    expect(spy).toHaveBeenCalledWith("NOTES", "header");
  });

  it("clamps an empty, short-labelled column to the 72px minimum", () => {
    // "P0" → 12 + 2.4 + 48 = 62.4
    expect(fitColumnWidth(col("text", "P0"), [], measure)).toBe(COLUMN_FIT_MIN);
  });

  it("clamps a wide column to 360", () => {
    expect(
      fitColumnWidth(col("text"), [{ text: "x".repeat(100) }], measure),
    ).toBe(COLUMN_FIT_MAX);
  });

  it("does not measure a string longer than 120 characters: it is the cap", () => {
    const long = "x".repeat(121);
    const spy = vi.fn(measure);
    expect(fitColumnWidth(col("text"), [{ text: long }], spy)).toBe(
      COLUMN_FIT_MAX,
    );
    expect(spy).not.toHaveBeenCalledWith(long, "cell");
  });

  it("measures identical values once", () => {
    const spy = vi.fn(measure);
    fitColumnWidth(
      col("text"),
      [{ text: "same" }, { text: "same" }, { text: "same" }],
      spy,
    );
    expect(spy.mock.calls.filter(([, font]) => font === "cell")).toHaveLength(
      1,
    );
  });

  it("ignores null and malformed cell values", () => {
    const values = [null, undefined, 7, "x", {}, { text: 42 }, { text: "ok" }];
    // "ok" 14 + 16 = 30 → header floor for "Notes" = 84
    expect(fitColumnWidth(col("text"), values, measure)).toBe(84);
  });

  it("returns an integer", () => {
    const w = fitColumnWidth(col("text", "Abc"), [], measure);
    expect(Number.isInteger(w)).toBe(true);
  });
});

describe("fitBoardColumns", () => {
  const columns = [
    { id: "c1", kind: "text", name: "Notes", settings: {}, width: null },
    { id: "c2", kind: "text", name: "Saved", settings: {}, width: 240 },
    { id: "c3", kind: "date", name: "Due", settings: {}, width: null },
  ];
  const cellValues = [
    { column_id: "c1", value: { text: "hello world" } },
    { column_id: "c2", value: { text: "x".repeat(80) } },
    { column_id: "c1", value: { text: "hi" } },
  ];

  it("fits every column without a saved width, and only those", () => {
    expect(fitBoardColumns(columns, cellValues, measure)).toEqual({
      c1: 93,
      c3: 116,
    });
  });

  it("never measures the values of a column that has a saved width", () => {
    const spy = vi.fn(measure);
    fitBoardColumns(columns, cellValues, spy);
    expect(spy).not.toHaveBeenCalledWith("x".repeat(80), "cell");
  });

  it("returns an empty map when every column has a saved width", () => {
    expect(fitBoardColumns([columns[1]], cellValues, measure)).toEqual({});
  });
});
