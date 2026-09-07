import type { SupabaseClient } from "@supabase/supabase-js";

import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  addBoardSchema,
  createPortfolioSchema,
  removePlacementSchema,
  updatePlacementSchema,
} from "@/lib/validations/portfolios";
import type { Database, Tables, TablesUpdate } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Client-injected cores for every portfolio MUTATION — one body, two
 * transports (the `"use server"` wrappers in `./actions`, and `manage_portfolio`
 * over MCP). `revalidatePath` stays in the wrapper.
 *
 * Like `create_goal`, `create_portfolio` is a SECURITY DEFINER function that
 * derives the org from the caller's own `org_members` row, so no core here
 * takes an `orgId`.
 */

type Db = SupabaseClient<Database>;

export async function createPortfolioCore(
  supabase: Db,
  input: { name: string },
): Promise<ActionResult<{ portfolio: Tables<"portfolios"> }>> {
  const parsed = createPortfolioSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { data, error } = await supabase.rpc("create_portfolio", {
    p_name: parsed.data.name,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create portfolio.");

  return { ok: true, data: { portfolio: data as Tables<"portfolios"> } };
}

export async function addBoardToPortfolioCore(
  supabase: Db,
  input: {
    portfolioId: string;
    boardId: string;
    doneColumnId: string | null;
    doneOptionIds: string[];
  },
): Promise<ActionResult<{ placement: Tables<"portfolio_boards"> }>> {
  const parsed = addBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { data, error } = await typedRpc(supabase, "add_portfolio_board", {
    p_portfolio_id: parsed.data.portfolioId,
    p_board_id: parsed.data.boardId,
    p_done_column_id: parsed.data.doneColumnId,
    p_done_option_ids: parsed.data.doneOptionIds,
  });
  if (error || !data) return fail(error?.message ?? "Could not add board.");

  return { ok: true, data: { placement: data as Tables<"portfolio_boards"> } };
}

/**
 * Remove one board's PLACEMENT row. Addressed by `placementId`, not
 * `(portfolioId, boardId)`: the placement id is the row's own PK and is what
 * the portfolio UI already holds. A caller that only knows the board (MCP)
 * resolves the placement first — see `manage-portfolio.ts`.
 */
export async function removePortfolioBoardCore(
  supabase: Db,
  input: { placementId: string; portfolioId: string },
): Promise<ActionResult<null>> {
  const parsed = removePlacementSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { error } = await supabase
    .from("portfolio_boards")
    .delete()
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  return { ok: true, data: null };
}

/**
 * Patch a placement's roll-up metadata. As in `updateGoalCore`, the patch is
 * built from `"key" in input` on the RAW input — every field is nullable AND
 * optional, so "leave it alone" and "clear it" are only distinguishable there.
 */
export async function updatePortfolioPlacementCore(
  supabase: Db,
  input: {
    placementId: string;
    portfolioId: string;
    ownerUserId?: string | null;
    priority?: "low" | "medium" | "high" | "critical" | null;
    budget?: number | null;
    healthOverride?: "on_track" | "at_risk" | "off_track" | null;
    statusNote?: string | null;
  },
): Promise<ActionResult<null>> {
  const parsed = updatePlacementSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const patch: TablesUpdate<"portfolio_boards"> = {};
  if ("ownerUserId" in input) patch.owner_user_id = parsed.data.ownerUserId;
  if ("priority" in input) patch.priority = parsed.data.priority;
  if ("budget" in input) patch.budget = parsed.data.budget;
  if ("healthOverride" in input)
    patch.health_override = parsed.data.healthOverride;
  if ("statusNote" in input) patch.status_note = parsed.data.statusNote;

  const { error } = await supabase
    .from("portfolio_boards")
    .update(patch)
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  return { ok: true, data: null };
}
