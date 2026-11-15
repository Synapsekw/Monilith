import { describe, expect, it, vi } from "vitest";
import { getItemThreadHandler, THREAD_LIMIT } from "./get-item-thread";

type Row = Record<string, unknown>;

/**
 * PostgREST double that models every filter the handler applies: `.eq`,
 * `.neq`, `.lt`, `.in`, `.is(col, null)`, `.order` and `.limit` all act on the
 * rows, so dropping any of them in the handler changes what comes back.
 */
function client(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const calls: { table: string; eq: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const neq: [string, unknown][] = [];
    const lt: [string, string][] = [];
    const isNull: string[] = [];
    let inFilter: { k: string; vs: unknown[] } | null = null;
    let order: { k: string; asc: boolean } | null = null;
    let max = Infinity;
    calls.push({ table, eq });
    const rows = () => {
      let out = (tables[table] ?? [])
        .filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v))
        .filter((r) => neq.every(([k, v]) => r[k] !== v))
        .filter((r) => lt.every(([k, v]) => String(r[k]) < v))
        .filter((r) => isNull.every((k) => r[k] == null))
        .filter((r) => !inFilter || inFilter.vs.includes(r[inFilter.k]));
      if (order) {
        const { k, asc } = order;
        out = [...out].sort((a, b) =>
          String(a[k]) < String(b[k]) ? (asc ? -1 : 1) : asc ? 1 : -1,
        );
      }
      return out.slice(0, max);
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return q;
      },
      neq: (k: string, v: unknown) => {
        neq.push([k, v]);
        return q;
      },
      lt: (k: string, v: string) => {
        lt.push([k, v]);
        return q;
      },
      is: (k: string) => {
        isNull.push(k);
        return q;
      },
      in: (k: string, vs: unknown[]) => {
        inFilter = { k, vs };
        return q;
      },
      order: (k: string, o?: { ascending?: boolean }) => {
        order = { k, asc: o?.ascending ?? true };
        return q;
      },
      limit: (n: number) => {
        max = n;
        return q;
      },
      maybeSingle: async () =>
        errors[table]
          ? { data: null, error: { message: errors[table] } }
          : { data: rows()[0] ?? null, error: null },
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: rows(), error: null },
        ),
    };
    return q;
  };
  return { supabase: { from } as never, calls };
}

const ITEM = {
  id: "i1",
  name: "Vendor contract",
  board_id: "b1",
  org_id: "o1",
};

describe("getItemThreadHandler", () => {
  it("merges comments and changes newest first with decoded values", async () => {
    const { supabase, calls } = client({
      items: [ITEM],
      item_updates: [
        {
          item_id: "i1",
          author_id: "u1",
          body_text: "Waiting on legal",
          created_at: "2026-11-10T10:00:00Z",
        },
        {
          item_id: "OTHER",
          author_id: "u1",
          body_text: "must not appear",
          created_at: "2026-11-12T10:00:00Z",
        },
      ],
      item_activities: [
        {
          item_id: "i1",
          actor_id: "u1",
          action: "cell_changed",
          column_id: "c1",
          old_value: { optionId: "o1" },
          new_value: { optionId: "o2" },
          created_at: "2026-11-11T10:00:00Z",
        },
        {
          item_id: "OTHER",
          actor_id: "u1",
          action: "item_renamed",
          column_id: null,
          old_value: null,
          new_value: null,
          created_at: "2026-11-13T10:00:00Z",
        },
      ],
      columns: [
        {
          id: "c1",
          board_id: "b1",
          name: "Status",
          kind: "status",
          settings: {
            options: [
              { id: "o1", label: "Working", color: "#1" },
              { id: "o2", label: "Stuck", color: "#2" },
            ],
          },
        },
      ],
      org_members: [{ org_id: "o1", user_id: "u1" }],
      profiles: [{ id: "u1", full_name: "Marko Ilic", avatar_url: null }],
    });
    const getClient = vi.fn(async () => supabase);

    const result = await getItemThreadHandler(getClient, { itemId: "i1" });
    const parsed = JSON.parse(result.content[0].text);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(parsed.item).toEqual({ id: "i1", name: "Vendor contract" });
    expect(parsed.entries).toEqual([
      {
        kind: "change",
        at: "2026-11-11T10:00:00Z",
        by: "Marko Ilic",
        field: "Status",
        from: "Working",
        to: "Stuck",
      },
      {
        kind: "comment",
        at: "2026-11-10T10:00:00Z",
        by: "Marko Ilic",
        text: "Waiting on legal",
      },
    ]);
    expect(result.content[0].text).not.toContain("must not appear");
    expect(parsed.entries).toHaveLength(2);
    expect(calls.find((c) => c.table === "item_updates")?.eq).toEqual({
      item_id: "i1",
    });
    expect(calls.find((c) => c.table === "item_activities")?.eq).toEqual({
      item_id: "i1",
    });
  });

  it("returns isError when the item is not readable", async () => {
    const { supabase } = client({ items: [] });
    const result = await getItemThreadHandler(async () => supabase, {
      itemId: "missing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Item not found.");
  });

  describe("paging and limits", () => {
    const comments = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        item_id: "i1",
        author_id: "u1",
        body_text: `c${i + 1}`,
        created_at: `2026-11-0${i + 1}T10:00:00Z`,
      }));
    const base = {
      items: [ITEM],
      columns: [],
      org_members: [{ org_id: "o1", user_id: "u1" }],
      profiles: [{ id: "u1", full_name: "Marko Ilic", avatar_url: null }],
    };

    it("`before` excludes entries at or after the cursor", async () => {
      const { supabase } = client({
        ...base,
        item_updates: comments(4),
        item_activities: [
          {
            item_id: "i1",
            actor_id: "u1",
            action: "item_renamed",
            column_id: null,
            created_at: "2026-11-04T12:00:00Z",
          },
        ],
      });
      const result = await getItemThreadHandler(async () => supabase, {
        itemId: "i1",
        before: "2026-11-03T10:00:00Z",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.entries.map((e: { text?: string }) => e.text)).toEqual([
        "c2",
        "c1",
      ]);
    });

    it("returns the exact newest N across both sources, with nextBefore", async () => {
      const { supabase } = client({
        ...base,
        item_updates: comments(3),
        item_activities: [
          {
            item_id: "i1",
            actor_id: "u1",
            action: "item_renamed",
            column_id: null,
            created_at: "2026-11-02T12:00:00Z",
          },
          {
            item_id: "i1",
            actor_id: "u1",
            action: "item_moved",
            column_id: null,
            created_at: "2026-11-01T12:00:00Z",
          },
        ],
      });
      const result = await getItemThreadHandler(async () => supabase, {
        itemId: "i1",
        limit: 3,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.entries.map((e: { at: string }) => e.at)).toEqual([
        "2026-11-03T10:00:00Z",
        "2026-11-02T12:00:00Z",
        "2026-11-02T10:00:00Z",
      ]);
      expect(parsed.nextBefore).toBe("2026-11-02T10:00:00Z");
    });

    it("omits nextBefore when fewer rows than the limit exist", async () => {
      const { supabase } = client({
        ...base,
        item_updates: comments(2),
        item_activities: [],
      });
      const result = await getItemThreadHandler(async () => supabase, {
        itemId: "i1",
        limit: 5,
      });
      expect(JSON.parse(result.content[0].text).nextBefore).toBeUndefined();
    });

    it("leaves update_added activity out (the comment itself is the entry)", async () => {
      const { supabase } = client({
        ...base,
        item_updates: comments(1),
        item_activities: [
          {
            item_id: "i1",
            actor_id: "u1",
            action: "update_added",
            column_id: null,
            created_at: "2026-11-01T10:00:01Z",
          },
        ],
      });
      const result = await getItemThreadHandler(async () => supabase, {
        itemId: "i1",
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].kind).toBe("comment");
    });
  });

  describe("query errors", () => {
    const rows = {
      items: [ITEM],
      item_updates: [],
      item_activities: [],
      columns: [],
      org_members: [],
    };
    for (const table of [
      "items",
      "item_updates",
      "item_activities",
      "columns",
    ]) {
      it(`returns isError when ${table} fails, not "Item not found."`, async () => {
        const { supabase } = client(rows, { [table]: `boom ${table}` });
        const result = await getItemThreadHandler(async () => supabase, {
          itemId: "i1",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toBe(`boom ${table}`);
      });
    }
  });

  it("exports the cap the description states", () => {
    expect(THREAD_LIMIT).toBe(30);
  });
});
