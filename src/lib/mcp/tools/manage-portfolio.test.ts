import { describe, expect, it } from "vitest";
import { managePortfolioDescriptor } from "./manage-portfolio";

const ORG = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";
const PLACEMENT = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const COLUMN = "66666666-6666-4666-8666-666666666666";

type Row = { data: unknown; error: unknown };

function client(opts: {
  orgs?: { id: string; name: string }[];
  placement?: Row;
  rpc?: (fn: string, args: Record<string, unknown>) => Row;
  onDelete?: (id: unknown) => void;
  onUpdate?: (patch: Record<string, unknown>) => void;
}) {
  return {
    from: (table: string) => {
      if (table === "organizations")
        return {
          select: () => ({
            order: async () => ({ data: opts.orgs ?? [], error: null }),
          }),
        };
      // portfolio_boards: the placement lookup, the delete and the update.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.placement ?? { data: null, error: null },
            }),
          }),
        }),
        delete: () => ({
          eq: async (_col: string, id: unknown) => {
            opts.onDelete?.(id);
            return { error: null };
          },
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            opts.onUpdate?.(patch);
            return { error: null };
          },
        }),
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) =>
      opts.rpc ? opts.rpc(fn, args) : { data: null, error: null },
  };
}

const ctx = (supabase: unknown) => ({
  actorId: "u1",
  getClient: async () => supabase as never,
});

describe("manage_portfolio create", () => {
  it("creates in the caller's only org when none is named", async () => {
    const supabase = client({
      orgs: [{ id: ORG, name: "Acme" }],
      rpc: () => ({
        data: { id: PORTFOLIO, name: "FY26", org_id: ORG },
        error: null,
      }),
    });
    const r = await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "create",
      name: "FY26",
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({
      portfolioId: PORTFOLIO,
      name: "FY26",
      orgId: ORG,
    });
  });

  it("refuses an orgId the caller is not a member of", async () => {
    const supabase = client({ orgs: [{ id: ORG, name: "Acme" }] });
    const r = await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "create",
      name: "Theirs",
      orgId: PORTFOLIO,
    });
    expect(r.isError).toBe(true);
  });
});

describe("manage_portfolio board placement", () => {
  it("adds a board with its done column and options", async () => {
    let rpcArgs: Record<string, unknown> | undefined;
    const supabase = client({
      rpc: (_fn, args) => {
        rpcArgs = args;
        return { data: { id: PLACEMENT }, error: null };
      },
    });
    const r = await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "add_board",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
      doneColumnId: COLUMN,
      doneOptionIds: ["done"],
    });
    expect(r.isError).toBeUndefined();
    expect(rpcArgs).toEqual({
      p_portfolio_id: PORTFOLIO,
      p_board_id: BOARD,
      p_done_column_id: COLUMN,
      p_done_option_ids: ["done"],
    });
  });

  it("defaults the done column to null and the options to empty", async () => {
    let rpcArgs: Record<string, unknown> | undefined;
    const supabase = client({
      rpc: (_fn, args) => {
        rpcArgs = args;
        return { data: { id: PLACEMENT }, error: null };
      },
    });
    await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "add_board",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
    });
    expect(rpcArgs?.p_done_column_id).toBeNull();
    expect(rpcArgs?.p_done_option_ids).toEqual([]);
  });

  // The Server Actions address a placement by its own id, which an agent never
  // has; it knows the portfolio and the board. RLS scopes the lookup, so
  // another org's portfolio simply has no matching row.
  it("resolves the placement from portfolioId + boardId before removing", async () => {
    let deletedId: unknown;
    const supabase = client({
      placement: { data: { id: PLACEMENT }, error: null },
      onDelete: (id) => {
        deletedId = id;
      },
    });
    const r = await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "remove_board",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
    });
    expect(r.isError).toBeUndefined();
    expect(deletedId).toBe(PLACEMENT);
  });

  it("refuses a board that is not in the portfolio", async () => {
    let deleted = false;
    const supabase = client({
      placement: { data: null, error: null },
      onDelete: () => {
        deleted = true;
      },
    });
    const r = await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "remove_board",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
    });
    expect(r.isError).toBe(true);
    expect(deleted).toBe(false);
  });

  // `updatePortfolioPlacementCore` builds its patch with `"key" in input`, so
  // an omitted field must reach it OMITTED. Forwarding a normalised object
  // with every key present would wipe the four fields nobody mentioned.
  it("patches only the fields the caller sent", async () => {
    let patch: Record<string, unknown> | undefined;
    const supabase = client({
      placement: { data: { id: PLACEMENT }, error: null },
      onUpdate: (p) => {
        patch = p;
      },
    });
    const r = await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "update_placement",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
      priority: "high",
    });
    expect(r.isError).toBeUndefined();
    expect(patch).toEqual({ priority: "high" });
  });

  // An explicit null is a CLEAR, and must survive as one.
  it("clears a field passed as null", async () => {
    let patch: Record<string, unknown> | undefined;
    const supabase = client({
      placement: { data: { id: PLACEMENT }, error: null },
      onUpdate: (p) => {
        patch = p;
      },
    });
    await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "update_placement",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
      ownerUserId: null,
      statusNote: "Slipping",
    });
    expect(patch).toEqual({ owner_user_id: null, status_note: "Slipping" });
  });

  it("accepts an owner user id", async () => {
    let patch: Record<string, unknown> | undefined;
    const supabase = client({
      placement: { data: { id: PLACEMENT }, error: null },
      onUpdate: (p) => {
        patch = p;
      },
    });
    await managePortfolioDescriptor.invoke(ctx(supabase), {
      action: "update_placement",
      portfolioId: PORTFOLIO,
      boardId: BOARD,
      ownerUserId: USER,
    });
    expect(patch).toEqual({ owner_user_id: USER });
  });
});

describe("manage_portfolio classification", () => {
  const actions = [
    "create",
    "add_board",
    "remove_board",
    "update_placement",
  ] as const;

  it("charges board.destroy for remove_board and board.structure for the rest", () => {
    expect(managePortfolioDescriptor.capability).toEqual({
      create: "board.structure",
      add_board: "board.structure",
      remove_board: "board.destroy",
      update_placement: "board.structure",
    });
  });

  it("declares scope none for every action", () => {
    for (const action of actions) {
      expect(
        (managePortfolioDescriptor.scope as Record<string, string>)[action],
        action,
      ).toBe("none");
    }
  });

  it("declares create as an unscoped create", () => {
    expect(managePortfolioDescriptor.unscopedCreateActions).toEqual(["create"]);
  });

  it("lists every action in the input enum", () => {
    const enumValues = (
      managePortfolioDescriptor.inputSchema.action as unknown as {
        options: string[];
      }
    ).options;
    expect([...enumValues].sort()).toEqual([...actions].sort());
  });
});
