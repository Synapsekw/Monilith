"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import {
  getBoardStatusColumns,
  type StatusColumn,
} from "@/lib/portfolios/queries";
import {
  addBoardSchema,
  createPortfolioSchema,
  removePlacementSchema,
  updatePlacementSchema,
} from "@/lib/validations/portfolios";
import type { Json, Tables, TablesUpdate } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

export async function createPortfolio(input: {
  name: string;
}): Promise<ActionResult<{ portfolio: Tables<"portfolios"> }>> {
  const parsed = createPortfolioSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_portfolio", {
    p_name: parsed.data.name,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create portfolio.");

  revalidatePath("/portfolios");
  return { ok: true, data: { portfolio: data as Tables<"portfolios"> } };
}

export async function addBoardToPortfolio(input: {
  portfolioId: string;
  boardId: string;
  doneColumnId: string | null;
  doneOptionIds: string[];
}): Promise<ActionResult<{ placement: Tables<"portfolio_boards"> }>> {
  const parsed = addBoardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await typedRpc(supabase, "add_portfolio_board", {
    p_portfolio_id: parsed.data.portfolioId,
    p_board_id: parsed.data.boardId,
    p_done_column_id: parsed.data.doneColumnId,
    p_done_option_ids: parsed.data.doneOptionIds,
  });
  if (error || !data) return fail(error?.message ?? "Could not add board.");

  revalidatePath(`/portfolios/${parsed.data.portfolioId}`);
  return { ok: true, data: { placement: data as Tables<"portfolio_boards"> } };
}

export async function removePortfolioBoard(input: {
  placementId: string;
  portfolioId: string;
}): Promise<ActionResult<null>> {
  const parsed = removePlacementSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_boards")
    .delete()
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  revalidatePath(`/portfolios/${parsed.data.portfolioId}`);
  return { ok: true, data: null };
}

export async function updatePortfolioPlacement(input: {
  placementId: string;
  portfolioId: string;
  ownerUserId?: string | null;
  priority?: "low" | "medium" | "high" | "critical" | null;
  budget?: number | null;
  healthOverride?: "on_track" | "at_risk" | "off_track" | null;
  statusNote?: string | null;
}): Promise<ActionResult<null>> {
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("portfolio_boards")
    .update(patch)
    .eq("id", parsed.data.placementId);
  if (error) return fail(error.message);

  revalidatePath(`/portfolios/${parsed.data.portfolioId}`);
  return { ok: true, data: null };
}

export async function getStatusColumnsForBoard(
  boardId: string,
): Promise<ActionResult<{ columns: StatusColumn[] }>> {
  const parsed = z.string().uuid().safeParse(boardId);
  if (!parsed.success) return fail("Invalid board");

  const columns = await getBoardStatusColumns(parsed.data);
  return { ok: true, data: { columns } };
}
