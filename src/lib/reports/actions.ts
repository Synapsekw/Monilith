"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { type ActionResult, fail } from "@/lib/actions/result";
import type { ReportConfig } from "@/lib/reports/config";
import { resolveReportAccess } from "@/lib/reports/access";
import { getPortfolio } from "@/lib/portfolios/queries";
import { getReport, type ReportScope } from "@/lib/reports/queries";
import { loadReportScopeContext } from "@/lib/reports/payload";
import { deriveRenderData } from "@/lib/reports/render-data";
import { buildReportHtml } from "@/lib/reports/export-html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import {
  bindingDenialReason,
  createReportCore,
  deleteReportCore,
  saveReportCore,
  setReportScopeCore,
  writeReportBoards,
  type PortfolioOrgLookup,
  type ReportEditDeps,
} from "@/lib/reports/core";
import {
  bindingBoardIds,
  bindingColumns,
  createReportFromTemplateSchema,
  reportIdSchema,
  saveReportAsTemplateSchema,
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
 *
 * Those rules now live ONCE, in `./core`, which takes its Supabase client, its
 * caller and its org as parameters so `manage_report` over MCP enforces the
 * identical predicate. Everything below is the cookie-bound half: resolve the
 * request's client/user/org, call the core, revalidate.
 */

// ─────────────────────────────────────────────────────────── request binding

/** The cookie-bound loaders. `getReport` is React-`cache`d per request and
 *  `resolveReportAccess` resolves the caller from `getUser()`. */
const cookieDeps: ReportEditDeps = {
  loadReport: (reportId) => getReport(reportId),
  loadAccess: (report) => resolveReportAccess(report),
};

/** Cookie-bound portfolio→org lookup, feeding `bindingDenialReason`'s
 *  portfolio branch. Throws on a DB failure (that is `getPortfolio`'s
 *  contract); a missing/RLS-hidden portfolio is `null` and denies. */
const cookiePortfolioOrgId: PortfolioOrgLookup = async (portfolioId) => {
  const portfolio = await getPortfolio(portfolioId);
  return portfolio ? portfolio.org_id : null;
};

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
  const [user, orgId] = await Promise.all([requireUser(), getActiveOrgId()]);
  if (!orgId) return fail("No active organization.");

  const supabase = await createClient();
  const res = await createReportCore(supabase, input, {
    userId: user.id,
    orgId,
    getPortfolioOrgId: cookiePortfolioOrgId,
  });
  if (!res.ok) return res;

  revalidateReport(res.data.id, res.data.boardIds);
  return { ok: true, data: { id: res.data.id } };
}

export async function saveReport(input: {
  reportId: string;
  name: string;
  config: ReportConfig;
}): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const res = await saveReportCore(supabase, input, cookieDeps);
  if (!res.ok) return res;

  revalidateReport(res.data.id, res.data.boardIds);
  return { ok: true, data: undefined };
}

export async function setReportScope(input: {
  reportId: string;
  scope: ReportScope;
  boardId?: string;
  boardIds?: string[];
  portfolioId?: string;
}): Promise<ActionResult<void>> {
  const user = await requireUser();
  const supabase = await createClient();
  const res = await setReportScopeCore(supabase, input, {
    ...cookieDeps,
    userId: user.id,
    getPortfolioOrgId: cookiePortfolioOrgId,
  });
  if (!res.ok) return res;

  // Revalidate BOTH boards: the ones it left and the ones it joined.
  revalidateReport(res.data.id, res.data.boardIds);
  return { ok: true, data: undefined };
}

export async function deleteReport(input: {
  reportId: string;
}): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const res = await deleteReportCore(supabase, input, cookieDeps);
  if (!res.ok) return res;

  revalidateReport(res.data.id, res.data.boardIds);
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
    { userId: user.id, orgId, getPortfolioOrgId: cookiePortfolioOrgId },
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
