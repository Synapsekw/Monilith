import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { parseReportConfig, type ReportConfig } from "@/lib/reports/config";

/**
 * How a report is bound to boards (mirrors `reports_scope_ck`):
 *   board     → exactly one *home* board (`reports.board_id`), one report_boards row
 *   boards    → an explicit roll-up set, `report_boards` only
 *   portfolio → auto-follows the portfolio's `portfolio_boards`
 *   template  → org gallery entry: config only, no boards
 */
export type ReportScope = "board" | "boards" | "portfolio" | "template";

const SCOPES: readonly string[] = ["board", "boards", "portfolio", "template"];

/** `reports.scope` is `text` in the DB; narrow it, defaulting to the legacy shape. */
function toScope(raw: string | null): ReportScope {
  return raw !== null && SCOPES.includes(raw) ? (raw as ReportScope) : "board";
}

export type ReportRow = {
  id: string;
  orgId: string;
  scope: ReportScope;
  /** Home board — set for scope='board' only; NULL for roll-ups and templates. */
  boardId: string | null;
  portfolioId: string | null;
  name: string;
  config: ReportConfig;
  updatedAt: string;
};

function rowToReport(row: {
  id: string;
  org_id: string;
  scope: string;
  board_id: string | null;
  portfolio_id: string | null;
  name: string;
  config: unknown;
  updated_at: string;
}): ReportRow {
  return {
    id: row.id,
    orgId: row.org_id,
    scope: toScope(row.scope),
    boardId: row.board_id,
    portfolioId: row.portfolio_id,
    name: row.name,
    config: parseReportConfig(row.config),
    updatedAt: row.updated_at,
  };
}

/** Hot-path cap (AGENTS.md: bounded reads). Was an inline 100 in listReports. */
export const REPORTS_LIMIT = 100;

/**
 * Max boards ONE report renders. Bounded read (AGENTS.md) over the indexed
 * columns the v2 migration added (`report_boards_report_id_idx`,
 * `portfolio_boards`'s portfolio index) — a roll-up over hundreds of boards is
 * a document nobody reads, so cap the fan-out at the source.
 */
export const REPORT_BOARDS_LIMIT = 50;

const REPORT_COLUMNS =
  "id, org_id, scope, board_id, portfolio_id, name, config, updated_at";

/** Client-injected core. */
export async function getReportCore(
  supabase: SupabaseClient<Database>,
  reportId: string,
): Promise<ReportRow | null> {
  const { data } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("id", reportId)
    .maybeSingle();
  return data ? rowToReport(data) : null;
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export const getReport = cache(
  async (reportId: string): Promise<ReportRow | null> => {
    const supabase = await createClient();
    return getReportCore(supabase, reportId);
  },
);

/**
 * Reports bound to a board — client-injected core.
 *
 * Membership comes from `report_boards` (an `!inner` join filter), NOT from the
 * legacy `reports.board_id`: a multi-board roll-up that *includes* this board
 * must appear in the board's report list too. Templates are excluded — they
 * live in the org gallery, not on a board.
 */
export async function listReportsForBoardCore(
  supabase: SupabaseClient<Database>,
  boardId: string,
  limit: number = REPORTS_LIMIT,
): Promise<ReportRow[]> {
  const { data } = await supabase
    .from("reports")
    .select(`${REPORT_COLUMNS}, report_boards!inner(board_id)`)
    .eq("report_boards.board_id", boardId)
    .neq("scope", "template")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToReport);
}

/** Every report in an org, newest-first — client-injected core. */
export async function listReportsForOrgCore(
  supabase: SupabaseClient<Database>,
  orgId: string,
  opts: { includeTemplates?: boolean; limit?: number } = {},
): Promise<ReportRow[]> {
  const base = supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("org_id", orgId);
  const filtered = opts.includeTemplates ? base : base.neq("scope", "template");
  const { data } = await filtered
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? REPORTS_LIMIT);
  return (data ?? []).map(rowToReport);
}

/** The org's report-template gallery — client-injected core. */
export async function listReportTemplatesCore(
  supabase: SupabaseClient<Database>,
  orgId: string,
  limit: number = REPORTS_LIMIT,
): Promise<ReportRow[]> {
  const { data } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("org_id", orgId)
    .eq("scope", "template")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToReport);
}

/**
 * The ONE place a report's board membership is resolved — client-injected core.
 *
 * `template` → `[]` (no boards, by construction). `portfolio` → the portfolio's
 * `portfolio_boards`, so the report auto-follows the portfolio. Everything else
 * (`board`, `boards`) → `report_boards`, which the v2 migration backfilled for
 * every pre-existing report — so no caller needs a `reports.board_id` fallback.
 *
 * Every branch is bounded at {@link REPORT_BOARDS_LIMIT} over an indexed column.
 */
export async function resolveReportBoardIdsCore(
  supabase: SupabaseClient<Database>,
  report: ReportRow,
): Promise<string[]> {
  if (report.scope === "template") return [];

  if (report.scope === "portfolio") {
    // A portfolio-scoped row without a portfolio is unrepresentable in the DB
    // (reports_scope_binding_ck); fail closed rather than falling through to
    // report_boards, which would silently widen the report.
    if (!report.portfolioId) return [];
    const { data } = await supabase
      .from("portfolio_boards")
      .select("board_id")
      .eq("portfolio_id", report.portfolioId)
      .order("position", { ascending: true })
      .limit(REPORT_BOARDS_LIMIT);
    return (data ?? []).map((r) => r.board_id);
  }

  const { data } = await supabase
    .from("report_boards")
    .select("board_id")
    .eq("report_id", report.id)
    .order("position", { ascending: true })
    .limit(REPORT_BOARDS_LIMIT);
  return (data ?? []).map((r) => r.board_id);
}

/** Cookie-bound wrapper — the RSC entry point. */
export async function listReportsForBoard(
  boardId: string,
): Promise<ReportRow[]> {
  const supabase = await createClient();
  return listReportsForBoardCore(supabase, boardId);
}

/** Cookie-bound wrapper — the RSC entry point. */
export async function listReportsForOrg(
  orgId: string,
  opts?: { includeTemplates?: boolean; limit?: number },
): Promise<ReportRow[]> {
  const supabase = await createClient();
  return listReportsForOrgCore(supabase, orgId, opts);
}

/** Cookie-bound wrapper — the RSC entry point. */
export async function listReportTemplates(orgId: string): Promise<ReportRow[]> {
  const supabase = await createClient();
  return listReportTemplatesCore(supabase, orgId);
}

/** Cookie-bound wrapper — the RSC entry point. */
export async function resolveReportBoardIds(
  report: ReportRow,
): Promise<string[]> {
  const supabase = await createClient();
  return resolveReportBoardIdsCore(supabase, report);
}

/**
 * @deprecated Use {@link listReportsForBoardCore}. Kept because the MCP tool
 * `src/lib/mcp/tools/list-reports.ts` imports this name.
 */
export const listReportsCore = listReportsForBoardCore;

/**
 * @deprecated Use {@link listReportsForBoard}. Kept because
 * `app/(app)/boards/[boardId]/reports/page.tsx` imports this name.
 */
export const listReports = listReportsForBoard;
