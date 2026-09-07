import { describe, expect, it } from "vitest";
import { manageViewHandler, manageViewDescriptor } from "./manage-view";
import { capabilityFor, scopeFor } from "./descriptor";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const VIEW_ID = "22222222-2222-4222-8222-222222222222";

function fakeClient(view: { kind: string; board_id: string } | null) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "create_board_view")
        return { data: { id: "v-new" }, error: null };
      if (fn === "delete_board_view") return { error: null };
      return {
        data: null,
        error: { message: `unexpected rpc ${fn} ${JSON.stringify(args)}` },
      };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: view, error: null }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

describe("manageViewHandler", () => {
  it("rejects an unrecognised action", async () => {
    const result = await manageViewHandler(
      async () => fakeClient(null) as never,
      { action: "rename", viewId: VIEW_ID },
    );
    expect(result.isError).toBe(true);
  });

  it("creates a view on the named board", async () => {
    const result = await manageViewHandler(
      async () => fakeClient(null) as never,
      { action: "create", boardId: BOARD_ID, kind: "kanban" },
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({ viewId: "v-new" });
  });

  it("rejects create with a malformed boardId before touching the client", async () => {
    const result = await manageViewHandler(
      async () => fakeClient(null) as never,
      { action: "create", boardId: "not-a-uuid", kind: "kanban" },
    );
    expect(result.isError).toBe(true);
  });

  it("updates a view, validating config against its own kind", async () => {
    const ok = await manageViewHandler(
      async () => fakeClient({ kind: "kanban", board_id: BOARD_ID }) as never,
      { action: "update", viewId: VIEW_ID, config: { group_column_id: null } },
    );
    expect(ok.isError).toBeUndefined();

    const rejected = await manageViewHandler(
      async () => fakeClient({ kind: "table", board_id: BOARD_ID }) as never,
      { action: "update", viewId: VIEW_ID, config: { group_column_id: null } },
    );
    expect(rejected.isError).toBe(true);
  });

  it("fails an update naming a view that does not exist", async () => {
    const result = await manageViewHandler(
      async () => fakeClient(null) as never,
      { action: "update", viewId: VIEW_ID, name: "Renamed" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("View not found.");
  });

  it("deletes a view", async () => {
    const result = await manageViewHandler(
      async () => fakeClient(null) as never,
      { action: "delete", viewId: VIEW_ID },
    );
    expect(result.isError).toBeUndefined();
  });
});

describe("manageViewDescriptor", () => {
  it("declares the create/update/delete capability map", () => {
    expect(capabilityFor(manageViewDescriptor, { action: "create" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageViewDescriptor, { action: "update" })).toBe(
      "board.structure",
    );
    expect(capabilityFor(manageViewDescriptor, { action: "delete" })).toBe(
      "board.destroy",
    );
  });

  it("declares the create/update/delete scope map", () => {
    expect(scopeFor(manageViewDescriptor, { action: "create" })).toBe(
      "boardId",
    );
    expect(scopeFor(manageViewDescriptor, { action: "update" })).toBe("viewId");
    expect(scopeFor(manageViewDescriptor, { action: "delete" })).toBe("viewId");
  });

  it("declares action as an enum, not a bare string", () => {
    // Load-bearing: the board-scope guard falls back to scope "none" for an
    // unrecognised action, and "none" escapes board-scope narrowing.
    expect(manageViewInputActionEnum()).toEqual(["create", "update", "delete"]);
  });
});

function manageViewInputActionEnum(): string[] {
  const action = manageViewDescriptor.inputSchema.action as unknown as {
    options: string[];
  };
  return action.options;
}
