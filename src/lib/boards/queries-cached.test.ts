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
  qb.is = (col: string, val: unknown) => chain("is:" + col, val);
  qb.order = () => Promise.resolve({ data: rows, error });
  return {
    client: { from: () => ({ select: () => qb }) },
    calls,
  };
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
import { createServiceClient } from "@/lib/supabase/service";
import { cacheTag } from "next/cache";
import { listMyBoardsCached, listSharedBoardsCached } from "./queries-cached";

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

// Table-aware double for listSharedBoardsCached, which reads five tables.
// Every chain method returns the same thenable, so whichever call ends a chain
// (`.order()`, `.limit()`, `.is()`, `.in()`) resolves to that table's rows.
function makeTableClient(tables: Record<string, unknown[]>) {
  const seen: string[] = [];
  const eqs: Array<[string, string, unknown]> = [];
  const from = (table: string) => {
    seen.push(table);
    const result = { data: tables[table] ?? [], error: null };
    const qb: Record<string, unknown> = {};
    for (const m of ["select", "is", "in", "limit", "order"]) {
      qb[m] = () => qb;
    }
    qb.eq = (col: string, val: unknown) => {
      eqs.push([table, col, val]);
      return qb;
    };
    qb.then = (onFulfilled: (r: typeof result) => unknown) =>
      Promise.resolve(result).then(onFulfilled);
    return qb;
  };
  return { client: { from }, seen, eqs };
}

describe("listSharedBoardsCached", () => {
  const board = (id: string, createdBy = "someone", orgId = "o1") => ({
    id,
    name: "Plan",
    position: 0,
    created_by: createdBy,
    org_id: orgId,
  });
  const folderBoard = { folder_id: "f1", boards: board("b9") };
  const editorOfF1 = { folder_id: "f1", org_id: "o1", access_level: "editor" };

  it("adds a board reached only through a folder, at the folder's level", async () => {
    const { client, eqs } = makeTableClient({
      board_members: [],
      org_members: [{ org_id: "o1" }],
      folder_members: [editorOfF1],
      folder_boards: [folderBoard],
      profiles: [{ id: "someone", full_name: "Sam Roe" }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([
      {
        id: "b9",
        name: "Plan",
        position: 0,
        owner_name: "Sam Roe",
        access_level: "editor",
      },
    ]);
    // Every per-user read is keyed by the id passed in (the tenant boundary).
    for (const t of ["board_members", "org_members", "folder_members"]) {
      expect(eqs).toContainEqual([t, "user_id", "u1"]);
    }
  });

  it("ignores a folder membership in an org the user is no longer active in", async () => {
    const { client, seen } = makeTableClient({
      board_members: [],
      org_members: [],
      folder_members: [editorOfF1],
      folder_boards: [folderBoard],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([]);
    // With no live folder membership the placements are never read at all.
    expect(seen).not.toContain("folder_boards");
  });

  it("ignores a board whose org differs from the folder membership's org", async () => {
    const { client } = makeTableClient({
      board_members: [],
      org_members: [{ org_id: "o1" }, { org_id: "o2" }],
      folder_members: [editorOfF1],
      folder_boards: [{ folder_id: "f1", boards: board("b9", "x", "o2") }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([]);
  });

  it("ignores a direct grant on a board in an org the user is no longer active in", async () => {
    const { client } = makeTableClient({
      board_members: [{ access_level: "viewer", boards: board("b9") }],
      org_members: [{ org_id: "o-other" }],
      folder_members: [],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([]);
  });

  it("lists a board once, at the higher level, when granted both ways", async () => {
    const { client } = makeTableClient({
      board_members: [{ access_level: "viewer", boards: board("b9") }],
      org_members: [{ org_id: "o1" }],
      folder_members: [editorOfF1],
      folder_boards: [folderBoard],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    const out = await listSharedBoardsCached("u1");
    expect(out).toHaveLength(1);
    expect(out[0].access_level).toBe("editor");
  });

  it("leaves out a board the user created, even inside their folder", async () => {
    const { client } = makeTableClient({
      board_members: [],
      org_members: [{ org_id: "o1" }],
      folder_members: [{ ...editorOfF1, access_level: "viewer" }],
      folder_boards: [{ folder_id: "f1", boards: board("b1", "u1") }],
    });
    vi.mocked(createServiceClient).mockReturnValue(client as never);

    expect(await listSharedBoardsCached("u1")).toEqual([]);
  });

  it("is tagged so share, unshare and org removal all invalidate it", async () => {
    const { client } = makeTableClient({});
    vi.mocked(createServiceClient).mockReturnValue(client as never);
    vi.mocked(cacheTag).mockClear();

    await listSharedBoardsCached("u1");

    expect(cacheTag).toHaveBeenCalledWith(
      "shared-boards:user:u1",
      "folder-members:user:u1",
    );
  });
});
