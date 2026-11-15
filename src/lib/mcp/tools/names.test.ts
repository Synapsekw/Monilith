import { describe, expect, it } from "vitest";
import { describeCellValue, nameMap } from "./names";

const names = nameMap([
  { userId: "u1", fullName: "Ana Kovac", avatarUrl: null },
  { userId: "u2", fullName: null, avatarUrl: null },
]);
const statusSettings = {
  options: [
    { id: "o1", label: "Working", color: "#111111" },
    { id: "o2", label: "Stuck", color: "#222222" },
  ],
};

describe("describeCellValue", () => {
  it("renders a status option as its label", () => {
    expect(
      describeCellValue("status", statusSettings, { optionId: "o2" }, names),
    ).toBe("Stuck");
  });
  it("renders people as names, with a fallback for an unnamed member", () => {
    expect(
      describeCellValue("people", {}, { userIds: ["u1", "u2", "u9"] }, names),
    ).toBe("Ana Kovac, Unnamed member, Unknown member");
  });
  it("renders a date range end first", () => {
    expect(
      describeCellValue(
        "date",
        {},
        { date: "2026-11-01", end: "2026-11-05" },
        names,
      ),
    ).toBe("2026-11-01 to 2026-11-05");
  });
  it("renders an empty value as (empty)", () => {
    expect(describeCellValue("text", {}, null, names)).toBe("(empty)");
  });
  it("cuts unknown shapes at 120 characters", () => {
    const out = describeCellValue("text", {}, { text: "x".repeat(300) }, names);
    expect(out.length).toBe(120);
  });
});
