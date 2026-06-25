import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

let currentClient: unknown;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

import {
  createDashboard,
  renameDashboard,
  deleteDashboard,
  duplicateDashboard,
} from "./actions";

const WS = "11111111-1111-4111-8111-111111111111";
const DASH = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  updateTag.mockReset();
});

describe("dashboard mutation invalidation", () => {
  it("createDashboard updates the org dashboards tag", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: DASH, org_id: "org-1" },
      error: null,
    }));
    currentClient = { rpc };
    const res = await createDashboard({ workspaceId: WS, name: "D" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-1");
  });

  it("renameDashboard updates the org dashboards tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: DASH, org_id: "org-2" },
      error: null,
    }));
    const from = vi.fn(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle }) }),
      }),
    }));
    currentClient = { from };
    const res = await renameDashboard({ dashboardId: DASH, name: "New" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-2");
  });

  it("deleteDashboard updates the org dashboards tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { org_id: "org-3" },
      error: null,
    }));
    const del = vi.fn(() => ({
      eq: () => ({ select: () => ({ maybeSingle }) }),
    }));
    const from = vi.fn(() => ({ delete: del }));
    currentClient = { from };
    const res = await deleteDashboard({ dashboardId: DASH });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-3");
  });

  it("duplicateDashboard updates the org dashboards tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { org_id: "org-4" },
      error: null,
    }));
    const rpc = vi.fn(async () => ({ data: { id: "new-dash" }, error: null }));
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }));
    currentClient = { rpc, from };
    const res = await duplicateDashboard({ dashboardId: DASH });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-4");
  });
});
