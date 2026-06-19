import { describe, expect, it } from "vitest";
import { reorderPosition } from "./group-reorder";

const groups = [
  { id: "a", position: 0 },
  { id: "b", position: 1 },
  { id: "c", position: 2 },
  { id: "d", position: 3 },
];

describe("reorderPosition", () => {
  it("returns null for a no-op (same id)", () => {
    expect(reorderPosition(groups, "b", "b")).toBeNull();
  });

  it("returns null when an id is not present", () => {
    expect(reorderPosition(groups, "x", "a")).toBeNull();
  });

  it("moves down: a dropped over c lands between c and d", () => {
    expect(reorderPosition(groups, "a", "c")).toBe(2.5);
  });

  it("moves up: d dropped over b lands between a and b", () => {
    expect(reorderPosition(groups, "d", "b")).toBe(0.5);
  });

  it("moves to top: d dropped over a lands below the current top", () => {
    expect(reorderPosition(groups, "d", "a")).toBe(-1);
  });

  it("moves to bottom: a dropped over d lands above the current bottom", () => {
    expect(reorderPosition(groups, "a", "d")).toBe(4);
  });
});
