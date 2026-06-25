import { beforeEach, describe, expect, it, vi } from "vitest";

// `cacheTag`/`cacheLife` throw outside a compiled `use cache` scope (the Next
// transform that no-ops them is not applied under Vitest), so stub next/cache.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// The cached reads use the service client. We stub it and assert the explicit
// identity filter is applied (the tenant boundary), then return scoped rows.
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { listMyBoardsCached } from "./queries-cached";

beforeEach(() => {
  from.mockClear();
  select.mockClear();
  eq.mockClear();
  order.mockReset();
});

describe("listMyBoardsCached", () => {
  it("filters by the passed userId (tenant boundary) and maps shared_out", async () => {
    order.mockResolvedValue({
      data: [
        {
          id: "b1",
          name: "Mine",
          workspace_id: "w1",
          position: 1,
          board_members: [{ user_id: "x" }],
        },
      ],
      error: null,
    });

    const result = await listMyBoardsCached("user-A");

    expect(from).toHaveBeenCalledWith("boards");
    expect(eq).toHaveBeenCalledWith("created_by", "user-A");
    expect(result).toEqual([
      {
        id: "b1",
        name: "Mine",
        workspace_id: "w1",
        position: 1,
        shared_out: true,
      },
    ]);
  });

  it("returns [] on error", async () => {
    order.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await listMyBoardsCached("user-A")).toEqual([]);
  });
});
