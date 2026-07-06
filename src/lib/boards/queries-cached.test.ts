import { describe, expect, it, vi } from "vitest";

// `cacheTag`/`cacheLife` throw outside a compiled `use cache` scope (the Next
// transform that no-ops them is not applied under Vitest), so stub next/cache.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Chainable query-builder stub that records every filter applied, so tests can
// assert exact `.eq(...)` calls regardless of how many are chained (needed to
// cover the optional workspace_id filter on top of the tenant filter).
function makeClient(rows: unknown[] | null, error: unknown = null) {
  const calls: Array<[string, unknown]> = [];
  const qb: Record<string, unknown> = {};
  const chain = (name: string, val?: unknown) => {
    if (val !== undefined) calls.push([name, val]);
    return qb;
  };
  qb.select = () => chain("select");
  qb.eq = (col: string, val: unknown) => chain("eq:" + col, val);
  qb.order = () => Promise.resolve({ data: rows, error });
  return {
    client: { from: () => ({ select: () => qb }) },
    calls,
  };
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { listMyBoardsCached } from "./queries-cached";

describe("listMyBoardsCached", () => {
  it("filters by the passed userId (tenant boundary) and maps shared_out", async () => {
    const { client, calls } = makeClient([
      {
        id: "b1",
        name: "Mine",
        workspace_id: "w1",
        position: 1,
        board_members: [{ user_id: "x" }],
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const result = await listMyBoardsCached("user-A");

    expect(calls).toContainEqual(["eq:created_by", "user-A"]);
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
    const { client } = makeClient(null, { message: "x" });
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    expect(await listMyBoardsCached("user-A")).toEqual([]);
  });
});

describe("listMyBoardsCached workspace scoping", () => {
  it("adds a workspace_id filter when a workspaceId is passed", async () => {
    const { client, calls } = makeClient([]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    await listMyBoardsCached("u1", "w2");
    expect(calls).toContainEqual(["eq:created_by", "u1"]);
    expect(calls).toContainEqual(["eq:workspace_id", "w2"]);
  });

  it("omits the workspace filter when no workspaceId is passed", async () => {
    const { client, calls } = makeClient([]);
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    await listMyBoardsCached("u1");
    expect(calls).not.toContainEqual(["eq:workspace_id", expect.anything()]);
  });
});
