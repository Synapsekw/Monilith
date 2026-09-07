"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  getBoardStatusColumns,
  type StatusColumn,
} from "@/lib/portfolios/queries";
import {
  addBoardToPortfolioCore,
  createPortfolioCore,
  removePortfolioBoardCore,
  updatePortfolioPlacementCore,
} from "@/lib/portfolios/core";
import type { Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * Cookie-bound wrappers. Each supplies the request's RLS client to its core in
 * `./core`, then revalidates — the one step a core must not take.
 * `manage_portfolio` over MCP calls the same cores with a bridged client.
 */

export async function createPortfolio(input: {
  name: string;
}): Promise<ActionResult<{ portfolio: Tables<"portfolios"> }>> {
  const supabase = await createClient();
  const res = await createPortfolioCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath("/portfolios");
  return res;
}

export async function addBoardToPortfolio(input: {
  portfolioId: string;
  boardId: string;
  doneColumnId: string | null;
  doneOptionIds: string[];
}): Promise<ActionResult<{ placement: Tables<"portfolio_boards"> }>> {
  const supabase = await createClient();
  const res = await addBoardToPortfolioCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath(`/portfolios/${input.portfolioId}`);
  return res;
}

export async function removePortfolioBoard(input: {
  placementId: string;
  portfolioId: string;
}): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const res = await removePortfolioBoardCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath(`/portfolios/${input.portfolioId}`);
  return res;
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
  const supabase = await createClient();
  const res = await updatePortfolioPlacementCore(supabase, input);
  if (!res.ok) return res;

  revalidatePath(`/portfolios/${input.portfolioId}`);
  return res;
}

export async function getStatusColumnsForBoard(
  boardId: string,
): Promise<ActionResult<{ columns: StatusColumn[] }>> {
  const parsed = z.string().uuid().safeParse(boardId);
  if (!parsed.success) return fail("Invalid board");

  // `getBoardStatusColumns` throws on a DB/RLS failure (deliberately — an empty
  // picker would misrepresent it). Convert it here so the declared
  // `ActionResult` contract holds and callers get their own error state.
  try {
    const columns = await getBoardStatusColumns(parsed.data);
    return { ok: true, data: { columns } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
