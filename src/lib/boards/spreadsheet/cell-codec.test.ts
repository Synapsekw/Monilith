import { describe, it, expect } from "vitest";
import { cellToText, cellToExcelValue, textToCell } from "./cell-codec";

const statusSettings = {
  options: [
    { id: "o1", label: "Done", color: "#00c875" },
    { id: "o2", label: "Working", color: "#fdab3d" },
  ],
};

const dropdownSettings = {
  options: [
    { id: "d1", label: "Alpha", color: "#00c875" },
    { id: "d2", label: "Beta", color: "#fdab3d" },
    { id: "d3", label: "Gamma", color: "#e2445c" },
  ],
};

// ---------------------------------------------------------------------------
// cellToText
// ---------------------------------------------------------------------------
describe("cellToText", () => {
  it("renders text value", () => {
    expect(cellToText("text", { text: "hello" }, {})).toBe("hello");
  });

  it("renders numbers value", () => {
    expect(cellToText("numbers", { n: 42 }, {})).toBe("42");
  });

  it("renders percent value", () => {
    expect(cellToText("percent", { percent: 75 }, {})).toBe("75");
  });

  it("renders rating value", () => {
    expect(cellToText("rating", { rating: 3 }, {})).toBe("3");
  });

  it("renders phone value", () => {
    expect(cellToText("phone", { phone: "+1-555-1234" }, {})).toBe(
      "+1-555-1234",
    );
  });

  it("renders email value", () => {
    expect(cellToText("email", { email: "test@example.com" }, {})).toBe(
      "test@example.com",
    );
  });

  it("renders link with label", () => {
    expect(
      cellToText("link", { url: "https://example.com", text: "Example" }, {}),
    ).toBe("Example");
  });

  it("renders link url when no label", () => {
    expect(cellToText("link", { url: "https://example.com" }, {})).toBe(
      "https://example.com",
    );
  });

  it("renders date (ignores end)", () => {
    expect(
      cellToText("date", { date: "2024-01-15", end: "2024-01-20" }, {}),
    ).toBe("2024-01-15");
  });

  it("renders checkbox as TRUE", () => {
    expect(cellToText("checkbox", { checked: true }, {})).toBe("TRUE");
  });

  it("renders checkbox as FALSE", () => {
    expect(cellToText("checkbox", { checked: false }, {})).toBe("FALSE");
  });

  it("renders status label by optionId", () => {
    expect(cellToText("status", { optionId: "o1" }, statusSettings)).toBe(
      "Done",
    );
  });

  it("renders status as empty string when optionId is null", () => {
    expect(cellToText("status", { optionId: null }, statusSettings)).toBe("");
  });

  it("renders status as empty when optionId not found", () => {
    expect(cellToText("status", { optionId: "unknown" }, statusSettings)).toBe(
      "",
    );
  });

  it("renders dropdown with multiple option labels joined by comma", () => {
    expect(
      cellToText("dropdown", { optionIds: ["d1", "d3"] }, dropdownSettings),
    ).toBe("Alpha, Gamma");
  });

  it("renders dropdown as empty when no optionIds match", () => {
    expect(cellToText("dropdown", { optionIds: ["x"] }, dropdownSettings)).toBe(
      "",
    );
  });

  it("renders people as blank when no resolver is provided", () => {
    expect(cellToText("people", { userIds: ["u1"] }, {})).toBe("");
  });

  it("renders resolved people names joined by comma", () => {
    const resolve = (id: string) =>
      ({ u1: "Ada Lovelace", u2: "Alan Turing" })[id] ?? null;
    expect(cellToText("people", { userIds: ["u1", "u2"] }, {}, resolve)).toBe(
      "Ada Lovelace, Alan Turing",
    );
  });

  it("drops unresolvable people ids and keeps resolvable ones", () => {
    const resolve = (id: string) => (id === "u1" ? "Ada Lovelace" : null);
    expect(
      cellToText("people", { userIds: ["u1", "u-missing"] }, {}, resolve),
    ).toBe("Ada Lovelace");
  });

  it("renders people as blank when none resolve", () => {
    const resolve = () => null;
    expect(cellToText("people", { userIds: ["u1", "u2"] }, {}, resolve)).toBe(
      "",
    );
  });

  it("renders people as blank when userIds is missing/empty", () => {
    const resolve = () => "Someone";
    expect(cellToText("people", {}, {}, resolve)).toBe("");
    expect(cellToText("people", { userIds: [] }, {}, resolve)).toBe("");
  });

  it("renders relation as blank", () => {
    expect(cellToText("relation", { itemIds: ["i1"] }, {})).toBe("");
  });

  it("renders mirror as blank", () => {
    expect(cellToText("mirror", {}, {})).toBe("");
  });

  it("renders files as blank", () => {
    expect(cellToText("files", { fileIds: [] }, {})).toBe("");
  });

  it("renders time_tracking as blank", () => {
    expect(cellToText("time_tracking", { seconds: 3600 }, {})).toBe("");
  });

  it("never throws on null value", () => {
    expect(cellToText("numbers", null, {})).toBe("");
  });

  it("never throws on undefined value", () => {
    expect(cellToText("text", undefined, {})).toBe("");
  });

  it("never throws on malformed text value", () => {
    expect(cellToText("text", { notText: "oops" }, {})).toBe("");
  });

  it("never throws on malformed settings", () => {
    expect(cellToText("status", { optionId: "o1" }, null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// textToCell
// ---------------------------------------------------------------------------
const synthOptions = [
  { id: "o1", label: "Done", color: "#000" },
  { id: "o2", label: "In Progress", color: "#111" },
];

const dropdownSynthOptions = [
  { id: "d1", label: "Alpha", color: "#000" },
  { id: "d2", label: "Beta", color: "#111" },
  { id: "d3", label: "Gamma", color: "#222" },
];

describe("textToCell", () => {
  // empty / whitespace
  it("returns null for empty string", () => {
    expect(textToCell("text", "", [])).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(textToCell("text", "  ", [])).toBeNull();
  });

  // text
  it("parses text", () => {
    expect(textToCell("text", "hello world", [])).toEqual({
      text: "hello world",
    });
  });

  it("trims text before parsing", () => {
    expect(textToCell("text", "  hello  ", [])).toEqual({ text: "hello" });
  });

  // numbers
  it("parses integer numbers", () => {
    expect(textToCell("numbers", "42", [])).toEqual({ n: 42 });
  });

  it("parses decimal numbers", () => {
    expect(textToCell("numbers", "3.14", [])).toEqual({ n: 3.14 });
  });

  it("parses negative numbers", () => {
    expect(textToCell("numbers", "-10", [])).toEqual({ n: -10 });
  });

  it("rejects non-numeric numbers", () => {
    expect(textToCell("numbers", "x", [])).toBeNull();
  });

  it("rejects NaN as numbers", () => {
    expect(textToCell("numbers", "NaN", [])).toBeNull();
  });

  it("rejects Infinity as numbers", () => {
    expect(textToCell("numbers", "Infinity", [])).toBeNull();
  });

  // percent
  it("parses valid percent", () => {
    expect(textToCell("percent", "50", [])).toEqual({ percent: 50 });
  });

  it("clamps percent below 0 to 0", () => {
    expect(textToCell("percent", "-5", [])).toEqual({ percent: 0 });
  });

  it("clamps percent above 100 to 100", () => {
    expect(textToCell("percent", "150", [])).toEqual({ percent: 100 });
  });

  it("rejects non-numeric percent", () => {
    expect(textToCell("percent", "abc", [])).toBeNull();
  });

  // rating
  it("parses valid rating 1..5", () => {
    expect(textToCell("rating", "3", [])).toEqual({ rating: 3 });
  });

  it("rounds rating to nearest integer", () => {
    expect(textToCell("rating", "2.7", [])).toEqual({ rating: 3 });
  });

  it("clamps rating below 1 to 1", () => {
    expect(textToCell("rating", "0", [])).toEqual({ rating: 1 });
  });

  it("clamps rating above 5 to 5", () => {
    expect(textToCell("rating", "10", [])).toEqual({ rating: 5 });
  });

  it("rejects non-numeric rating", () => {
    expect(textToCell("rating", "bad", [])).toBeNull();
  });

  // phone
  it("parses phone", () => {
    expect(textToCell("phone", "+1-555-1234", [])).toEqual({
      phone: "+1-555-1234",
    });
  });

  // email
  it("parses valid email", () => {
    expect(textToCell("email", "test@example.com", [])).toEqual({
      email: "test@example.com",
    });
  });

  it("rejects email without @", () => {
    expect(textToCell("email", "notanemail", [])).toBeNull();
  });

  // link
  it("parses valid http link", () => {
    expect(textToCell("link", "https://example.com", [])).toEqual({
      url: "https://example.com",
    });
  });

  it("parses valid http (non-https) link", () => {
    expect(textToCell("link", "http://example.com", [])).toEqual({
      url: "http://example.com",
    });
  });

  it("rejects non-http links (javascript:)", () => {
    expect(textToCell("link", "javascript:alert(1)", [])).toBeNull();
  });

  it("rejects non-http links (ftp:)", () => {
    expect(textToCell("link", "ftp://example.com", [])).toBeNull();
  });

  it("rejects plain text as link", () => {
    expect(textToCell("link", "not-a-url", [])).toBeNull();
  });

  // date
  it("parses ISO date string YYYY-MM-DD", () => {
    expect(textToCell("date", "2024-01-15", [])).toEqual({
      date: "2024-01-15",
    });
  });

  it("parses human-readable date string via new Date()", () => {
    const result = textToCell("date", "January 15, 2024", []);
    // Should produce a valid date object but we just check it's not null and has date key
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("date");
    // The date should match YYYY-MM-DD pattern
    expect((result as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects invalid date strings", () => {
    expect(textToCell("date", "not-a-date", [])).toBeNull();
  });

  // checkbox
  it("parses 'true' as checked:true", () => {
    expect(textToCell("checkbox", "true", [])).toEqual({ checked: true });
  });

  it("parses 'TRUE' (uppercase) as checked:true", () => {
    expect(textToCell("checkbox", "TRUE", [])).toEqual({ checked: true });
  });

  it("parses 'yes' as checked:true", () => {
    expect(textToCell("checkbox", "yes", [])).toEqual({ checked: true });
  });

  it("parses 'Yes' as checked:true", () => {
    expect(textToCell("checkbox", "Yes", [])).toEqual({ checked: true });
  });

  it("parses '✓' as checked:true", () => {
    expect(textToCell("checkbox", "✓", [])).toEqual({ checked: true });
  });

  it("parses 'x' as checked:true", () => {
    expect(textToCell("checkbox", "x", [])).toEqual({ checked: true });
  });

  it("parses '1' as checked:true", () => {
    expect(textToCell("checkbox", "1", [])).toEqual({ checked: true });
  });

  it("parses 'false' as checked:false", () => {
    expect(textToCell("checkbox", "false", [])).toEqual({ checked: false });
  });

  it("parses 'FALSE' as checked:false", () => {
    expect(textToCell("checkbox", "FALSE", [])).toEqual({ checked: false });
  });

  it("parses 'no' as checked:false", () => {
    expect(textToCell("checkbox", "no", [])).toEqual({ checked: false });
  });

  it("parses '0' as checked:false", () => {
    expect(textToCell("checkbox", "0", [])).toEqual({ checked: false });
  });

  it("returns null for unrecognized checkbox value", () => {
    expect(textToCell("checkbox", "maybe", [])).toBeNull();
  });

  // status
  it("maps status label to option id (case-insensitive)", () => {
    expect(textToCell("status", "done", synthOptions)).toEqual({
      optionId: "o1",
    });
  });

  it("maps status label case-insensitively (mixed case)", () => {
    expect(textToCell("status", "IN PROGRESS", synthOptions)).toEqual({
      optionId: "o2",
    });
  });

  it("returns null for unrecognized status label", () => {
    expect(textToCell("status", "Blocked", synthOptions)).toBeNull();
  });

  // dropdown
  it("maps single dropdown label to optionIds array", () => {
    expect(textToCell("dropdown", "Alpha", dropdownSynthOptions)).toEqual({
      optionIds: ["d1"],
    });
  });

  it("maps multiple dropdown labels (comma-separated) to optionIds", () => {
    expect(
      textToCell("dropdown", "Alpha, Gamma", dropdownSynthOptions),
    ).toEqual({
      optionIds: ["d1", "d3"],
    });
  });

  it("trims whitespace around dropdown tokens", () => {
    expect(
      textToCell("dropdown", " Beta , Alpha ", dropdownSynthOptions),
    ).toEqual({
      optionIds: ["d2", "d1"],
    });
  });

  it("drops unrecognized dropdown tokens", () => {
    expect(
      textToCell("dropdown", "Alpha, Unknown", dropdownSynthOptions),
    ).toEqual({
      optionIds: ["d1"],
    });
  });

  it("returns null when all dropdown tokens are unrecognized", () => {
    expect(
      textToCell("dropdown", "Unknown, Missing", dropdownSynthOptions),
    ).toBeNull();
  });

  // round-trip check: cellToText → textToCell
  it("round-trips numbers through cellToText → textToCell", () => {
    const text = cellToText("numbers", { n: 99 }, {});
    expect(textToCell("numbers", text, [])).toEqual({ n: 99 });
  });

  it("round-trips checkbox (true) through cellToText → textToCell", () => {
    const text = cellToText("checkbox", { checked: true }, {});
    expect(textToCell("checkbox", text, [])).toEqual({ checked: true });
  });

  it("round-trips checkbox (false) through cellToText → textToCell", () => {
    const text = cellToText("checkbox", { checked: false }, {});
    expect(textToCell("checkbox", text, [])).toEqual({ checked: false });
  });

  it("round-trips status through cellToText → textToCell", () => {
    const text = cellToText("status", { optionId: "o1" }, statusSettings);
    expect(textToCell("status", text, synthOptions)).toEqual({
      optionId: "o1",
    });
  });
});

// ---------------------------------------------------------------------------
// cellToExcelValue
// ---------------------------------------------------------------------------
describe("cellToExcelValue", () => {
  it("returns a real number for numbers cells", () => {
    expect(cellToExcelValue("numbers", { n: 42.5 }, {})).toBe(42.5);
  });

  it("returns a real number for percent cells", () => {
    expect(cellToExcelValue("percent", { percent: 60 }, {})).toBe(60);
  });

  it("returns empty string for blank numbers/percent", () => {
    expect(cellToExcelValue("numbers", null, {})).toBe("");
    expect(cellToExcelValue("percent", { percent: "bogus" }, {})).toBe("");
  });

  it("returns the cellToText string for every other kind", () => {
    expect(
      cellToExcelValue(
        "status",
        { optionId: "o1" },
        { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
      ),
    ).toBe("Done");
    expect(cellToExcelValue("date", { date: "2026-07-03" }, {})).toBe(
      "2026-07-03",
    );
    expect(cellToExcelValue("checkbox", { checked: true }, {})).toBe("TRUE");
  });

  it("never throws on malformed input", () => {
    expect(cellToExcelValue("numbers", 7, {})).toBe("");
    expect(cellToExcelValue("percent", "x", null)).toBe("");
  });
});
