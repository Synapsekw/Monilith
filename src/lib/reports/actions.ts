"use server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { type ActionResult, fail } from "@/lib/actions/result";
import { defaultReportConfig, type ReportConfig } from "@/lib/reports/config";
import { canEditReports, resolveReportAccess } from "@/lib/reports/access";
import { deriveBoardAccess } from "@/lib/boards/queries";
import { getPortfolio } from "@/lib/portfolios/queries";
import { getReport, type ReportScope } from "@/lib/reports/queries";
import { loadReportScopeContext } from "@/lib/reports/payload";
import { deriveRenderData } from "@/lib/reports/render-data";
import { buildReportHtml } from "@/lib/reports/export-html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import {
  bindingBoardIds,
  bindingColumns,
  createReportFromTemplateSchema,
  createReportSchema,
  reportIdSchema,
  saveReportAsTemplateSchema,
  saveReportSchema,
  setReportScopeSchema,
  type ReportBinding,
} from "@/lib/validations/reports";

/**
 * NO ACTION TAKES A CLIENT `boardId` ANY MORE (except the ones that *set* the
 * binding: `createReport`, `setReportScope`, `createReportFromTemplate`).
 *
 * v1 accepted `{ reportId, boardId }` and then re-checked
 * `report.boardId !== input.boardId` — a guard that only existed *because* the
 * client supplied the board. A report now spans many boards, and the server
 * resolves that set from the report id alone (`resolveReportAccess` →
 * `resolveReportBoardIds`), so the client cannot influence scope at all and the
 * guard has nothing left to guard. Every mutation is: load the report → derive
 * access → require `canEdit`. Export requires only `canRead`, because viewers
 * have always been allowed to export what they can already see on screen.
 */

type Db = SupabaseClient<Database>;

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
async function bindingDenialReason(
  supabase: Db,
  userId: string,
  orgId: string,
  binding: ReportBinding,
): Promise<string | null> {
  const boardIds = bindingBoardIds(binding);
  if (
    boardIds.length > 0 &&
    !(await canEditAllBoards(supabase, userId, orgId, boardIds))
  ) {
    return "You can't create reports on every board you selected.";
  }
  if (binding.scope === "portfolio") {
    const portfolio = await getPortfolio(binding.portfolioId);
    if (!portfolio || portfolio.org_id !== orgId) {
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
async function writeReportBoards(
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

/**
 * Targeted revalidation. v1 had none, so `/reports` and a board's report list
 * went stale the moment a report was created, renamed or deleted. `boardIds` is
 * already bounded by `REPORT_BOARDS_LIMIT`.
 */
function revalidateReport(reportId: string, boardIds: string[]): void {
  revalidatePath("/reports");
  for (const boardId of boardIds) {
    revalidatePath(`/boards/${boardId}/reports`);
    revalidatePath(`/boards/${boardId}/reports/${reportId}`);
  }
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid";
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "report";
}

// ───────────────────────────────────────────────────────────────── actions

export async function createReport(input: {
  name: string;
  scope: ReportScope;
  boardId?: string;
  boardIds?: string[];
  portfolioId?: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const [user, orgId] = await Promise.all([requireUser(), getActiveOrgId()]);
  if (!orgId) return fail("No active organization.");

  const supabase = await createClient();
  const denied = await bindingDenialReason(
    supabase,
    user.id,
    orgId,
    parsed.data,
  );
  if (denied) return fail(denied);

  const boardIds = bindingBoardIds(parsed.data);
  const { data, error } = await supabase
    .from("reports")
    .insert({
      org_id: orgId,
      ...bindingColumns(parsed.data),
      name: parsed.data.name,
      config: defaultReportConfig(),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not create the report.");

  if (
    !(await writeReportBoards(supabase, {
      reportId: data.id,
      orgId,
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

  revalidateReport(data.id, boardIds);
  return { ok: true, data: { id: data.id } };
}

export async function saveReport(input: {
  reportId: string;
  name: string;
  config: ReportConfig;
}): Promise<ActionResult<void>> {
  const parsed = saveReportSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const report = await getReport(parsed.data.reportId);
  if (!report) return fail("Report not found.");

  const access = await resolveReportAccess(report);
  if (!access.canEdit) return fail("You can't edit this report.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({
      name: parsed.data.name,
      config: parsed.data.config,
      // `reports.updated_at` has no DB trigger — every update sets it by hand.
      updated_at: new Date().toISOString(),
    })
    .eq("id", report.id);
  if (error) return fail("Could not save the report.");

  revalidateReport(report.id, access.boardIds);
  return { ok: true, data: undefined };
}

export async function setReportScope(input: {
  reportId: string;
  scope: ReportScope;
  boardId?: string;
  boardIds?: string[];
  portfolioId?: string;
}): Promise<ActionResult<void>> {
  const parsed = setReportScopeSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const report = await getReport(parsed.data.reportId);
  if (!report) return fail("Report not found.");

  const access = await resolveReportAccess(report);
  if (!access.canEdit) return fail("You can't edit this report.");

  const user = await requireUser();
  const supabase = await createClient();
  // The report keeps its own org — a re-scope must not migrate it to whatever
  // org the caller happens to have active.
  const denied = await bindingDenialReason(
    supabase,
    user.id,
    report.orgId,
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

  // Revalidate BOTH boards: the ones it left and the ones it joined.
  revalidateReport(report.id, [...new Set([...access.boardIds, ...boardIds])]);
  return { ok: true, data: undefined };
}

export async function deleteReport(input: {
  reportId: string;
}): Promise<ActionResult<void>> {
  const parsed = reportIdSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const report = await getReport(parsed.data.reportId);
  if (!report) return fail("Report not found.");

  const access = await resolveReportAccess(report);
  if (!access.canEdit) return fail("You can't delete this report.");

  const supabase = await createClient();
  // `report_boards.report_id` is ON DELETE CASCADE — membership goes with it.
  const { error } = await supabase.from("reports").delete().eq("id", report.id);
  if (error) return fail("Could not delete the report.");

  revalidateReport(report.id, access.boardIds);
  return { ok: true, data: undefined };
}

export async function exportReportPdf(input: {
  reportId: string;
}): Promise<ActionResult<{ fileName: string; base64: string; mime: string }>> {
  const parsed = reportIdSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const report = await getReport(parsed.data.reportId);
  if (!report) return fail("Report not found.");

  const access = await resolveReportAccess(report);
  // READ, not edit: a viewer may export the document they can already see.
  if (!access.canRead) return fail("You don't have access to this report.");

  const ctx = await loadReportScopeContext(report, access);
  // The SAME derivation the client preview runs — the parity guarantee.
  const { boards, totals, pooledChartSeries } = deriveRenderData(
    ctx.payloads,
    ctx.peopleNames,
    report.config,
  );

  const html = await buildReportHtml({
    config: report.config,
    boards,
    totals,
    pooledChartSeries,
    scopeLabel: ctx.scopeLabel,
    omittedBoardCount: ctx.omittedBoardCount,
    orgName: ctx.orgName,
  });

  const tableBlock = report.config.blocks.find(
    (b) => b.type === "table" && b.enabled,
  );
  const landscape =
    !tableBlock ||
    (tableBlock.type === "table" &&
      tableBlock.options.orientation === "landscape");

  const bytes = await renderHtmlToPdf(html, { landscape });
  return {
    ok: true,
    data: {
      fileName: `${sanitizeFileName(report.name)}.pdf`,
      base64: bytes.toString("base64"),
      mime: "application/pdf",
    },
  };
}

export async function saveReportAsTemplate(input: {
  reportId: string;
  name: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = saveReportAsTemplateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const report = await getReport(parsed.data.reportId);
  if (!report) return fail("Report not found.");

  const access = await resolveReportAccess(report);
  if (!access.canEdit)
    return fail("You can't turn this report into a template.");

  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      // The template belongs to the REPORT's org, not the caller's active one.
      org_id: report.orgId,
      scope: "template",
      // A template carries config only — no boards, no portfolio.
      board_id: null,
      portfolio_id: null,
      name: parsed.data.name,
      config: report.config,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not save the template.");

  // Templates live in the org gallery, never on a board — nothing else stales.
  revalidatePath("/reports");
  return { ok: true, data: { id: data.id } };
}

export async function createReportFromTemplate(input: {
  templateId: string;
  name: string;
  scope: ReportScope;
  boardId?: string;
  boardIds?: string[];
  portfolioId?: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createReportFromTemplateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));

  const template = await getReport(parsed.data.templateId);
  if (!template || template.scope !== "template")
    return fail("Template not found.");

  const [user, orgId] = await Promise.all([requireUser(), getActiveOrgId()]);
  if (!orgId || template.orgId !== orgId) return fail("Template not found.");

  const access = await resolveReportAccess(template);
  if (!access.canRead) return fail("Template not found.");

  const supabase = await createClient();
  const denied = await bindingDenialReason(
    supabase,
    user.id,
    orgId,
    parsed.data,
  );
  if (denied) return fail(denied);

  const boardIds = bindingBoardIds(parsed.data);
  const { data, error } = await supabase
    .from("reports")
    .insert({
      org_id: orgId,
      ...bindingColumns(parsed.data),
      name: parsed.data.name,
      // Copy the template's config — the new report is independent from here on.
      config: template.config,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not create the report.");

  if (
    !(await writeReportBoards(supabase, {
      reportId: data.id,
      orgId,
      boardIds,
      replace: false,
    }))
  ) {
    await supabase.from("reports").delete().eq("id", data.id);
    return fail("Could not bind the report to its boards.");
  }

  revalidateReport(data.id, boardIds);
  return { ok: true, data: { id: data.id } };
}
