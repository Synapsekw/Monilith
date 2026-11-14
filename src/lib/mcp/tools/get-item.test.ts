import { describe, expect, it } from "vitest";
import { getItemHandler } from "./get-item";

type Row = Record<string, unknown>;

/** Minimal PostgREST double: rows per table, filtered by `.eq()` / `.in()`. */
function client(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    let inFilter: { k: string; vs: unknown[] } | null = null;
    const rows = () =>
      (tables[table] ?? [])
        .filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v))
        .filter((r) => !inFilter || inFilter.vs.includes(r[inFilter.k]));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return q;
      },
      in: (k: string, vs: unknown[]) => {
        inFilter = { k, vs };
        return q;
      },
      is: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: rows(), error: null },
        ),
    };
    return q;
  };
  return { from } as never;
}

const ITEM = {
  id: "i1",
  name: "Fix login bug",
  group_id: "g1",
  board_id: "b1",
};

describe("getItemHandler", () => {
  it("returns the item plus its cell values", async () => {
    const supabase = client({
      items: [ITEM],
      cell_values: [
        { item_id: "i1", column_id: "c1", value: { text: "In progress" } },
        { item_id: "other", column_id: "c1", value: { text: "nope" } },
      ],
    });
    const result = await getItemHandler(async () => supabase, {
      itemId: "i1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.item.id).toBe("i1");
    expect(parsed.cellValues).toEqual([
      { columnId: "c1", value: { text: "In progress" } },
    ]);
    expect(parsed.blockedBy).toEqual([]);
    expect(parsed.blocking).toEqual([]);
    expect(parsed.hiddenDependencies).toBe(0);
  });

  it("returns isError when cell_values query fails", async () => {
    const supabase = client(
      { items: [ITEM] },
      { cell_values: "Permission denied" },
    );
    const result = await getItemHandler(async () => supabase, {
      itemId: "i1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Permission denied");
  });

  it("lists blockers and dependents with board names and counts hidden ones", async () => {
    const supabase = client({
      items: [
        ITEM,
        { id: "p1", name: "Sign NDA", board_id: "b2" },
        { id: "s1", name: "Launch", board_id: "b1" },
      ],
      boards: [
        { id: "b1", name: "Ops" },
        { id: "b2", name: "Legal" },
      ],
      item_dependencies: [
        { predecessor_id: "p1", successor_id: "i1" },
        { predecessor_id: "hidden", successor_id: "i1" },
        { predecessor_id: "i1", successor_id: "s1" },
        { predecessor_id: "zzz", successor_id: "unrelated" },
      ],
    });
    const result = await getItemHandler(async () => supabase, {
      itemId: "i1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.blockedBy).toEqual([
      { id: "p1", name: "Sign NDA", boardId: "b2", boardName: "Legal" },
    ]);
    expect(parsed.blocking).toEqual([
      { id: "s1", name: "Launch", boardId: "b1", boardName: "Ops" },
    ]);
    expect(parsed.hiddenDependencies).toBe(1);
  });
});
