import { afterEach, describe, expect, it, vi } from "vitest";

// Cached-session source (must be used instead of a network auth round-trip),
// mirroring the queries.test.ts pattern.
const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ id: "u1", email: "u@x.com" }) as unknown),
}));
vi.mock("@/lib/auth/session", () => ({ getUser }));

// Records every filter call on the `boards` query chain so the test can assert
// the read is scoped to the current user + archived rows only.
const calls = vi.hoisted(() => ({
  from: [] as string[],
  eq: [] as [string, unknown][],
  is: [] as [string, unknown][],
  not: [] as [string, string, unknown][],
  in: [] as [string, unknown][],
  order: [] as unknown[],
  limit: [] as number[],
  rows: [] as unknown[], // boards rows
  profileRows: [] as unknown[], // profiles rows
}));

function makeChain(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return chain;
    },
    is: (col: string, val: unknown) => {
      calls.is.push([col, val]);
      return chain;
    },
    not: (col: string, op: string, val: unknown) => {
      calls.not.push([col, op, val]);
      return chain;
    },
    in: (col: string, val: unknown) => {
      calls.in.push([col, val]);
      return chain;
    },
    order: (o: unknown) => {
      calls.order.push(o);
      return chain;
    },
    limit: (n: number) => {
      calls.limit.push(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data: table === "profiles" ? calls.profileRows : calls.rows,
        error: null,
      }).then(onF),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      calls.from.push(table);
      return makeChain(table);
    },
  })),
}));

import { getArchivedBoards } from "./trash-queries";

afterEach(() => {
  vi.clearAllMocks();
  calls.from.length = 0;
  calls.eq.length = 0;
  calls.is.length = 0;
  calls.not.length = 0;
  calls.in.length = 0;
  calls.order.length = 0;
  calls.limit.length = 0;
  calls.rows.length = 0;
  calls.profileRows.length = 0;
  getUser.mockResolvedValue({ id: "u1", email: "u@x.com" } as unknown);
});

describe("getArchivedBoards", () => {
  it("filters to the current user's archived boards (created_by = me, archived_at not null)", async () => {
    calls.rows.push({
      id: "b1",
      name: "Old board",
      workspace_id: "w1",
      archived_at: "2026-07-06T00:00:00Z",
      archived_by: null,
    });

    const result = await getArchivedBoards();

    expect(getUser).toHaveBeenCalled();
    expect(calls.from).toContain("boards");
    // Scoped to the caller (owner) …
    expect(calls.eq).toContainEqual(["created_by", "u1"]);
    // … and to archived rows only (never live boards).
    expect(calls.not).toContainEqual(["archived_at", "is", null]);
    expect(calls.is).toHaveLength(0);
    // Bounded read.
    expect(calls.limit).toContain(200);
    expect(result).toEqual([
      {
        id: "b1",
        name: "Old board",
        workspace_id: "w1",
        archived_at: "2026-07-06T00:00:00Z",
        archived_by: null,
        archived_by_name: null,
      },
    ]);
  });

  it("selects archived_by and resolves it to a display name via one profiles lookup", async () => {
    calls.rows.push({
      id: "b1",
      name: "Old board",
      workspace_id: "w1",
      archived_at: "2026-07-06T00:00:00Z",
      archived_by: "u1",
    });
    calls.profileRows.push({ id: "u1", full_name: "Ada Lovelace" });

    const result = await getArchivedBoards();

    expect(calls.from).toContain("boards");
    expect(calls.from).toContain("profiles");
    // exactly one profiles lookup, keyed by the distinct archived_by ids
    expect(calls.from.filter((t) => t === "profiles")).toHaveLength(1);
    expect(calls.in).toContainEqual(["id", ["u1"]]);
    expect(result).toEqual([
      {
        id: "b1",
        name: "Old board",
        workspace_id: "w1",
        archived_at: "2026-07-06T00:00:00Z",
        archived_by: "u1",
        archived_by_name: "Ada Lovelace",
      },
    ]);
  });

  it("skips the profiles lookup when no board has a non-null archived_by", async () => {
    calls.rows.push({
      id: "b1",
      name: "Old board",
      workspace_id: "w1",
      archived_at: "2026-07-06T00:00:00Z",
      archived_by: null,
    });

    const result = await getArchivedBoards();

    expect(calls.from).not.toContain("profiles");
    expect(result[0]!.archived_by_name).toBeNull();
  });

  it("returns an empty list (no query) when there is no authenticated user", async () => {
    getUser.mockResolvedValue(null as unknown);

    const result = await getArchivedBoards();

    expect(result).toEqual([]);
    expect(calls.from).not.toContain("boards");
  });
});
