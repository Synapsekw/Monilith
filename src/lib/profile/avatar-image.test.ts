import { describe, expect, it } from "vitest";
import { squareCrop } from "@/lib/profile/avatar-image";

describe("squareCrop", () => {
  it("center-crops a landscape image to a centered square", () => {
    expect(squareCrop(200, 100)).toEqual({ sx: 50, sy: 0, size: 100 });
  });
  it("center-crops a portrait image to a centered square", () => {
    expect(squareCrop(100, 200)).toEqual({ sx: 0, sy: 50, size: 100 });
  });
  it("leaves a square image unchanged", () => {
    expect(squareCrop(100, 100)).toEqual({ sx: 0, sy: 0, size: 100 });
  });
});
