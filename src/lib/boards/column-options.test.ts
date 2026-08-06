import { describe, expect, it } from "vitest";
import { parseColumnOptions } from "./column-options";

describe("parseColumnOptions", () => {
  it("parses a well-formed options array", () => {
    expect(
      parseColumnOptions({
        options: [{ id: "s1", label: "Working on it", color: "amber" }],
      }),
    ).toEqual([{ id: "s1", label: "Working on it", color: "amber" }]);
  });

  it("returns [] for settings that carry no options", () => {
    expect(parseColumnOptions({})).toEqual([]);
    expect(parseColumnOptions({ currency: "KWD" })).toEqual([]);
  });

  it("returns [] for null, undefined, and non-object settings", () => {
    expect(parseColumnOptions(null)).toEqual([]);
    expect(parseColumnOptions(undefined)).toEqual([]);
    expect(parseColumnOptions("not an object")).toEqual([]);
    expect(parseColumnOptions(42)).toEqual([]);
  });

  // Documents EXISTING board-snapshot behaviour, deliberately preserved: the
  // array is parsed as a whole, so one malformed entry discards all of them
  // rather than silently returning a partial list an agent would trust.
  it("discards the whole array when any entry is malformed", () => {
    expect(
      parseColumnOptions({
        options: [
          { id: "s1", label: "Good", color: "amber" },
          { id: "s2", label: "Missing color" },
        ],
      }),
    ).toEqual([]);
  });
});
