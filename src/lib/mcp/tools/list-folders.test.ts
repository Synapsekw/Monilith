import { describe, expect, it, vi } from "vitest";
import * as z from "zod";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

import {
  FOLDER_BOARD_ROWS_LIMIT,
  FOLDER_LIMIT,
  listFoldersDescriptor,
  listFoldersHandler,
} from "./list-folders";

type Row = Record<string, unknown>;

/**
 * PostgREST double: `.eq`, `.in`, `.is("boards.archived_at", null)` (the
 * inner-joined board), `.order` and `.limit` all act on the rows, which stand
 * for what the caller's RLS lets them read.
 */
function client(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const limits: Record<string, number> = {};
  const from = (table: string) => {
    const eq: [string, unknown][] = [];
    const isNull: string[] = [];
    const orders: string[] = [];
    let inFilter: { k: string; vs: unknown[] } | null = null;
    let max = Infinity;
    const get = (r: Row, path: string) =>
      path.split(".").reduce<unknown>((o, k) => (o as Row | null)?.[k], r);
    const rows = () => {
      let out = (tables[table] ?? [])
        .filter((r) => eq.every(([k, v]) => r[k] === v))
        .filter((r) => isNull.every((k) => get(r, k) == null))
        .filter((r) => !inFilter || inFilter.vs.includes(r[inFilter.k]));
      for (const k of [...orders].reverse())
        out = [...out].sort((a, b) =>
          String(a[k]) < String(b[k])
            ? -1
            : String(a[k]) > String(b[k])
              ? 1
              : 0,
        );
      return out.slice(0, max);
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => (eq.push([k, v]), q),
      in: (k: string, vs: unknown[]) => ((inFilter = { k, vs }), q),
      is: (k: string) => (isNull.push(k), q),
      order: (k: string) => (orders.push(k), q),
      limit: (n: number) => ((max = n), (limits[table] = n), q),
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: rows(), error: null },
        ),
    };
    return q;
  };
  return { supabase: { from } as never, limits };
}

const folder = (id: string, name: string, org_id = "o1") => ({
  id,
  name,
  org_id,
  workspace_id: "w1",
});
const link = (
  folder_id: string,
  id: string,
  name: string,
  position: number,
  archived_at: string | null = null,
) => ({
  folder_id,
  position,
  boards: { id, name, archived_at },
});

const parse = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0]!.text);

describe("listFoldersHandler", () => {
  it("lists the org's folders by name with their live boards in folder order", async () => {
    const { supabase } = client({
      folders: [
        folder("f2", "Website"),
        folder("f1", "Launch"),
        folder("fx", "Elsewhere", "o2"),
      ],
      folder_boards: [
        link("f1", "b2", "Press", 2),
        link("f1", "b1", "Plan", 1),
        link("f1", "b9", "Old", 0, "2026-01-01T00:00:00Z"),
        link("fx", "b7", "Foreign", 0),
      ],
    });
    expect(parse(await listFoldersHandler(async () => supabase, {}))).toEqual({
      orgId: "o1",
      folders: [
        {
          id: "f1",
          name: "Launch",
          workspaceId: "w1",
          boards: [
            { id: "b1", name: "Plan" },
            { id: "b2", name: "Press" },
          ],
        },
        { id: "f2", name: "Website", workspaceId: "w1", boards: [] },
      ],
      truncated: false,
    });
  });

  it("returns no folders, not an error, when none are visible", async () => {
    const { supabase } = client({ folders: [] });
    expect(parse(await listFoldersHandler(async () => supabase, {}))).toEqual({
      orgId: "o1",
      folders: [],
      truncated: false,
    });
  });

  it("bounds both reads and reports truncation", async () => {
    const many = Array.from({ length: FOLDER_LIMIT + 5 }, (_, i) =>
      folder(
        `f${String(i).padStart(3, "0")}`,
        `Folder ${String(i).padStart(3, "0")}`,
      ),
    );
    const { supabase, limits } = client({ folders: many, folder_boards: [] });
    const out = parse(await listFoldersHandler(async () => supabase, {}));
    expect(out.folders).toHaveLength(FOLDER_LIMIT);
    expect(out.truncated).toBe(true);
    expect(limits.folders).toBe(FOLDER_LIMIT + 1);
    expect(limits.folder_boards).toBe(FOLDER_BOARD_ROWS_LIMIT);

    const two = parse(
      await listFoldersHandler(async () => supabase, { limit: 2 }),
    );
    expect(two.folders.map((f: { id: string }) => f.id)).toEqual([
      "f000",
      "f001",
    ]);
    expect(two.truncated).toBe(true);
  });

  it("flags when the board rows hit their cap", async () => {
    const { supabase } = client({
      folders: [folder("f1", "Launch")],
      folder_boards: Array.from({ length: FOLDER_BOARD_ROWS_LIMIT }, (_, i) =>
        link("f1", `b${i}`, `Board ${i}`, i),
      ),
    });
    const out = parse(await listFoldersHandler(async () => supabase, {}));
    expect(out.boardsTruncated).toBe(true);
  });

  it("refuses an org the caller is not a member of", async () => {
    const { supabase } = client({});
    const result = await listFoldersHandler(async () => supabase, {
      orgId: "o-foreign",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not a member");
  });

  it.each([
    ["folders", "folders down"],
    ["folder_boards", "boards down"],
  ])(
    "reports a failed %s read as an error, never as empty",
    async (table, message) => {
      const { supabase } = client(
        { folders: [folder("f1", "Launch")], folder_boards: [] },
        { [table]: message },
      );
      const result = await listFoldersHandler(async () => supabase, {});
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(message);
    },
  );
});

describe("listFoldersDescriptor", () => {
  it("is an always-on read that accepts null for every optional field", async () => {
    expect(listFoldersDescriptor.capability).toBeNull();
    expect(listFoldersDescriptor.scope).toBe("none");
    const schema = z.object(listFoldersDescriptor.inputSchema);
    expect(schema.safeParse({ orgId: null, limit: null }).success).toBe(true);
    expect(schema.safeParse({ limit: FOLDER_LIMIT + 1 }).success).toBe(false);
    const { supabase } = client({ folders: [folder("f1", "Launch")] });
    const result = await listFoldersDescriptor.invoke(
      { getClient: async () => supabase, actorId: "u1" },
      { orgId: null, limit: null },
    );
    expect(parse(result).folders).toHaveLength(1);
  });
});
