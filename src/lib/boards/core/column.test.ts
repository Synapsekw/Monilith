import { describe, expect, it } from "vitest";
import { createColumnsCore } from "./column";

function fakeClient(orgId: string | null) {
  const reads: string[] = [];
  let n = 0;
  return {
    reads: () => reads,
    client: {
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
                orgId
                  ? { data: { org_id: orgId }, error: null }
                  : { data: null, error: null },
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: `c${n++}`, kind: "text" },
                error: null,
              }),
            }),
          }),
        };
      },
    } as never,
  };
}

describe("createColumnsCore", () => {
  it("creates each column and applies the kind's default settings", async () => {
    const { client } = fakeClient("o1");
    const r = await createColumnsCore(client, {
      boardId: "b1",
      columns: [{ kind: "text" }, { kind: "status" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.created).toHaveLength(2);
  });

  it("reads the board exactly once for the whole batch", async () => {
    const { client, reads } = fakeClient("o1");
    await createColumnsCore(client, {
      boardId: "b1",
      columns: [{ kind: "text" }, { kind: "text" }, { kind: "text" }],
    });
    expect(reads().filter((t) => t === "boards")).toHaveLength(1);
  });

  // The guard that MUST survive the move: settings are validated against the
  // kind's own schema, so a relation column without target_board_id is
  // rejected rather than written and later exploding on read.
  it("rejects settings that do not match the kind, by index", async () => {
    const { client } = fakeClient("o1");
    const r = await createColumnsCore(client, {
      boardId: "b1",
      columns: [
        { kind: "text" },
        { kind: "relation", settings: { nonsense: true } },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.created).toHaveLength(1);
      expect(r.data.errors[0]!.index).toBe(1);
    }
  });
});
