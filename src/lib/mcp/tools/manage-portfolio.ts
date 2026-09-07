import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  addBoardToPortfolioCore,
  createPortfolioCore,
  removePortfolioBoardCore,
  updatePortfolioPlacementCore,
} from "@/lib/portfolios/core";
import {
  doneOptionIdsSchema,
  healthSchema,
  prioritySchema,
} from "@/lib/validations/portfolios";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import {
  parseAction,
  toToolResult,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const uuid = z.string().uuid();
const portfolioName = z.string().trim().min(1).max(100);

/** See `manage-dashboard.ts` on why this enum is load-bearing. */
export const managePortfolioInput = {
  action: z.enum(["create", "add_board", "remove_board", "update_placement"]),
  portfolioId: uuid.optional(),
  boardId: uuid.optional(),
  name: portfolioName.optional(),
  orgId: uuid.optional(),
  doneColumnId: uuid.nullable().optional(),
  doneOptionIds: doneOptionIdsSchema.optional(),
  ownerUserId: uuid.nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  budget: z.number().finite().nonnegative().nullable().optional(),
  healthOverride: healthSchema.nullable().optional(),
  statusNote: z.string().trim().max(280).nullable().optional(),
};

const managePortfolioAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: portfolioName,
    orgId: uuid.optional(),
  }),
  z.object({
    action: z.literal("add_board"),
    portfolioId: uuid,
    boardId: uuid,
    doneColumnId: uuid.nullable().default(null),
    doneOptionIds: doneOptionIdsSchema.default([]),
  }),
  z.object({
    action: z.literal("remove_board"),
    portfolioId: uuid,
    boardId: uuid,
  }),
  z.object({
    action: z.literal("update_placement"),
    portfolioId: uuid,
    boardId: uuid,
    ownerUserId: uuid.nullable().optional(),
    priority: prioritySchema.nullable().optional(),
    budget: z.number().finite().nonnegative().nullable().optional(),
    healthOverride: healthSchema.nullable().optional(),
    statusNote: z.string().trim().max(280).nullable().optional(),
  }),
]);

type Args = z.infer<typeof managePortfolioAction>;

/**
 * `(portfolioId, boardId)` → the placement row's own id.
 *
 * The Server Actions take a `placementId` because the portfolio UI already
 * holds one; an agent never does — it knows the portfolio and the board. RLS
 * scopes the lookup, so a portfolio in another org simply has no matching row.
 */
async function findPlacementId(
  supabase: SupabaseClient<Database>,
  portfolioId: string,
  boardId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("portfolio_boards")
    .select("id")
    .eq("portfolio_id", portfolioId)
    .eq("board_id", boardId)
    .maybeSingle();
  return data ? data.id : null;
}

export async function managePortfolioHandler(
  getClient: GetClient,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseAction(managePortfolioAction, input);
  if (!parsed.ok) return parsed.result;
  const args: Args = parsed.value;

  // ONCE per invocation (rate limit + bridge-secret rotation).
  const supabase = await getClient();

  if (args.action === "create") {
    // Refuses an org the caller is not a member of rather than substituting
    // one — see the note in `manage-goal.ts`.
    //
    // NOTE this is a MEMBERSHIP CHECK, not a destination: `create_portfolio`
    // (supabase/migrations/20260621071929_portfolios.sql:102-103) derives the
    // row's org_id itself via `select org_id from org_members where user_id =
    // v_uid limit 1` — no ORDER BY, so for a caller in >1 org the result is
    // arbitrary and `orgId` here does not steer it. Don't "fix" this by
    // threading `scope.orgId` into `createPortfolioCore`; the RPC ignores it.
    const scope = await resolveOrgForTool(supabase, args.orgId);
    if ("error" in scope)
      return { content: [{ type: "text", text: scope.error }], isError: true };

    const res = await createPortfolioCore(supabase, { name: args.name });
    if (!res.ok) return toToolResult(res);
    const portfolio = res.data.portfolio;
    // `create_portfolio`, like `create_goal`, derives the org from the caller's
    // membership itself — echo the org the row actually landed in.
    return toToolResult({
      ok: true,
      data: {
        portfolioId: portfolio.id,
        name: portfolio.name,
        orgId: portfolio.org_id,
      },
    });
  }

  if (args.action === "add_board") {
    const res = await addBoardToPortfolioCore(supabase, {
      portfolioId: args.portfolioId,
      boardId: args.boardId,
      doneColumnId: args.doneColumnId,
      doneOptionIds: args.doneOptionIds,
    });
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: {
        portfolioId: args.portfolioId,
        boardId: args.boardId,
        placementId: res.data.placement.id,
      },
    });
  }

  const placementId = await findPlacementId(
    supabase,
    args.portfolioId,
    args.boardId,
  );
  if (!placementId)
    return {
      content: [
        {
          type: "text",
          text: `Board ${args.boardId} is not in portfolio ${args.portfolioId}.`,
        },
      ],
      isError: true,
    };

  if (args.action === "remove_board") {
    const res = await removePortfolioBoardCore(supabase, {
      placementId,
      portfolioId: args.portfolioId,
    });
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: {
        portfolioId: args.portfolioId,
        boardId: args.boardId,
        removed: true,
      },
    });
  }

  // update_placement. Only the keys the caller actually sent are forwarded:
  // `updatePortfolioPlacementCore` builds its patch with `"key" in input`, so
  // an absent key means "leave it alone" and an explicit `null` means "clear
  // it". Spreading a normalised object with every key present would silently
  // wipe the four fields the caller never mentioned.
  const { action: _action, boardId: _boardId, ...fields } = args;
  const res = await updatePortfolioPlacementCore(supabase, {
    ...fields,
    placementId,
  });
  if (!res.ok) return toToolResult(res);
  return toToolResult({
    ok: true,
    data: {
      portfolioId: args.portfolioId,
      boardId: args.boardId,
      updated: true,
    },
  });
}

export const managePortfolioDescriptor: ToolDescriptor = {
  name: "manage_portfolio",
  title: "Manage portfolio",
  description:
    "Create a portfolio, add or remove a board from it, or set a board's roll-up metadata inside it. `create` needs a `name`; the portfolio is created in your default organization — `orgId` only confirms membership (list_organizations) and does NOT choose the destination, and an org you are not a member of is refused, never substituted — the response's `orgId` is the org it actually landed in. `add_board` takes `portfolioId` (list_portfolios) and `boardId` (list_boards), optionally with the status column and option ids that count as done, which is what makes the portfolio's completion column meaningful. `remove_board` and `update_placement` address the board by `portfolioId` + `boardId`. `update_placement` sets owner, priority, budget, health override and status note — send only the fields you are changing; an explicit null clears one.",
  inputSchema: managePortfolioInput,
  capability: {
    create: "board.structure",
    add_board: "board.structure",
    remove_board: "board.destroy",
    update_placement: "board.structure",
  },
  // A portfolio spans many boards by definition, so board_scope has no single
  // board to narrow on and RLS is the boundary — the same reasoning
  // `descriptor.ts` records for get_portfolio.
  scope: {
    create: "none",
    add_board: "none",
    remove_board: "none",
    update_placement: "none",
  },
  // A portfolio is a new top-level object addressing no existing board.
  unscopedCreateActions: ["create"],
  invoke: (ctx, input) => managePortfolioHandler(ctx.getClient, input),
};
