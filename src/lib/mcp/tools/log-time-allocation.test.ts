import { describe, expect, it, vi } from "vitest";
import { logTimeAllocationHandler } from "./log-time-allocation";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

const core = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, data: { durationSecs: 7200 } })),
);
vi.mock("@/lib/time/allocation-core", () => ({
  upsertTimeAllocationCore: core,
}));

describe("logTimeAllocationHandler", () => {
  it("writes an item allocation as the connected user", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await logTimeAllocationHandler(getClient, "u1", {
      date: "2026-01-05",
      itemId: "i1",
      secs: 7200,
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workDate: "2026-01-05",
        itemId: "i1",
        durationSecs: 7200,
      }),
      { userId: "u1", orgId: "o1" },
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      date: "2026-01-05",
      secs: 7200,
    });
  });

  it("rejects a call with neither itemId nor category", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await logTimeAllocationHandler(getClient, "u1", {
      date: "2026-01-05",
      secs: 7200,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("itemId");
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects a call with BOTH itemId and category", async () => {
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      {
        date: "2026-01-05",
        itemId: "i1",
        category: "Admin",
        secs: 7200,
      },
    );
    expect(result.isError).toBe(true);
  });

  it("surfaces a foreign orgId as an error", async () => {
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      {
        orgId: "o-foreign",
        date: "2026-01-05",
        category: "Admin",
        secs: 900,
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("o-foreign");
  });
});
