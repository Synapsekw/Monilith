import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));

import { getBoardPayload } from "@/lib/boards/queries";
import {
  BOARD_CELLS_CAP,
  BOARD_LINKED_NAMES_CAP,
  BOARD_RELATION_LINKS_CAP,
} from "@/lib/boards/caps";

type Result = { data: unknown; error: { message: string } | null };

const pad = (i: number) => String(i).padStart(6, "0");

/**
 * Tables served like PostgREST: `rows[table]` is the full match, and a
 * `.range(a, b)` returns that inclusive slice (never more than 1000 rows, as
 * the hosted `max_rows` enforces). Records every range per table.
 */
function serve(rows: Record<string, unknown[]>, board: unknown) {
  const ranges: Record<string, [number, number][]> = {};
  from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    for (const m of ["select", "eq", "is", "order", "limit", "not", "in", "or"])
      chain[m] = () => chain;
    chain.range = (a: number, b: number) => {
      range = [a, b];
      (ranges[table] ??= []).push([a, b]);
      return chain;
    };
    const data = () => {
      if (table === "boards") return board;
      const all = rows[table] ?? [];
      const [a, b] = range ?? [0, 999];
      return all.slice(a, Math.min(b, a + 999) + 1);
    };
    chain.maybeSingle = async () => ({ data: data(), error: null });
    (chain as { then: unknown }).then = (resolve: (v: Result) => void) =>
      resolve({ data: data(), error: null });
    return chain;
  });
  return ranges;
}

const cells = (total: number) =>
  Array.from({ length: total }, (_, i) => ({
    item_id: `i${pad(i)}`,
    column_id: "c1",
    value: { text: String(i) },
    updated_at: "2026-11-14T00:00:00Z",
  }));

const links = (total: number) =>
  Array.from({ length: total }, (_, i) => ({
    id: `rl${pad(i)}`,
    item_id: "i1",
    column_id: "rc1",
    linked_item_id: `li${pad(i)}`,
    position: i,
  }));

const names = (total: number) =>
  Array.from({ length: total }, (_, i) => ({
    id: `li${pad(i)}`,
    name: `Linked ${i}`,
  }));

beforeEach(() => {
  from.mockReset();
});

// getBoardPayload is wrapped in React cache(): every test uses its own boardId.
describe("getBoardPayload reports a read that stopped at its cap", () => {
  it("flags nothing on an ordinary board", async () => {
    serve({ cell_values: cells(12) }, { id: "t1" });
    const payload = await getBoardPayload("t1");
    expect(payload?.truncation).toEqual({
      cells: false,
      relationLinks: false,
      linkedItemNames: false,
    });
  });

  it("does not flag a board holding exactly the cell cap", async () => {
    serve({ cell_values: cells(BOARD_CELLS_CAP) }, { id: "t2" });
    const payload = await getBoardPayload("t2");
    expect(payload?.cellValues).toHaveLength(BOARD_CELLS_CAP);
    expect(payload?.truncation?.cells).toBe(false);
  });

  it("flags cells one past the cap, returns only the cap, and reads one extra row", async () => {
    const ranges = serve(
      { cell_values: cells(BOARD_CELLS_CAP + 500) },
      { id: "t3" },
    );
    const payload = await getBoardPayload("t3");
    expect(payload?.cellValues).toHaveLength(BOARD_CELLS_CAP);
    expect(payload?.truncation?.cells).toBe(true);
    // The cap is not raised: the furthest row asked for is the single probe.
    expect(Math.max(...ranges["cell_values"].map(([, to]) => to))).toBe(
      BOARD_CELLS_CAP,
    );
    expect(ranges["cell_values"]).toContainEqual([
      BOARD_CELLS_CAP,
      BOARD_CELLS_CAP,
    ]);
  });

  it("flags relation links past their cap", async () => {
    serve(
      {
        relation_links: links(BOARD_RELATION_LINKS_CAP + 1),
        // Every link points at the same few names so only the links overflow.
        items: [],
      },
      { id: "t4" },
    );
    const payload = await getBoardPayload("t4");
    expect(payload?.relationLinks).toHaveLength(BOARD_RELATION_LINKS_CAP);
    expect(payload?.truncation?.relationLinks).toBe(true);
    expect(payload?.truncation?.linkedItemNames).toBe(false);
  });

  it("flags linked item names past one response, and leaves the links alone", async () => {
    const total = BOARD_LINKED_NAMES_CAP + 200;
    serve({ relation_links: links(total), items: names(total) }, { id: "t5" });
    const payload = await getBoardPayload("t5");
    expect(payload?.relationLinks).toHaveLength(total);
    expect(payload?.truncation?.relationLinks).toBe(false);
    expect(payload?.truncation?.linkedItemNames).toBe(true);
    const named = payload?.relationLinks.filter((l) => l.linkedItemName);
    expect(named).toHaveLength(BOARD_LINKED_NAMES_CAP);
  });

  it("does not flag names when every linked item fits", async () => {
    serve({ relation_links: links(40), items: names(40) }, { id: "t6" });
    const payload = await getBoardPayload("t6");
    expect(payload?.truncation?.linkedItemNames).toBe(false);
    expect(payload?.relationLinks.every((l) => l.linkedItemName)).toBe(true);
  });
});
