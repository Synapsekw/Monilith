import { beforeEach, describe, expect, it, vi } from "vitest";
import { listDashboardsHandler } from "./list-dashboards";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/queries", () => ({
  DASHBOARD_LIST_LIMIT: 100,
  listDashboardsCore: core,
}));

describe("listDashboardsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists dashboards in the resolved org", async () => {
    core.mockResolvedValue([
      { id: "d1", name: "Delivery" },
      { id: "d2", name: "Marketing" },
    ]);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await listDashboardsHandler(getClient, {});

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledWith(expect.anything(), "o1");
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "d1", name: "Delivery" },
      { id: "d2", name: "Marketing" },
    ]);
  });

  it("surfaces a foreign orgId as an error without querying dashboards", async () => {
    const getClient = vi.fn(async () => ({}) as never);

    const result = await listDashboardsHandler(getClient, {
      orgId: "o-foreign",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(core).not.toHaveBeenCalled();
  });
});
