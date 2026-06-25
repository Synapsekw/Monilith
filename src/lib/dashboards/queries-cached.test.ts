import { beforeEach, describe, expect, it, vi } from "vitest";

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { listDashboardsCached } from "./queries-cached";

beforeEach(() => {
  from.mockClear();
  eq.mockClear();
  order.mockReset();
});

describe("listDashboardsCached", () => {
  it("filters by orgId (tenant boundary)", async () => {
    order.mockResolvedValue({ data: [{ id: "d1", name: "D" }], error: null });
    const result = await listDashboardsCached("org-A");
    expect(from).toHaveBeenCalledWith("dashboards");
    expect(eq).toHaveBeenCalledWith("org_id", "org-A");
    expect(result).toEqual([{ id: "d1", name: "D" }]);
  });

  it("returns [] when none", async () => {
    order.mockResolvedValue({ data: null, error: null });
    expect(await listDashboardsCached("org-A")).toEqual([]);
  });
});
