import { describe, expect, it } from "vitest";
import {
  addManualEntrySchema,
  startTimerSchema,
} from "@/lib/validations/board-actions";

describe("time action schemas", () => {
  it("rejects a bad uuid", () => {
    expect(
      startTimerSchema.safeParse({ itemId: "x", columnId: "y" }).success,
    ).toBe(false);
  });
  it("rejects non-positive duration", () => {
    expect(
      addManualEntrySchema.safeParse({
        itemId: "00000000-0000-0000-0000-000000000000",
        columnId: "00000000-0000-0000-0000-000000000000",
        date: "2026-06-20",
        durationSecs: 0,
      }).success,
    ).toBe(false);
  });
});
