import { createClient } from "@/lib/supabase/server";
import { listOrgMembers } from "@/lib/boards/queries";
import { optionSchema, type ColumnOption } from "@/lib/validations/boards";
import { mergeRows, serverToday } from "@/lib/portfolios/rollup";
import type {
  Placement,
  PortfolioRow,
  RollupRow,
  RowOwner,
} from "@/lib/portfolios/types";
import type { Tables } from "@/types/database.types";

/** Hot-path cap (AGENTS.md: bounded reads over indexed columns). Truncates
 * silently at the cap — raise alongside pagination if an org ever approaches it. */
export const PORTFOLIO_LIMIT = 200;

export async function listPortfolios(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolios")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(PORTFOLIO_LIMIT);
  return data ?? [];
}

export async function getPortfolio(
  portfolioId: string,
): Promise<Tables<"portfolios"> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .maybeSingle();
  return data ?? null;
}

function toPlacement(r: Tables<"portfolio_boards">): Placement {
  return {
    id: r.id,
    boardId: r.board_id,
    position: r.position,
    ownerUserId: r.owner_user_id,
    priority: r.priority,
    budget: r.budget === null ? null : Number(r.budget),
    healthOverride: r.health_override,
    statusNote: r.status_note,
    doneColumnId: r.done_column_id,
    doneOptionIds: Array.isArray(r.done_option_ids)
      ? (r.done_option_ids as string[])
      : [],
  };
}

export type PortfolioRowsResult = {
  portfolio: Tables<"portfolios">;
  rows: PortfolioRow[];
};

/** One-pass read for the grid: portfolio + placements + rollup + owners. */
export async function getPortfolioRows(
  portfolioId: string,
): Promise<PortfolioRowsResult | null> {
  const supabase = await createClient();

  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) return null;

  const today = serverToday(Date.now());

  const [placementsRes, rollupRes] = await Promise.all([
    supabase
      .from("portfolio_boards")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("position", { ascending: true }),
    supabase.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: today,
    }),
  ]);

  const placements = (placementsRes.data ?? []).map(toPlacement);
  const rollups: RollupRow[] = (rollupRes.data ?? []).map((r) => ({
    boardId: r.board_id,
    name: r.name,
    totalItems: Number(r.total_items),
    doneItems: Number(r.done_items),
    timelineStart: r.timeline_start,
    timelineEnd: r.timeline_end,
    overdueItems: Number(r.overdue_items),
  }));

  const members = await listOrgMembers(portfolio.org_id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
    ]),
  );

  return { portfolio, rows: mergeRows(placements, rollups, owners, today) };
}

export type StatusColumn = {
  id: string;
  name: string;
  options: ColumnOption[];
};

/** Status-kind columns of a board, for the completion-mapping picker. */
export async function getBoardStatusColumns(
  boardId: string,
): Promise<StatusColumn[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("columns")
    .select("id, name, kind, settings")
    .eq("board_id", boardId)
    .eq("kind", "status")
    .order("position", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    options:
      optionSchema
        .array()
        .safeParse((c.settings as { options?: unknown }).options ?? []).data ??
      [],
  }));
}

/** Hot-path cap (AGENTS.md: bounded reads). Truncates silently at the cap —
 * raise alongside pagination if a user's readable set ever approaches it. */
export const READABLE_BOARDS_LIMIT = 500;

/** Boards the current user can add to a portfolio (RLS already filters reads). */
export async function listReadableBoards(): Promise<
  { id: string; name: string; workspaceId: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id, name, workspace_id")
    .order("name", { ascending: true })
    .limit(READABLE_BOARDS_LIMIT);
  return (data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    workspaceId: b.workspace_id,
  }));
}
