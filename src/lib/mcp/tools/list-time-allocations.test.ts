import { describe, expect, it, vi } from "vitest";
import { listTimeAllocationsHandler } from "./list-time-allocations";

vi.mock("@/lib/time/queries", () => ({
  TIME_ALLOCATIONS_LIMIT: 1000,
  TIME_RANGE_MAX_DAYS: 92,
  listTimeAllocationsCore: vi.fn(async () => [
    {
      date: "2026-01-01",
      itemId: "i1",
      itemName: "API",
      boardId: "b1",
      category: null,
      secs: 3600,
      note: "morning",
    },
  ]),
}));

describe("listTimeAllocationsHandler", () => {
  it("returns flat rows for a valid range", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await listTimeAllocationsHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-01-31",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        date: "2026-01-01",
        itemId: "i1",
        itemName: "API",
        boardId: "b1",
        category: null,
        secs: 3600,
        note: "morning",
      },
    ]);
  });

  it("rejects an over-long range without touching the client", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await listTimeAllocationsHandler(getClient, "u1", {
      from: "2026-01-01",
      to: "2026-12-31",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("92");
    expect(getClient).not.toHaveBeenCalled();
  });
});
