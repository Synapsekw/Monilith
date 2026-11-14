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

type Row = Record<string, unknown>;
type Call = [method: string, ...args: unknown[]];
type Rec = { table: string; calls: Call[] };

/** Read a column, following `boards.archived_at` into the embedded row. */
function cell(row: Row, col: string): unknown {
  const [head, tail] = col.split(".");
  if (tail === undefined) return row[head];
  const nested = row[head];
  return nested && typeof nested === "object"
    ? (nested as Row)[tail]
    : undefined;
}

/** A PostgREST `ilike` pattern as a regex: `\x` is a literal, `%` any run, `_` one char. */
function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/**
 * A chainable, awaitable query double that APPLIES eq / in / is / ilike / limit
 * to the table's rows (an embedded `boards.col` filter reads the nested row), so
 * a test proves what the QUERY excludes rather than what the handler discards.
 * Every builder call is also recorded.
 */
function fakeClient(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const recs: Rec[] = [];
  const client = {
    from(table: string) {
      const rec: Rec = { table, calls: [] };
      recs.push(rec);
      let rows = [...(tables[table] ?? [])];
      let max = Infinity;
      const b: Record<string, unknown> = {};
      const chain = (m: string, fn: (...a: unknown[]) => void) => {
        b[m] = (...args: unknown[]) => {
          rec.calls.push([m, ...args]);
          fn(...args);
          return b;
        };
      };
      chain("select", () => {});
      chain("order", () => {});
      chain("eq", (col, val) => {
        rows = rows.filter((r) => cell(r, col as string) === val);
      });
      chain("in", (col, vals) => {
        rows = rows.filter((r) =>
          (vals as unknown[]).includes(cell(r, col as string)),
        );
      });
      chain("is", (col, val) => {
        rows = rows.filter(
          (r) => (cell(r, col as string) ?? null) === (val as null),
        );
      });
      chain("ilike", (col, pat) => {
        const re = likeToRegex(pat as string);
        rows = rows.filter((r) => re.test(String(cell(r, col as string))));
      });
      chain("limit", (n) => {
        max = n as number;
      });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: rows.slice(0, max), error: null },
        );
      return b;
    },
  };
  const getClient = vi.fn(async () => client as never);
  const reads = (table: string) => recs.filter((r) => r.table === table);
  return { getClient, reads };
}

const ORG = { id: "o1", name: "Acme", timezone: "UTC" };
const LIVE = { name: "Legal", archived_at: null };
const WEB = { name: "Web", archived_at: null };
const GONE = { name: "Old", archived_at: "2026-01-01" };

function item(
  id: string,
  name: string,
  boardId: string,
  boards: { name: string; archived_at: string | null },
  extra: Row = {},
): Row {
  return {
    id,
    name,
    board_id: boardId,
    org_id: "o1",
    archived_at: null,
    boards,
    ...extra,
  };
}

const body = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0].text);
const ids = (r: { content: { text: string }[] }) =>
  body(r).items.map((i: { id: string }) => i.id);

beforeEach(() => {
  semanticSearchCore.mockReset();
  semanticSearchCore.mockResolvedValue({ ok: true, items: [] });
});

describe("searchItemsHandler", () => {
  it("org scope: merges name and semantic matches, excluding other orgs, archived items and archived boards", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [
        item("i1", "Vendor contract", "b1", LIVE),
        item("x-org", "Vendor contract", "b9", LIVE, { org_id: "o2" }),
        item("x-arch", "Vendor contract", "b1", LIVE, {
          archived_at: "2026-01-01",
        }),
        item("x-board", "Vendor contract", "b-old", GONE),
      ],
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
    expect(semanticSearchCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "o1", userId: "u1", query: "contract" }),
    );
    expect(fake.getClient).toHaveBeenCalledTimes(1);
  });

  it("board scope: name rows from other boards are excluded and semantic gets the board", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [
        item("i1", "Fix login", "b1", LIVE),
        item("i2", "Fix login too", "b2", WEB),
      ],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
      boardId: "b1",
    });

    expect(ids(res)).toEqual(["i1"]);
    expect(semanticSearchCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boardIds: ["b1"] }),
    );
  });

  it("folder scope: only the folder's boards are searched, by name and by meaning", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      folder_boards: [
        { folder_id: "f1", board_id: "b1" },
        { folder_id: "f1", board_id: "b2" },
        { folder_id: "f2", board_id: "b3" },
      ],
      items: [
        item("i1", "Fix login", "b1", LIVE),
        item("i2", "Fix login", "b2", WEB),
        item("i3", "Fix login", "b3", WEB),
      ],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
      folderId: "f1",
    });

    expect(ids(res).sort()).toEqual(["i1", "i2"]);
    expect(semanticSearchCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ boardIds: ["b1", "b2"] }),
    );
  });

  it("empty folder: answers empty without searching", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      folder_boards: [{ folder_id: "other", board_id: "b1" }],
      items: [item("i1", "Fix login", "b1", LIVE)],
    });

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
      items: [item("i1", "Fix login bug", "b1", WEB)],
    });
    semanticSearchCore.mockResolvedValue({ ok: false });

    const parsed = body(
      await searchItemsHandler(fake.getClient, "u1", { query: "login" }),
    );

    expect(parsed.semantic).toBe(false);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.note).toContain("names only");
  });

  it("semantic search throwing never fails the tool", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [item("i1", "Fix login bug", "b1", WEB)],
    });
    semanticSearchCore.mockRejectedValue(new Error("module blew up"));

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "login",
    });
    const parsed = body(res);

    expect(res.isError).toBeUndefined();
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

  it("archived boards are excluded by the query, so they cannot crowd out real matches", async () => {
    // 25 archived-board matches are newer than the one live match; with the
    // filter after the limit the live match would never be fetched.
    const archived = Array.from({ length: SEARCH_LIMIT + 5 }, (_, n) =>
      item(`a${n}`, "Report", "b-old", GONE),
    );
    const fake = fakeClient({
      organizations: [ORG],
      items: [...archived, item("live", "Report", "b1", LIVE)],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "report",
    });

    expect(ids(res)).toEqual(["live"]);
    expect(body(res).truncated).toBe(false);
    expect(fake.reads("boards")).toHaveLength(0);
    expect(fake.reads("items")[0].calls).toContainEqual([
      "is",
      "boards.archived_at",
      null,
    ]);
  });

  it("over-fetches by one and reports truncation when name matches exceed the limit", async () => {
    const rows = Array.from({ length: SEARCH_LIMIT + 1 }, (_, n) =>
      item(`i${n}`, `Bug ${n}`, "b1", WEB),
    );
    const fake = fakeClient({ organizations: [ORG], items: rows });

    const parsed = body(
      await searchItemsHandler(fake.getClient, "u1", { query: "bug" }),
    );

    expect(fake.reads("items")[0].calls).toContainEqual([
      "limit",
      SEARCH_LIMIT + 1,
    ]);
    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(true);
  });

  it("does not claim truncation when matches exactly fill the limit", async () => {
    const rows = Array.from({ length: SEARCH_LIMIT }, (_, n) =>
      item(`i${n}`, `Bug ${n}`, "b1", WEB),
    );
    const fake = fakeClient({ organizations: [ORG], items: rows });

    const parsed = body(
      await searchItemsHandler(fake.getClient, "u1", { query: "bug" }),
    );

    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(false);
  });

  it("reports truncation when the merged name + semantic list is cut by the cap", async () => {
    const rows = Array.from({ length: 15 }, (_, n) =>
      item(`n${n}`, `Bug ${n}`, "b1", WEB),
    );
    const fake = fakeClient({ organizations: [ORG], items: rows });
    semanticSearchCore.mockResolvedValue({
      ok: true,
      items: Array.from({ length: 10 }, (_, n) => ({
        id: `s${n}`,
        name: `Defect ${n}`,
        boardId: "b2",
        boardName: "Ops",
      })),
    });

    const parsed = body(
      await searchItemsHandler(fake.getClient, "u1", { query: "bug" }),
    );

    expect(parsed.items).toHaveLength(SEARCH_LIMIT);
    expect(parsed.truncated).toBe(true);
  });

  it("sends the user's text as a literal: % _ and \\ are escaped in the ilike pattern", async () => {
    const fake = fakeClient({
      organizations: [ORG],
      items: [item("lit", "a%_b", "b1", WEB), item("wild", "abc", "b1", WEB)],
    });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "%_",
    });

    expect(fake.reads("items")[0].calls).toContainEqual([
      "ilike",
      "name",
      "%\\%\\_%",
    ]);
    expect(ids(res)).toEqual(["lit"]);
  });

  it("surfaces a name query error", async () => {
    const fake = fakeClient({ organizations: [ORG] }, { items: "boom" });

    const res = await searchItemsHandler(fake.getClient, "u1", {
      query: "xx",
    });

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
