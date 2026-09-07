import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import {
  listAgentNamesByIds,
  listOwnerAgentTargets,
  ASK_AGENTS_LIMIT,
} from "./owner-agents";

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

describe("listAgentNamesByIds", () => {
  /** `.select().in().limit()` — the shape the name reader builds. */
  function stubNames(result: { data: unknown; error: unknown }) {
    const limit = vi.fn().mockResolvedValue(result);
    const inFilter = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ in: inFilter });
    from.mockReturnValue({ select });
    return { select, inFilter, limit };
  }

  it("names agents by id, de-duplicated and bounded", async () => {
    const q = stubNames({
      data: [{ id: "a1", name: "Ops" }],
      error: null,
    });

    const names = await listAgentNamesByIds(["a1", "a1"]);

    expect(names).toEqual({ a1: "Ops" });
    expect(q.inFilter).toHaveBeenCalledWith("id", ["a1"]);
    expect(q.limit).toHaveBeenCalledWith(ASK_AGENTS_LIMIT);
  });

  // The whole point of this read: `listOwnerAgentTargets` is enabled-only, so
  // without it a turn answered by an agent the owner has since disabled would
  // be relabelled "Monolith" — history rewritten by today's setting.
  it("does not filter on enabled — a disabled agent's past turns keep their name", async () => {
    const q = stubNames({ data: [{ id: "a1", name: "Ops" }], error: null });
    await listAgentNamesByIds(["a1"]);
    expect(q.select).toHaveBeenCalledWith("id, name");
    // `.in()` is the only filter in the chain; there is no `.eq("enabled", …)`
    // to reach, because the builder never offers one.
    expect(q.inFilter.mock.results[0].value).not.toHaveProperty("eq");
  });

  it("reads nothing at all for a thread with no agent turns", async () => {
    expect(await listAgentNamesByIds([])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it("degrades to no names rather than failing the thread", async () => {
    stubNames({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(listAgentNamesByIds(["a1"])).resolves.toEqual({});
    spy.mockRestore();
  });
});
