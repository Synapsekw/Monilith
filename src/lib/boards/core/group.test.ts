import { describe, expect, it } from "vitest";
import { createGroupsCore } from "./group";

/** Records every `.from(table)` and every insert payload, so the test can
 *  assert the board was read ONCE for the whole batch. */
function fakeClient(opts: { orgId: string | null; failAt?: number }) {
  const reads: string[] = [];
  let inserted = 0;
  const client = {
    from(table: string) {
      reads.push(table);
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { position: 1 },
                  error: null,
                }),
              }),
            }),
            maybeSingle: async () =>
              opts.orgId
                ? { data: { org_id: opts.orgId }, error: null }
                : { data: null, error: null },
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => {
              const i = inserted++;
              return i === opts.failAt
                ? { data: null, error: { message: "duplicate name" } }
                : { data: { id: `g${i}`, name: `G${i}` }, error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: client as never, reads: () => reads };
}

describe("createGroupsCore", () => {
  it("creates every group and reports no errors", async () => {
    const { client } = fakeClient({ orgId: "o1" });
    const r = await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }, { name: "B" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(2);
      expect(r.data.errors).toEqual([]);
    }
  });

  // Working agreement #5: a per-entry board read is an N-query hot path.
  it("reads the board exactly once for the whole batch", async () => {
    const { client, reads } = fakeClient({ orgId: "o1" });
    await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(reads().filter((t) => t === "boards")).toHaveLength(1);
  });

  it("reports a per-entry failure by index and keeps the rest", async () => {
    const { client } = fakeClient({ orgId: "o1", failAt: 1 });
    const r = await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(2);
      expect(r.data.errors).toEqual([{ index: 1, error: "duplicate name" }]);
    }
  });

  it("fails outright when the board is unreadable", async () => {
    const { client } = fakeClient({ orgId: null });
    const r = await createGroupsCore(client, {
      boardId: "b1",
      groups: [{ name: "A" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Board not found.");
  });
});
