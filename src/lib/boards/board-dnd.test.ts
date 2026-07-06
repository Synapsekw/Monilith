import { describe, expect, it } from "vitest";
import { crossGroupInsertPosition } from "./board-dnd";

const items = [
  { id: "a", position: 10 },
  { id: "b", position: 20 },
  { id: "c", position: 30 },
];

describe("crossGroupInsertPosition", () => {
  it("inserts before the over row (midpoint of neighbour above)", () => {
    // before "b": between a(10) and b(20) → 15
    expect(crossGroupInsertPosition(items, "b", false)).toBe(15);
  });

  it("inserts after the over row (midpoint of neighbour below)", () => {
    // after "b": between b(20) and c(30) → 25
    expect(crossGroupInsertPosition(items, "b", true)).toBe(25);
  });

  it("inserts before the first row (prepend)", () => {
    // before "a": midpoint(null, 10) → 5
    expect(crossGroupInsertPosition(items, "a", false)).toBe(5);
  });

  it("inserts after the last row (append)", () => {
    // after "c": midpoint(30, null) → 31
    expect(crossGroupInsertPosition(items, "c", true)).toBe(31);
  });

  it("appends when overId is not in the list", () => {
    // unknown over → append after last → 31
    expect(crossGroupInsertPosition(items, "zzz", false)).toBe(31);
  });

  it("appends into an empty group", () => {
    expect(crossGroupInsertPosition([], "zzz", false)).toBe(0);
  });
});
