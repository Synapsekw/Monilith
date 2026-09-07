import { describe, expect, it } from "vitest";
import { manageGoalDescriptor } from "./manage-goal";

const ctx = (orgs: { id: string; name: string }[]) => ({
  actorId: "u1",
  getClient: async () =>
    ({
      from: () => ({
        select: () => ({ order: async () => ({ data: orgs, error: null }) }),
      }),
      rpc: async () => ({ data: { id: "g1" }, error: null }),
    }) as never,
});

describe("manage_goal org resolution", () => {
  // The MCP analogue of the active-org cookie, already established by
  // resolveToolOrg: default to the caller's only org.
  it("defaults to the caller's single org when none is named", async () => {
    const r = await manageGoalDescriptor.invoke(
      ctx([{ id: "o1", name: "A" }]),
      {
        action: "create",
        name: "Ship it",
      },
    );
    expect(r.isError).toBeUndefined();
  });

  // resolveToolOrg's deliberate difference from pickActiveOrg: a requested id
  // that is not a membership is REFUSED, never silently swapped for another
  // tenant's org.
  it("refuses an orgId the caller is not a member of", async () => {
    const r = await manageGoalDescriptor.invoke(
      ctx([{ id: "o1", name: "A" }]),
      {
        action: "create",
        name: "Ship it",
        orgId: "o2",
      },
    );
    expect(r.isError).toBe(true);
  });

  // `create_goal` needs a progress model; an agent asked for a goal by name
  // alone. The app's own default (NewGoalDialog) is what it gets, rather than
  // a validation error the model has to guess its way out of.
  it("defaults progressMode to manual_percent", async () => {
    let rpcArgs: Record<string, unknown> | undefined;
    const r = await manageGoalDescriptor.invoke(
      {
        actorId: "u1",
        getClient: async () =>
          ({
            from: () => ({
              select: () => ({
                order: async () => ({
                  data: [{ id: "o1", name: "A" }],
                  error: null,
                }),
              }),
            }),
            rpc: async (_fn: string, args: Record<string, unknown>) => {
              rpcArgs = args;
              return { data: { id: "g1" }, error: null };
            },
          }) as never,
      },
      { action: "create", name: "Ship it" },
    );
    expect(r.isError).toBeUndefined();
    expect(rpcArgs?.p_progress_mode).toBe("manual_percent");
  });

  // The union rejects it before any client is fetched, so a malformed call
  // costs no rate-limit budget.
  it("rejects an unknown action without opening a client", async () => {
    let opened = false;
    const r = await manageGoalDescriptor.invoke(
      {
        actorId: "u1",
        getClient: async () => {
          opened = true;
          return {} as never;
        },
      },
      { action: "obliterate", goalId: "x" },
    );
    expect(r.isError).toBe(true);
    expect(opened).toBe(false);
  });
});

describe("manage_goal classification", () => {
  const actions = ["create", "update", "set_links", "delete"] as const;

  it("charges board.destroy for delete and board.structure for the rest", () => {
    expect(manageGoalDescriptor.capability).toEqual({
      create: "board.structure",
      update: "board.structure",
      set_links: "board.structure",
      delete: "board.destroy",
    });
  });

  // A goal is org-wide and can link many boards: there is no single board this
  // call addresses, so board_scope has nothing to narrow and RLS is the
  // boundary.
  it("declares scope none for every action", () => {
    for (const action of actions) {
      expect(
        (manageGoalDescriptor.scope as Record<string, string>)[action],
        action,
      ).toBe("none");
    }
  });

  // Creating a goal addresses no existing board, so a board-narrowed agent
  // must not be able to make one.
  it("declares create as an unscoped create", () => {
    expect(manageGoalDescriptor.unscopedCreateActions).toEqual(["create"]);
  });

  // `scopeFor` falls back to "none" for an action absent from the map, so the
  // enum and the map must agree or a real action silently loses its entry.
  it("lists every action in the input enum", () => {
    const enumValues = (
      manageGoalDescriptor.inputSchema.action as unknown as {
        options: string[];
      }
    ).options;
    expect([...enumValues].sort()).toEqual([...actions].sort());
  });
});
