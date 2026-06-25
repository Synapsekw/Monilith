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

import { listWorkspacesCached } from "./queries-cached";

beforeEach(() => {
  from.mockClear();
  eq.mockClear();
  order.mockReset();
});

describe("listWorkspacesCached", () => {
  it("filters by orgId and selects id+name", async () => {
    order.mockResolvedValue({
      data: [{ id: "w1", name: "W" }],
      error: null,
    });
    const result = await listWorkspacesCached("org-A");
    expect(from).toHaveBeenCalledWith("workspaces");
    expect(eq).toHaveBeenCalledWith("org_id", "org-A");
    expect(result).toEqual([{ id: "w1", name: "W" }]);
  });

  it("returns [] when none", async () => {
    order.mockResolvedValue({ data: null, error: null });
    expect(await listWorkspacesCached("org-A")).toEqual([]);
  });
});
