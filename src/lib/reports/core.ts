import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { type ActionResult, fail } from "@/lib/actions/result";
import { defaultReportConfig, type ReportConfig } from "@/lib/reports/config";
import { canEditReports, type ReportAccess } from "@/lib/reports/access";
import { deriveBoardAccess } from "@/lib/boards/queries";
import type { ReportRow, ReportScope } from "@/lib/reports/queries";
import {
  bindingBoardIds,
  bindingColumns,
  createReportSchema,
  reportIdSchema,
  saveReportSchema,
  setReportScopeSchema,
  type ReportBinding,
} from "@/lib/validations/reports";

/**
 * Client-injected cores for every report MUTATION — one body, two transports
 * (the `"use server"` wrappers in `./actions`, and `manage_report` over MCP).
 *
 * THREE things the Server Actions used to reach for from ambient request state
 * are parameters here, because an MCP request has none of them:
 *
 * - the Supabase client (cookies → the bridged OAuth client),
 * - `requireUser()` → `deps.userId`,
 * - `getActiveOrgId()` → `deps.orgId` (MCP resolves it with `resolveToolOrg`,
 *   which REFUSES an org the caller is not a member of rather than falling back
 *   to another one).
 *
 * Two reads are injected as FUNCTIONS rather than called directly: loading the
 * report + its access, and resolving a portfolio's org. Both have a cookie-bound
 * form (`getReport` / `resolveReportAccess` / `getPortfolio`) and a
 * client-injected form (`getReportCore` / `resolveReportAccessCore` / a direct
 * select). Injecting them keeps the guards — "Report not found.", "You can't
 * edit this report.", the whole of `bindingDenialReason` — in ONE place instead
 * of duplicated per transport, which is the point of the exercise.
 *
 * `revalidatePath` is NOT here. Each core returns the `boardIds` the Server
 * Action needs so `revalidateReport` can do exactly what it did before.
 */

type Db = SupabaseClient<Database>;

/** Resolves a portfolio's org id, or null when it is missing/RLS-invisible. */
export type PortfolioOrgLookup = (
  portfolioId: string,
) => Promise<string | null>;

/** Loads a report row, or null when it is missing/RLS-invisible. */
export type ReportLoader = (reportId: string) => Promise<ReportRow | null>;

/** Resolves the caller's access to an already-loaded report. */
export type ReportAccessLoader = (report: ReportRow) => Promise<ReportAccess>;

/** What every mutation on an EXISTING report needs to load and gate itself. */
export type ReportEditDeps = {
  loadReport: ReportLoader;
  loadAccess: ReportAccessLoader;
};

// ─────────────────────────────────────────────────────────── shared helpers

/**
 * May the caller edit reports on EVERY one of these boards, all of them inside
 * `orgId`?
 *
 * Two batched reads for the whole set (`boards` + this user's `board_members`
 * rows) fed through the canonical pure `deriveBoardAccess` — never N sequential
 * `reportBoardAccess()` round trips. The `org_id` check is app-layer
 * cross-tenant confinement, ahead of the DB's `board_in_org` write policy: a
 * board in another org is not bindable even if RLS would somehow show it.
 */
async function canEditAllBoards(
  supabase: Db,
  userId: string,
  orgId: string,
  boardIds: string[],
): Promise<boolean> {
  if (boardIds.length === 0) return true;
  const ids = [...new Set(boardIds)];

  const [boardsRes, grantsRes] = await Promise.all([
    supabase.from("boards").select("id, created_by, org_id").in("id", ids),
    supabase
      .from("board_members")
      .select("board_id, user_id, access_level")
      .in("board_id", ids)
      .eq("user_id", userId),
  ]);

  const boardsById = new Map(
    (boardsRes.data ?? []).map((b) => [b.id, b] as const),
  );
  const grantsByBoard = new Map<
    string,
    { userId: string; access: "editor" | "viewer" }[]
  >();
  for (const g of grantsRes.data ?? []) {
    const list = grantsByBoard.get(g.board_id) ?? [];
    list.push({ userId: g.user_id, access: g.access_level });
    grantsByBoard.set(g.board_id, list);
  }

  return ids.every((id) => {
    const board = boardsById.get(id);
    if (!board || board.org_id !== orgId) return false;
    return canEditReports(
      deriveBoardAccess(board, grantsByBoard.get(id) ?? [], userId),
    );
  });
}

/**
 * Is this binding one the caller is allowed to create? Returns an error message
 * or `null`.
 *
 * A `portfolio` binding is checked at the PORTFOLIO, not board-by-board: the
 * report follows `portfolio_boards`, whose membership is the portfolio's to
 * decide, and requiring board-edit on every board in it would lock an exec out
 * of a roll-up over teams they only observe.
 */
export async function bindingDenialReason(
  supabase: Db,
  ctx: {
    userId: string;
    orgId: string;
    getPortfolioOrgId: PortfolioOrgLookup;
  },
  binding: ReportBinding,
): Promise<string | null> {
  const boardIds = bindingBoardIds(binding);
  if (
    boardIds.length > 0 &&
    !(await canEditAllBoards(supabase, ctx.userId, ctx.orgId, boardIds))
  ) {
    return "You can't create reports on every board you selected.";
  }
  if (binding.scope === "portfolio") {
    const portfolioOrgId = await ctx.getPortfolioOrgId(binding.portfolioId);
    if (portfolioOrgId === null || portfolioOrgId !== ctx.orgId) {
      return "You don't have access to that portfolio.";
    }
  }
  return null;
}

/**
 * Make `report_boards` say exactly `boardIds`. `replace` deletes the rows that
 * no longer apply first, so a scope change never leaves a stale membership row
 * widening the report. Returns false on any DB failure.
 */
export async function writeReportBoards(
  supabase: Db,
  opts: {
    reportId: string;
    orgId: string;
    boardIds: string[];
    replace: boolean;
  },
): Promise<boolean> {
  if (opts.replace) {
    const { error } = await supabase
      .from("report_boards")
      .delete()
      .eq("report_id", opts.reportId);
    if (error) return false;
  }
  if (opts.boardIds.length === 0) return true;
  const { error } = await supabase.from("report_boards").insert(
    opts.boardIds.map((boardId, i) => ({
      org_id: opts.orgId,
      report_id: opts.reportId,
      board_id: boardId,
      position: i,
    })),
  );
  return !error;
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid";
}

/** Load + gate: the "load the report → derive access → require canEdit" preamble
 *  every mutation on an existing report shares. */
async function requireEditable(
  deps: ReportEditDeps,
  reportId: string,
  denial: string,
): Promise<
  | { ok: true; report: ReportRow; access: ReportAccess }
  | { ok: false; error: string }
> {
  const report = await deps.loadReport(reportId);
  if (!report) return { ok: false, error: "Report not found." };

  const access = await deps.loadAccess(report);
  if (!access.canEdit) return { ok: false, error: denial };

  return { ok: true, report, access };
}

// ───────────────────────────────────────────────────────────────── the cores

export async function createReportCore(
  supabase: Db,
  input: {
    name: string;
    scope: ReportScope;
    boardId?: string;
    boardIds?: string[];
    portfolioId?: string;
  },
  deps: {
    userId: string;
    orgId: string;
    getPortfolioOrgId: PortfolioOrgLookup;
  },
): Promise<ActionResult<{ id: string; boardIds: string[] }>> {
  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const denied = await bindingDenialReason(supabase, deps, parsed.data);
  if (denied) return fail(denied);

  const boardIds = bindingBoardIds(parsed.data);
  const { data, error } = await supabase
    .from("reports")
    .insert({
      org_id: deps.orgId,
      ...bindingColumns(parsed.data),
      name: parsed.data.name,
      config: defaultReportConfig(),
      created_by: deps.userId,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not create the report.");

  if (
    !(await writeReportBoards(supabase, {
      reportId: data.id,
      orgId: deps.orgId,
      boardIds,
      replace: false,
    }))
  ) {
    // PostgREST gives us no transaction across the two statements. A report
    // whose membership rows failed to write renders as an empty document and
    // is invisible in every board's list, so undo it rather than leave it.
    await supabase.from("reports").delete().eq("id", data.id);
    return fail("Could not bind the report to its boards.");
  }

  return { ok: true, data: { id: data.id, boardIds } };
}

export async function saveReportCore(
  supabase: Db,
  input: { reportId: string; name: string; config: ReportConfig },
  deps: ReportEditDeps,
): Promise<ActionResult<{ id: string; boardIds: string[] }>> {
  const parsed = saveReportSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const gate = await requireEditable(
    deps,
    parsed.data.reportId,
    "You can't edit this report.",
  );
  if (!gate.ok) return fail(gate.error);

  const { error } = await supabase
    .from("reports")
    .update({
      name: parsed.data.name,
      config: parsed.data.config,
      // `reports.updated_at` has no DB trigger — every update sets it by hand.
      updated_at: new Date().toISOString(),
    })
    .eq("id", gate.report.id);
  if (error) return fail("Could not save the report.");

  return {
    ok: true,
    data: { id: gate.report.id, boardIds: gate.access.boardIds },
  };
}

export async function setReportScopeCore(
  supabase: Db,
  input: {
    reportId: string;
    scope: ReportScope;
    boardId?: string;
    boardIds?: string[];
    portfolioId?: string;
  },
  deps: ReportEditDeps & {
    userId: string;
    getPortfolioOrgId: PortfolioOrgLookup;
  },
): Promise<ActionResult<{ id: string; boardIds: string[] }>> {
  const parsed = setReportScopeSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const gate = await requireEditable(
    deps,
    parsed.data.reportId,
    "You can't edit this report.",
  );
  if (!gate.ok) return fail(gate.error);
  const { report, access } = gate;

  // The report keeps its own org — a re-scope must not migrate it to whatever
  // org the caller happens to have active.
  const denied = await bindingDenialReason(
    supabase,
    {
      userId: deps.userId,
      orgId: report.orgId,
      getPortfolioOrgId: deps.getPortfolioOrgId,
    },
    parsed.data,
  );
  if (denied) return fail(denied);

  const boardIds = bindingBoardIds(parsed.data);
  const { error } = await supabase
    .from("reports")
    .update({
      ...bindingColumns(parsed.data),
      updated_at: new Date().toISOString(),
    })
    .eq("id", report.id);
  if (error) return fail("Could not change this report's scope.");

  // Same logical operation as the scope write: `report_boards` must agree with
  // `scope` or the read path resolves a set the scope says cannot exist.
  if (
    !(await writeReportBoards(supabase, {
      reportId: report.id,
      orgId: report.orgId,
      boardIds,
      replace: true,
    }))
  ) {
    return fail("Could not update this report's boards.");
  }

  // BOTH board sets: the ones it left and the ones it joined.
  return {
    ok: true,
    data: {
      id: report.id,
      boardIds: [...new Set([...access.boardIds, ...boardIds])],
    },
  };
}

export async function deleteReportCore(
  supabase: Db,
  input: { reportId: string },
  deps: ReportEditDeps,
): Promise<ActionResult<{ id: string; boardIds: string[] }>> {
  const parsed = reportIdSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const gate = await requireEditable(
    deps,
    parsed.data.reportId,
    "You can't delete this report.",
  );
  if (!gate.ok) return fail(gate.error);

  // `report_boards.report_id` is ON DELETE CASCADE — membership goes with it.
  const { error } = await supabase
    .from("reports")
    .delete()
    .eq("id", gate.report.id);
  if (error) return fail("Could not delete the report.");

  return {
    ok: true,
    data: { id: gate.report.id, boardIds: gate.access.boardIds },
  };
}
