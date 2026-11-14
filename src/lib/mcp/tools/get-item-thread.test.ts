import { describe, expect, it, vi } from "vitest";
import { getItemThreadHandler, THREAD_LIMIT } from "./get-item-thread";

type Row = Record<string, unknown>;

/** Minimal PostgREST double: rows per table, filtered by recorded `.eq()`s. */
function client(tables: Record<string, Row[]>) {
  const calls: { table: string; eq: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    calls.push({ table, eq });
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
      is: () => q,
      neq: () => q,
      in: (k: string, vs: unknown[]) => {
        inFilter = { k, vs };
        return q;
      },
      lt: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
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

  it("exports the cap the description states", () => {
    expect(THREAD_LIMIT).toBe(30);
  });
});
