import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

// Live-run defect A: a model sent a made-up folderId alongside the pinned org,
// and the tool answered "Nothing urgent". This suite runs the REAL org-scope
// resolution (only the ranking engine is stubbed), so a made-up folder must
// come back as an error before the engine is ever asked.
const getFocusTodayCore = vi.fn();
vi.mock("@/lib/focus/queries", () => ({
  FOCUS_LIMIT: 20,
  getFocusTodayCore: (...a: unknown[]) => getFocusTodayCore(...a),
}));

import { getFocusTodayDescriptor } from "./get-focus-today";

type Row = Record<string, unknown>;

function client(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: (k: string, v: unknown) => {
        rows = rows.filter((r) => r[k] === v);
        return q;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (r: (v: unknown) => unknown) => r({ data: rows, error: null }),
    };
    return q;
  };
  const supabase = { from } as never;
  return { ctx: { getClient: async () => supabase, actorId: "u1" }, reads };
}

const TABLES = {
  organizations: [{ id: "o1", name: "Acme", timezone: "UTC" }],
  folders: [{ id: "f1", org_id: "o1" }],
};
const EMPTY_DAY = {
  ok: true,
  data: {
    today: "2026-11-14",
    timezoneAssumed: false,
    items: [],
    totals: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  },
};
const MADE_UP = "00000000-0000-4000-8000-000000000000";

beforeEach(() => {
  getFocusTodayCore.mockReset();
  getFocusTodayCore.mockResolvedValue(EMPTY_DAY);
});

describe("get_focus_today scope (live-run defect A)", () => {
  it("a made-up folderId with the pinned org is 'Folder not found.', never the empty-list note", async () => {
    const { ctx } = client(TABLES);
    const r = await getFocusTodayDescriptor.invoke(ctx as never, {
      orgId: "o1",
      folderId: MADE_UP,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Folder not found.");
    expect(r.content[0].text).not.toMatch(/nothing urgent/i);
    expect(getFocusTodayCore).not.toHaveBeenCalled();
  });

  it("a real folder of the pinned org is passed to the engine", async () => {
    const { ctx } = client(TABLES);
    await getFocusTodayDescriptor.invoke(ctx as never, {
      orgId: "o1",
      folderId: "f1",
    });
    expect(getFocusTodayCore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "o1", folderId: "f1" }),
    );
  });

  it("a null folderId behaves like an omitted one", async () => {
    const { ctx, reads } = client(TABLES);
    const r = await getFocusTodayDescriptor.invoke(ctx as never, {
      orgId: null,
      folderId: null,
    });
    expect(r.isError).toBeUndefined();
    expect(reads).not.toContain("folders");
    const args = getFocusTodayCore.mock.calls[0]![1] as Row;
    expect(args.orgId).toBe("o1");
    expect("folderId" in args).toBe(false);
  });

  it("the schema accepts null and the description says to omit, not invent, ids", () => {
    const schema = z.object(getFocusTodayDescriptor.inputSchema);
    expect(schema.safeParse({ orgId: null, folderId: null }).success).toBe(
      true,
    );
    expect(schema.safeParse({}).success).toBe(true);
    const d = getFocusTodayDescriptor.description;
    expect(d).toMatch(/optional/i);
    expect(d).toMatch(/never invent/i);
  });
});
