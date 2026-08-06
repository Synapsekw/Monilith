import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkloadHandler } from "./get-workload";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
  listOrgMemberProfiles: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", avatarUrl: null },
    { userId: "u2", fullName: "Grace", avatarUrl: null },
  ]),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workload/queries", () => ({ getWorkloadSummaryCore: core }));

describe("getWorkloadHandler", () => {
  beforeEach(() => {
    core.mockReset();
  });

  it("returns per-member load for the window", async () => {
    core.mockResolvedValue([
      {
        userId: "u1",
        name: "Ada",
        allocatedSecs: 5400,
        itemCount: 2,
        capacitySecs: 144000,
      },
      {
        userId: "u2",
        name: "Grace",
        allocatedSecs: 0,
        itemCount: 1,
        capacitySecs: 72000,
      },
    ]);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getWorkloadHandler(getClient, {
      from: "2026-01-05",
      to: "2026-01-09",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "o1",
        from: "2026-01-05",
        to: "2026-01-09",
      }),
    );
    expect(JSON.parse(result.content[0].text)).toEqual({
      from: "2026-01-05",
      to: "2026-01-09",
      members: [
        {
          userId: "u1",
          name: "Ada",
          allocatedSecs: 5400,
          itemCount: 2,
          capacitySecs: 144000,
        },
        {
          userId: "u2",
          name: "Grace",
          allocatedSecs: 0,
          itemCount: 1,
          capacitySecs: 72000,
        },
      ],
    });
  });

  it("defaults to the next four weeks when from/to are omitted", async () => {
    core.mockResolvedValue([]);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getWorkloadHandler(getClient, {});

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.from).toBeDefined();
    expect(payload.to).toBeDefined();
    expect(payload.from <= payload.to).toBe(true);
  });

  it("rejects an over-long range without touching the client or the core", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getWorkloadHandler(getClient, {
      from: "2026-01-01",
      to: "2027-01-01",
    });
    expect(result.isError).toBe(true);
    expect(getClient).not.toHaveBeenCalled();
    expect(core).not.toHaveBeenCalled();
  });

  it("surfaces a foreign orgId as an error without calling the core", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getWorkloadHandler(getClient, {
      orgId: "o-foreign",
      from: "2026-01-05",
      to: "2026-01-09",
    });
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(core).not.toHaveBeenCalled();
  });
});
