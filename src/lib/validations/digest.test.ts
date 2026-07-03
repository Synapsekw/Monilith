import { describe, expect, it } from "vitest";
import {
  digestBoardRowSchema,
  digestNotificationPayloadSchema,
} from "@/lib/validations/digest";

describe("digest schemas", () => {
  it("parses a board row and caps samples at 5", () => {
    const r = digestBoardRowSchema.safeParse({
      boardId: "11111111-1111-1111-1111-111111111111",
      boardName: "Launch plan",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 2,
      incompleteItems: 3,
      newItems: 1,
      newSample: ["Kickoff"],
      incompleteSample: ["a", "b", "c", "d", "e", "f"], // 6 → reject
    });
    expect(r.success).toBe(false);
  });

  it("parses a valid board row", () => {
    const r = digestBoardRowSchema.safeParse({
      boardId: "11111111-1111-4111-8111-111111111111",
      boardName: "Launch plan",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 2,
      incompleteItems: 3,
      newItems: 1,
      newSample: ["Kickoff"],
      incompleteSample: [],
    });
    expect(r.success).toBe(true);
  });

  it("parses the notification payload", () => {
    const r = digestNotificationPayloadSchema.safeParse({
      newCount: 4,
      incompleteCount: 3,
      overdueCount: 2,
      periodStart: "2026-06-29",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative counts", () => {
    const r = digestNotificationPayloadSchema.safeParse({
      newCount: -1,
      incompleteCount: 0,
      overdueCount: 0,
      periodStart: "2026-06-29",
    });
    expect(r.success).toBe(false);
  });
});
