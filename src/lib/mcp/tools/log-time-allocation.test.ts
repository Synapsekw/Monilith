import { beforeEach, describe, expect, it, vi } from "vitest";
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
  // The core mock lives at module scope: without a reset it accumulates calls
  // across tests and `expect(core).not.toHaveBeenCalled()` would pass or fail
  // depending on test order.
  beforeEach(() => {
    vi.clearAllMocks();
    core.mockResolvedValue({ ok: true as const, data: { durationSecs: 7200 } });
  });

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
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      date: "2026-01-05",
      secs: 7200,
      cleared: false,
      orgId: "o1",
      orgName: "Acme",
    });
  });

  it("echoes the resolved org so a defaulted orgId is visible to the agent", async () => {
    core.mockResolvedValue({ ok: true as const, data: { durationSecs: 900 } });
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      { date: "2026-01-05", category: "Admin", secs: 900 },
    );
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.orgId).toBe("o1");
    expect(payload.orgName).toBe("Acme");
  });

  it("reports `cleared` when secs is 0", async () => {
    core.mockResolvedValue({ ok: true as const, data: { durationSecs: 0 } });
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      { date: "2026-01-05", category: "Admin", secs: 0 },
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      date: "2026-01-05",
      secs: 0,
      cleared: true,
      orgId: "o1",
      orgName: "Acme",
    });
  });

  it("rejects a call with neither itemId nor category, without writing", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await logTimeAllocationHandler(getClient, "u1", {
      date: "2026-01-05",
      secs: 7200,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("itemId");
    expect(getClient).not.toHaveBeenCalled();
    expect(core).not.toHaveBeenCalled();
  });

  it("rejects a call with BOTH itemId and category, without writing", async () => {
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
    // The guard must stay BEFORE the write: a refactor that reordered them
    // would leave a row behind for an ambiguous call.
    expect(core).not.toHaveBeenCalled();
  });

  it("surfaces a foreign orgId as an error, without writing", async () => {
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
    expect(result.content[0]!.text).toContain("o-foreign");
    // The org check must stay BEFORE the write, not after it.
    expect(core).not.toHaveBeenCalled();
  });

  it("surfaces a core failure as an error", async () => {
    core.mockResolvedValue({
      ok: false,
      error: "new row violates row-level security policy",
    } as never);
    const result = await logTimeAllocationHandler(
      async () => ({}) as never,
      "u1",
      { date: "2026-01-05", itemId: "i1", secs: 3600 },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("row-level security");
  });
});
