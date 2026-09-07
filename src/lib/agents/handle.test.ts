import { describe, expect, it } from "vitest";
import { handleSchema, slugifyHandle, RESERVED_HANDLES } from "./handle";

describe("handleSchema", () => {
  it.each(["ops", "ops-chaser", "a1", "x".repeat(32)])("accepts %s", (h) => {
    expect(handleSchema.safeParse(h).success).toBe(true);
  });
  it.each(["a", "Ops", "ops chaser", "-ops", "ops!", "x".repeat(33), ""])(
    "rejects %s",
    (h) => expect(handleSchema.safeParse(h).success).toBe(false),
  );
  it("rejects every reserved handle", () => {
    for (const r of RESERVED_HANDLES) {
      expect(handleSchema.safeParse(r).success).toBe(false);
    }
  });
});

describe("slugifyHandle", () => {
  const ID = "9f1c2b3d-0000-4000-8000-000000000000";
  it("slugifies a display name", () => {
    expect(slugifyHandle("Overdue Chaser", ID)).toBe("overdue-chaser");
  });
  it("collapses punctuation and trims hyphens", () => {
    expect(slugifyHandle("  Risk // Spotter!  ", ID)).toBe("risk-spotter");
  });
  it("falls back to the id when the slug is empty", () => {
    expect(slugifyHandle("!!!", ID)).toBe("agent-9f1c2b3d");
  });
  it("falls back to the id when the slug is reserved", () => {
    expect(slugifyHandle("System", ID)).toBe("agent-9f1c2b3d");
  });
  it("truncates to HANDLE_MAX", () => {
    expect(slugifyHandle("x".repeat(80), ID)).toHaveLength(32);
  });
  it("always produces something handleSchema accepts", () => {
    for (const n of ["", "  ", "A", "ops", "!!!", "x".repeat(99)]) {
      expect(handleSchema.safeParse(slugifyHandle(n, ID)).success).toBe(true);
    }
  });
});
