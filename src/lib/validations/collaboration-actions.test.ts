import { describe, it, expect } from "vitest";
import {
  addUpdateSchema,
  editUpdateSchema,
  deleteUpdateSchema,
} from "@/lib/validations/collaboration-actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";

describe("collaboration validation", () => {
  it("accepts a valid add-update payload", () => {
    const r = addUpdateSchema.safeParse({ itemId: ITEM, text: "hello" });
    expect(r.success).toBe(true);
  });
  it("rejects empty text", () => {
    expect(addUpdateSchema.safeParse({ itemId: ITEM, text: "" }).success).toBe(
      false,
    );
  });
  it("rejects a non-uuid itemId", () => {
    expect(
      addUpdateSchema.safeParse({ itemId: "nope", text: "x" }).success,
    ).toBe(false);
  });
  it("validates edit + delete payloads", () => {
    expect(
      editUpdateSchema.safeParse({ updateId: UPD, text: "edited" }).success,
    ).toBe(true);
    expect(deleteUpdateSchema.safeParse({ updateId: UPD }).success).toBe(true);
    expect(deleteUpdateSchema.safeParse({ updateId: "bad" }).success).toBe(
      false,
    );
  });
});
