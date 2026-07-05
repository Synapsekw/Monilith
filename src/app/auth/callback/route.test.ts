import { describe, expect, it } from "vitest";

import { safeNextPath } from "./route";

describe("safeNextPath (open-redirect guard)", () => {
  it("allows a rooted same-origin path", () => {
    expect(safeNextPath("/valid/path")).toBe("/valid/path");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/boards/123?tab=x")).toBe("/boards/123?tab=x");
  });

  it("rejects protocol-relative //host", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("//evil.com/path")).toBe("/");
  });

  it("rejects backslash-tricked /\\host", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com/x")).toBe("/");
  });

  it("rejects non-rooted / relative targets", () => {
    expect(safeNextPath("evil.com")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("falls back to / for null/empty", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});
