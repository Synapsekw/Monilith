import { describe, expect, it } from "vitest";
import { DEPENDENCY_LIMIT, RELATION_LIMIT, getItemHandler } from "./get-item";

type Row = Record<string, unknown>;

/**
 * PostgREST double modelling `.eq`, `.in`, `.is(col, null)` and `.limit`.
 * `errors` is keyed by table, `table:eqColumn` to fail only the read that
 * filters on that column (the two item_dependencies reads differ that way), or
 * `table:in` for a read that uses `.in()`.
 */
function client(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const isNull: string[] = [];
    let inFilter: { k: string; vs: unknown[] } | null = null;
    let max = Infinity;
    let order: { k: string; asc: boolean } | null = null;
    const rows = () => {
      let out = (tables[table] ?? [])
        .filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v))
        .filter((r) => isNull.every((k) => r[k] == null))
        .filter((r) => !inFilter || inFilter.vs.includes(r[inFilter.k]));
      if (order) {
        const { k, asc } = order;
        out = [...out].sort((a, b) =>
          a[k] === b[k]
            ? 0
            : (a[k] as number) < (b[k] as number) === asc
              ? -1
              : 1,
        );
      }
      return out.slice(0, max);
    };
    const failure = () =>
      errors[table] ??
      (inFilter ? errors[`${table}:in`] : undefined) ??
      Object.keys(eq)
        .map((k) => errors[`${table}:${k}`])
        .find(Boolean);
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
      is: (k: string) => {
        isNull.push(k);
        return q;
      },
      limit: (n: number) => {
        max = n;
        return q;
      },
      order: (k: string, o?: { ascending?: boolean }) => {
        order = { k, asc: o?.ascending ?? true };
        return q;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve(
          failure()
            ? { data: null, error: { message: failure() } }
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

  it("lists blockers and dependents with board names, status and done flag, and counts hidden ones", async () => {
    const supabase = client({
      items: [ITEM],
      item_facts: [
        {
          item_id: "p1",
          name: "Sign NDA",
          board_id: "b2",
          status_label: "Working",
          is_done: false,
        },
        {
          item_id: "s1",
          name: "Launch",
          board_id: "b1",
          status_label: "Done",
          is_done: true,
        },
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
      {
        id: "p1",
        name: "Sign NDA",
        boardId: "b2",
        boardName: "Legal",
        status: "Working",
        done: false,
      },
    ]);
    expect(parsed.blocking).toEqual([
      {
        id: "s1",
        name: "Launch",
        boardId: "b1",
        boardName: "Ops",
        status: "Done",
        done: true,
      },
    ]);
    expect(parsed.hiddenDependencies).toBe(1);
  });

  it("reads linked items from item_facts, so an item that view leaves out (archived, or on an archived board or group) counts as hidden", async () => {
    const supabase = client({
      // The linked item exists in `items` but not in the live-items view.
      items: [ITEM, { id: "p1", name: "Gone", board_id: "b1" }],
      item_facts: [],
      boards: [{ id: "b1", name: "Ops" }],
      item_dependencies: [{ predecessor_id: "p1", successor_id: "i1" }],
    });
    const result = await getItemHandler(async () => supabase, {
      itemId: "i1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.blockedBy).toEqual([]);
    expect(parsed.hiddenDependencies).toBe(1);
  });

  it("caps each direction at DEPENDENCY_LIMIT", async () => {
    const preds = Array.from({ length: DEPENDENCY_LIMIT + 5 }, (_, i) => ({
      item_id: `p${i}`,
      name: `P${i}`,
      board_id: "b1",
      status_label: null,
      is_done: false,
    }));
    const supabase = client({
      items: [ITEM],
      item_facts: preds,
      boards: [{ id: "b1", name: "Ops" }],
      item_dependencies: preds.map((p) => ({
        predecessor_id: p.item_id,
        successor_id: "i1",
      })),
    });
    const result = await getItemHandler(async () => supabase, {
      itemId: "i1",
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.blockedBy).toHaveLength(DEPENDENCY_LIMIT);
  });

  describe("dependency read failures are errors, never an empty 'not blocked'", () => {
    const tables = {
      items: [ITEM],
      item_facts: [
        {
          item_id: "p1",
          name: "Sign NDA",
          board_id: "b1",
          status_label: null,
          is_done: false,
        },
      ],
      boards: [{ id: "b1", name: "Ops" }],
      item_dependencies: [{ predecessor_id: "p1", successor_id: "i1" }],
    };
    const cases: [string, Record<string, string>][] = [
      ["predecessor links", { "item_dependencies:successor_id": "pred down" }],
      ["successor links", { "item_dependencies:predecessor_id": "succ down" }],
      ["linked items", { "item_facts:in": "items down" }],
      ["boards", { boards: "boards down" }],
    ];
    for (const [label, errs] of cases) {
      it(`returns isError when the ${label} read fails`, async () => {
        const result = await getItemHandler(async () => client(tables, errs), {
          itemId: "i1",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(Object.values(errs)[0]);
      });
    }
  });

  it("returns empty lists and no error when the item has no dependencies", async () => {
    const result = await getItemHandler(
      async () => client({ items: [ITEM], item_dependencies: [] }),
      { itemId: "i1" },
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed).toMatchObject({
      blockedBy: [],
      blocking: [],
      hiddenDependencies: 0,
    });
  });
  describe("relation links", () => {
    const fact = (item_id: string, name: string, board_id: string) => ({
      item_id,
      name,
      board_id,
      status_label: "Working",
      is_done: false,
    });
    const tables = {
      items: [ITEM],
      columns: [
        { id: "rc1", name: "Client" },
        { id: "rc2", name: "Contracts" },
      ],
      item_facts: [
        fact("t1", "Acme Corp", "b2"),
        fact("t2", "MSA 2026", "b3"),
        fact("t3", "NDA", "b3"),
        fact("s1", "Invoice 14", "b4"),
      ],
      boards: [
        { id: "b2", name: "Clients" },
        { id: "b3", name: "Legal" },
        { id: "b4", name: "Finance" },
      ],
      relation_links: [
        // This item's own relation cells (two columns; position orders a cell).
        {
          item_id: "i1",
          column_id: "rc2",
          linked_item_id: "t3",
          position: 1,
          created_at: "1",
        },
        {
          item_id: "i1",
          column_id: "rc2",
          linked_item_id: "t2",
          position: 0,
          created_at: "2",
        },
        {
          item_id: "i1",
          column_id: "rc1",
          linked_item_id: "t1",
          position: 0,
          created_at: "3",
        },
        {
          item_id: "i1",
          column_id: "rc1",
          linked_item_id: "gone",
          position: 1,
          created_at: "4",
        },
        // Another board's item links here.
        {
          item_id: "s1",
          column_id: "rx",
          linked_item_id: "i1",
          position: 0,
          created_at: "5",
        },
        {
          item_id: "unseen",
          column_id: "rx",
          linked_item_id: "i1",
          position: 0,
          created_at: "6",
        },
        // Unrelated.
        {
          item_id: "zzz",
          column_id: "rx",
          linked_item_id: "t1",
          position: 0,
          created_at: "7",
        },
      ],
    };
    const linked = (
      id: string,
      name: string,
      boardId: string,
      boardName: string,
    ) => ({
      id,
      name,
      boardId,
      boardName,
      status: "Working",
      done: false,
    });

    it("lists outgoing links per relation column in cell order, incoming links, and counts hidden ones", async () => {
      const result = await getItemHandler(async () => client(tables), {
        itemId: "i1",
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text as string);
      expect(parsed.relations).toEqual([
        {
          columnId: "rc2",
          columnName: "Contracts",
          items: [
            linked("t2", "MSA 2026", "b3", "Legal"),
            linked("t3", "NDA", "b3", "Legal"),
          ],
        },
        {
          columnId: "rc1",
          columnName: "Client",
          items: [linked("t1", "Acme Corp", "b2", "Clients")],
        },
      ]);
      expect(parsed.linkedFrom).toEqual([
        linked("s1", "Invoice 14", "b4", "Finance"),
      ]);
      // "gone" (archived or unreadable target) and "unseen" (unreadable source).
      expect(parsed.hiddenRelations).toBe(2);
      // Relation links are not dependencies.
      expect(parsed.hiddenDependencies).toBe(0);
    });

    it("returns empty relation lists when the item has none", async () => {
      const result = await getItemHandler(
        async () => client({ items: [ITEM] }),
        { itemId: "i1" },
      );
      const parsed = JSON.parse(result.content[0].text as string);
      expect(parsed).toMatchObject({
        relations: [],
        linkedFrom: [],
        hiddenRelations: 0,
      });
    });

    it("caps each direction at RELATION_LIMIT", async () => {
      const n = RELATION_LIMIT + 7;
      const many = {
        items: [ITEM],
        columns: [{ id: "rc1", name: "Client" }],
        boards: [{ id: "b2", name: "Clients" }],
        item_facts: [
          ...Array.from({ length: n }, (_, i) => fact(`t${i}`, `T${i}`, "b2")),
          ...Array.from({ length: n }, (_, i) => fact(`s${i}`, `S${i}`, "b2")),
        ],
        relation_links: [
          ...Array.from({ length: n }, (_, i) => ({
            item_id: "i1",
            column_id: "rc1",
            linked_item_id: `t${i}`,
            position: i,
            created_at: String(i),
          })),
          ...Array.from({ length: n }, (_, i) => ({
            item_id: `s${i}`,
            column_id: "rx",
            linked_item_id: "i1",
            position: 0,
            created_at: String(i),
          })),
        ],
      };
      const result = await getItemHandler(async () => client(many), {
        itemId: "i1",
      });
      const parsed = JSON.parse(result.content[0].text as string);
      expect(parsed.relations[0].items).toHaveLength(RELATION_LIMIT);
      expect(parsed.linkedFrom).toHaveLength(RELATION_LIMIT);
    });

    const failures: [string, Record<string, string>][] = [
      ["outgoing links", { "relation_links:item_id": "links down" }],
      ["incoming links", { "relation_links:linked_item_id": "back down" }],
      ["relation columns", { "columns:in": "columns down" }],
      ["linked items", { "item_facts:in": "items down" }],
    ];
    for (const [label, errs] of failures) {
      it(`returns isError when the ${label} read fails, never "no links"`, async () => {
        const result = await getItemHandler(async () => client(tables, errs), {
          itemId: "i1",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(Object.values(errs)[0]);
      });
    }
  });
});
