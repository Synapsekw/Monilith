import { beforeEach, describe, expect, it, vi } from "vitest";

// listSharedBoards (the uncached, RLS-client twin) reads four tables, so it
// needs a table-aware double; the generic one in queries.test.ts returns the
// same rows for every table.
type Op = [table: string, method: string, ...args: unknown[]];
let tables: Record<string, unknown[]> = {};
let ops: Op[] = [];
let order: string[] = [];

vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      order.push(table);
      const result = { data: tables[table] ?? [], error: null };
      const qb: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "limit", "order"]) {
        qb[m] = (...args: unknown[]) => {
          ops.push([table, m, ...args]);
          return qb;
        };
      }
      qb.then = (onFulfilled: (r: typeof result) => unknown) =>
        Promise.resolve(result).then(onFulfilled);
      return qb;
    },
  })),
}));

import { listSharedBoards } from "./queries";

const board = (id: string, createdBy = "someone") => ({
  id,
  name: "Plan",
  position: 0,
  created_by: createdBy,
});

beforeEach(() => {
  tables = {};
  ops = [];
  order = [];
});

describe("listSharedBoards folder path", () => {
  it("lists a folder-only board at the folder's level", async () => {
    tables = {
      board_members: [],
      folder_members: [{ folder_id: "f1", access_level: "editor" }],
      folder_boards: [{ folder_id: "f1", boards: board("b9") }],
      profiles: [{ id: "someone", full_name: "Sam Roe" }],
    };
    expect(await listSharedBoards()).toEqual([
      {
        id: "b9",
        name: "Plan",
        position: 0,
        owner_name: "Sam Roe",
        access_level: "editor",
        via: "folder",
      },
    ]);
  });

  it("drops a folder_boards row for a folder the user has no grant on", async () => {
    tables = {
      board_members: [],
      folder_members: [{ folder_id: "f1", access_level: "viewer" }],
      folder_boards: [
        { folder_id: "f1", boards: board("b9") },
        { folder_id: "f-other", boards: board("b-other") },
      ],
    };
    expect((await listSharedBoards()).map((b) => b.id)).toEqual(["b9"]);
  });

  it("lists a board granted both ways once, at the higher level", async () => {
    tables = {
      board_members: [{ access_level: "editor", boards: board("b9") }],
      folder_members: [{ folder_id: "f1", access_level: "viewer" }],
      folder_boards: [{ folder_id: "f1", boards: board("b9") }],
    };
    const out = await listSharedBoards();
    expect(out).toHaveLength(1);
    expect(out[0].access_level).toBe("editor");
    // The direct grant is what "Leave board" can remove.
    expect(out[0].via).toBe("direct");
  });

  it("leaves out a board the user created", async () => {
    tables = {
      board_members: [],
      folder_members: [{ folder_id: "f1", access_level: "viewer" }],
      folder_boards: [{ folder_id: "f1", boards: board("b1", "u1") }],
    };
    expect(await listSharedBoards()).toEqual([]);
  });

  it("issues the two grant reads together, before any placement read", async () => {
    tables = {
      board_members: [],
      folder_members: [{ folder_id: "f1", access_level: "viewer" }],
      folder_boards: [],
    };
    await listSharedBoards();
    expect(order.slice(0, 2).sort()).toEqual([
      "board_members",
      "folder_members",
    ]);
    expect(order.indexOf("folder_boards")).toBeGreaterThan(1);
  });

  it("gives each capped read a stable order", async () => {
    tables = {
      board_members: [],
      folder_members: [{ folder_id: "f1", access_level: "viewer" }],
      folder_boards: [],
    };
    await listSharedBoards();
    const asc = { ascending: true };
    expect(ops).toContainEqual(["board_members", "order", "board_id", asc]);
    expect(ops).toContainEqual(["folder_members", "order", "folder_id", asc]);
    expect(ops).toContainEqual(["folder_boards", "order", "position", asc]);
    expect(ops).toContainEqual(["folder_boards", "order", "board_id", asc]);
  });
});
