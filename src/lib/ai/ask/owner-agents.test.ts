import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import { listOwnerAgentTargets, ASK_AGENTS_LIMIT } from "./owner-agents";

/** `.select().eq().eq().order().limit()` — the shape the reader builds. */
function stubQuery(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const eqEnabled = vi.fn().mockReturnValue({ order });
  const eqOwner = vi.fn().mockReturnValue({ eq: eqEnabled });
  const select = vi.fn().mockReturnValue({ eq: eqOwner });
  from.mockReturnValue({ select });
  return { select, eqOwner, eqEnabled, limit };
}

beforeEach(() => from.mockReset());

describe("listOwnerAgentTargets", () => {
  it("returns the owner's enabled agents as mention targets", async () => {
    const q = stubQuery({
      data: [{ id: "a1", handle: "ops", name: "Ops Chaser" }],
      error: null,
    });

    const targets = await listOwnerAgentTargets("user-1");

    expect(targets).toEqual([
      { kind: "agent", agentId: "a1", handle: "ops", name: "Ops Chaser" },
    ]);
    expect(from).toHaveBeenCalledWith("user_agents");
    expect(q.eqOwner).toHaveBeenCalledWith("owner_id", "user-1");
    expect(q.eqEnabled).toHaveBeenCalledWith("enabled", true);
    expect(q.limit).toHaveBeenCalledWith(ASK_AGENTS_LIMIT);
  });

  it("degrades to no picker rather than failing the page", async () => {
    stubQuery({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(listOwnerAgentTargets("user-1")).resolves.toEqual([]);

    spy.mockRestore();
  });
});
