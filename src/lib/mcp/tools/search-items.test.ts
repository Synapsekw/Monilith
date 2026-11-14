import { beforeEach, describe, expect, it, vi } from "vitest";

const semanticSearchCore = vi.fn();
vi.mock("@/lib/ai/embeddings/semantic-core", () => ({
  semanticSearchCore: (...a: unknown[]) => semanticSearchCore(...a),
}));

import {
  SEARCH_LIMIT,
  searchItemsDescriptor,
  searchItemsHandler,
} from "./search-items";

type Call = [method: string, ...args: unknown[]];
type Rec = { table: string; calls: Call[] };

/**
 * A chainable, awaitable query double. It records every builder call so a test
 * can assert the filters the handler asked for, and resolves to the rows given
 * for the table (or an error).
 */
function fakeClient(
  tables: Record<string, unknown[]>,
  errors: Record<string, string> = {},
) {
  const recs: Rec[] = [];
  const client = {
    from(table: string) {
      const rec: Rec = { table, calls: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "ilike", "order", "limit"]) {
        b[m] = (...args: unknown[]) => {
          rec.calls.push([m, ...args]);
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: tables[table] ?? [], error: null },
        );
      return b;
    },
  };
  const getClient = vi.fn(async () => client as never);
  const reads = (table: string) => recs.filter((r) => r.table === table);
  return { getClient, reads };
}

const ORG = { id: "o1", name: "Acme", timezone: "UTC" };
const body = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0].text);

beforeEach(() => {
  semanticSearchCore.mockReset();
  semanticSearchCore.mockResolvedValue({ ok: true, items: [] });
});

describe("searchItemsHandler", () => {
  it("org scope: merges name matches with semantic matches, name first", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [{ id: "i1", name: "Vendor contract", board_id: "b1" }],
      boards: [{ id: "b1", name: "Legal" }],
    });
    semanticSearchCore.mockResolvedValue({
      ok: true,
      items: [
        {
          id: "i1",
          name: "Vendor contract",
          boardId: "b1",
          boardName: "Legal",
        },
        { id: "i2", name: "Supplier terms", boardId: "b2", boardName: "Ops" },
      ],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "contract",
    });

    expect(body(res)).toEqual({
      items: [
        {
          id: "i1",
          name: "Vendor contract",
          boardId: "b1",
          board: "Legal",
          matchedOn: "name",
        },
        {
          id: "i2",
          name: "Supplier terms",
          boardId: "b2",
          board: "Ops",
          matchedOn: "content",
        },
      ],
      semantic: true,
      truncated: false,
    });
    expect(fake.reads("items")[0].calls).toContainEqual(["eq", "org_id", "o1"]);
    expect(semanticSearchCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "o1", userId: "u1", query: "contract" }),
    );
    expect(fake.getClient).toHaveBeenCalledTimes(1);
  });

  it("board scope: filters both reads to that board", async () => {
    const fake = fakeClient({ organizations: [ORG] });

    await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
      boardId: "b1",
    });

    expect(fake.reads("items")[0].calls).toContainEqual([
      "in",
      "board_id",
      ["b1"],
    ]);
    expect(semanticSearchCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boardIds: ["b1"] }),
    );
  });

  it("folder scope: limits both reads to the folder's boards", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      folder_boards: [{ board_id: "b1" }, { board_id: "b2" }],
    });

    await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
      folderId: "f1",
    });

    expect(fake.reads("folder_boards")[0].calls).toContainEqual([
      "eq",
      "folder_id",
      "f1",
    ]);
    expect(fake.reads("items")[0].calls).toContainEqual([
      "in",
      "board_id",
      ["b1", "b2"],
    ]);
    expect(semanticSearchCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boardIds: ["b1", "b2"] }),
    );
  });

  it("empty folder: answers empty without searching", async () => {
    const fake = fakeClient({ organizations: [ORG], folder_boards: [] });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
      folderId: "f1",
    });

    expect(body(res)).toEqual({ items: [], semantic: true, truncated: false });
    expect(fake.reads("items")).toHaveLength(0);
    expect(semanticSearchCore).not.toHaveBeenCalled();
  });

  it("semantic unavailable: returns name matches, says names only", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [{ id: "i1", name: "Fix login bug", board_id: "b1" }],
      boards: [{ id: "b1", name: "Web" }],
    });
    semanticSearchCore.mockResolvedValue({ ok: false });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
    });
    const parsed = body(res);

    expect(parsed.semantic).toBe(false);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.note).toContain("names only");
  });

  it("refuses boardId and folderId together before opening a client", async () => {
    const fake = fakeClient({});

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
      boardId: "b1",
      folderId: "f1",
    });

    expect(res.isError).toBe(true);
    expect(fake.getClient).not.toHaveBeenCalled();
  });

  it("drops a name match whose board is archived or unreadable", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [
        { id: "i1", name: "Live", board_id: "b1" },
        { id: "i2", name: "Gone", board_id: "b-archived" },
      ],
      boards: [{ id: "b1", name: "Web" }],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", { query: "li" });

    expect(body(res).items.map((i: { id: string }) => i.id)).toEqual(["i1"]);
  });

  it("over-fetches by one and says so when name matches were truncated", async () => {
    const rows = Array.from({ length: SEARCH_LIMIT + 1 }, (_, n) => ({
      id: `i${n}`,
      name: `Bug ${n}`,
      board_id: "b1",
    }));
    const fake = fakeClient({
      organizations: [ORG],
      items: rows,
      boards: [{ id: "b1", name: "Web" }],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "bug",
    });
    const parsed = body(res);

    expect(fake.reads("items")[0].calls).toContainEqual([
      "limit",
      SEARCH_LIMIT + 1,
    ]);
    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(true);
  });

  it("does not claim truncation when matches exactly fill the limit", async () => {
    const rows = Array.from({ length: SEARCH_LIMIT }, (_, n) => ({
      id: `i${n}`,
      name: `Bug ${n}`,
      board_id: "b1",
    }));
    const fake = fakeClient({
      organizations: [ORG],
      items: rows,
      boards: [{ id: "b1", name: "Web" }],
    });

    const parsed = body(
      await searchItemsHandler(fake.getClient, "u1", { query: "bug" }),
    );

    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(false);
  });

  it("surfaces a name query error", async () => {
    const fake = fakeClient({ organizations: [ORG] }, { items: "boom" });

    const res = await searchItemsHandler(fake.getClient, "u1", { query: "xx" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("boom");
  });

  it("surfaces an org the caller is not a member of", async () => {
    const fake = fakeClient({ organizations: [ORG] });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "xx",
      orgId: "other",
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not a member/);
    expect(semanticSearchCore).not.toHaveBeenCalled();
  });
});

describe("searchItemsDescriptor", () => {
  it("declares the cross-board input shape and a board scope", () => {
    expect(Object.keys(searchItemsDescriptor.inputSchema).sort()).toEqual([
      "boardId",
      "folderId",
      "orgId",
      "query",
    ]);
    expect(searchItemsDescriptor.scope).toBe("boardId");
  });
});
