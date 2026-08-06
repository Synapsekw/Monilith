import { createClient } from "@/lib/supabase/server";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { optionSchema, type ColumnOption } from "@/lib/validations/boards";
import { mergeRows, serverToday } from "@/lib/portfolios/rollup";
import type {
  Placement,
  PortfolioRow,
  RollupRow,
  RowOwner,
} from "@/lib/portfolios/types";
import type { Tables } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Hot-path cap (AGENTS.md: bounded reads over indexed columns). Truncates
 * silently at the cap — raise alongside pagination if an org ever approaches it. */
export const PORTFOLIO_LIMIT = 200;

/** Client-injected core. */
export async function listPortfoliosCore(
  supabase: SupabaseClient<Database>,
  limit: number = PORTFOLIO_LIMIT,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(limit);
  // A DB failure is not "no portfolios": throw so the portfolios error
  // boundary renders instead of a silently-empty list.
  if (error) throw new Error(`Failed to load portfolios: ${error.message}`);
  return data ?? [];
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function listPortfolios(): Promise<
  { id: string; name: string }[]
> {
  const supabase = await createClient();
  return listPortfoliosCore(supabase);
}

export async function getPortfolio(
  portfolioId: string,
): Promise<Tables<"portfolios"> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .maybeSingle();
  // A DB failure is not a 404: throw so the error boundary renders.
  // Missing/RLS-hidden row stays null → notFound().
  if (error) throw new Error(`Failed to load portfolio: ${error.message}`);
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

/** Client-injected core: portfolio + placements + rollup, merged with owners. */
export async function getPortfolioRowsCore(
  supabase: SupabaseClient<Database>,
  portfolioId: string,
  ctx: { owners: Map<string, RowOwner>; todayIso: string },
): Promise<PortfolioRowsResult | null> {
  const [portfolioRes, placementsRes, rollupRes] = await Promise.all([
    supabase.from("portfolios").select("*").eq("id", portfolioId).maybeSingle(),
    supabase
      .from("portfolio_boards")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("position", { ascending: true }),
    supabase.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: ctx.todayIso,
    }),
  ]);

  if (portfolioRes.error)
    throw new Error(`Failed to load portfolio: ${portfolioRes.error.message}`);
  if (placementsRes.error)
    throw new Error(
      `Failed to load portfolio placements: ${placementsRes.error.message}`,
    );
  if (rollupRes.error)
    throw new Error(
      `Failed to load portfolio rollup: ${rollupRes.error.message}`,
    );
  if (!portfolioRes.data) return null;

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

  return {
    portfolio: portfolioRes.data,
    rows: mergeRows(placements, rollups, ctx.owners, ctx.todayIso),
  };
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged.
 *
 * The owner map needs the portfolio's org, so the head row is read first here
 * (the core re-reads it inside its Promise.all — one extra bounded PK read on
 * the RSC path, in exchange for the core owning ALL of its own queries). */
export async function getPortfolioRows(
  portfolioId: string,
): Promise<PortfolioRowsResult | null> {
  const supabase = await createClient();
  const todayIso = serverToday(Date.now());

  const head = await getPortfolio(portfolioId);
  if (!head) return null;

  const members = await listOrgMembersCached(head.org_id);
  const owners = new Map<string, RowOwner>(
    members.map((m) => [
      m.userId,
      { userId: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl },
    ]),
  );
  return getPortfolioRowsCore(supabase, portfolioId, { owners, todayIso });
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
  const { data, error } = await supabase
    .from("columns")
    .select("id, name, kind, settings")
    .eq("board_id", boardId)
    .eq("kind", "status")
    .order("position", { ascending: true });
  // A DB failure is not "no status columns": throw so callers (the
  // ActionResult-wrapping server actions) surface it instead of silently
  // offering an empty picker.
  if (error) throw new Error(`Failed to load status columns: ${error.message}`);
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

/** Hot-path cap for the readable-boards read (AGENTS.md: bounded reads).
 * Consumed by `listReadableBoardsCached` in ./queries-cached — the uncached
 * RLS variant was deleted once all callers migrated. Truncates silently at
 * the cap — raise alongside pagination if a user's set ever approaches it. */
export const READABLE_BOARDS_LIMIT = 500;
