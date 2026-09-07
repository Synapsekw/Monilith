import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  createReportCore,
  deleteReportCore,
  saveReportCore,
  setReportScopeCore,
  type PortfolioOrgLookup,
  type ReportEditDeps,
} from "@/lib/reports/core";
import { getReportCore } from "@/lib/reports/queries";
import { resolveReportAccessCore } from "@/lib/reports/access";
import { reportConfigSchema } from "@/lib/reports/config";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import {
  parseAction,
  toToolResult,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const uuid = z.string().uuid();
const reportName = z.string().trim().min(1).max(200);
const reportScope = z.enum(["board", "boards", "portfolio", "template"]);

/**
 * `config` is declared LOOSELY in the raw shape on purpose: the real schema is
 * the deeply nested `reportConfigSchema` (every block variant and its options),
 * and inlining it here would bloat the JSON Schema every connected client
 * downloads for the whole tool list. The union below applies the real schema,
 * and `describe_schema` is where an agent goes to learn the shape.
 */
export const manageReportInput = {
  action: z.enum(["create", "save", "set_scope", "delete"]),
  reportId: uuid.optional(),
  name: reportName.optional(),
  scope: reportScope.optional(),
  boardId: uuid.optional(),
  boardIds: z.array(uuid).optional(),
  portfolioId: uuid.optional(),
  orgId: uuid.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
};

/**
 * The scope/binding PAIRING (scope "board" needs a boardId, "portfolio" needs a
 * portfolioId, and so on) is not re-declared here — `createReportSchema` /
 * `setReportScopeSchema` inside the cores are the one place that union lives,
 * and they produce the message the UI already shows. This union only has to get
 * the right fields to the right core.
 */
const manageReportAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: reportName,
    scope: reportScope,
    boardId: uuid.optional(),
    boardIds: z.array(uuid).optional(),
    portfolioId: uuid.optional(),
    orgId: uuid.optional(),
  }),
  z.object({
    action: z.literal("save"),
    reportId: uuid,
    name: reportName,
    config: reportConfigSchema,
  }),
  z.object({
    action: z.literal("set_scope"),
    reportId: uuid,
    scope: reportScope,
    boardId: uuid.optional(),
    boardIds: z.array(uuid).optional(),
    portfolioId: uuid.optional(),
  }),
  z.object({ action: z.literal("delete"), reportId: uuid }),
]);

type Args = z.infer<typeof manageReportAction>;

/** Client-injected portfolio→org lookup, the MCP counterpart of the Server
 *  Action's `getPortfolio`-backed one. Feeds `bindingDenialReason`'s portfolio
 *  branch; RLS makes another org's portfolio simply absent, which denies. */
function portfolioOrgLookup(
  supabase: SupabaseClient<Database>,
): PortfolioOrgLookup {
  return async (portfolioId) => {
    const { data } = await supabase
      .from("portfolios")
      .select("org_id")
      .eq("id", portfolioId)
      .maybeSingle();
    return data ? data.org_id : null;
  };
}

/**
 * The MCP counterpart of `actions.ts`'s `cookieDeps`. `actorId` comes from the
 * OAuth token (`mcpActorId`), not from a GoTrue round-trip on the bridged
 * client — the same reasoning `writeCellValue` records.
 */
function clientDeps(
  supabase: SupabaseClient<Database>,
  actorId: string,
): ReportEditDeps {
  return {
    loadReport: (reportId) => getReportCore(supabase, reportId),
    loadAccess: (report) => resolveReportAccessCore(supabase, report, actorId),
  };
}

export async function manageReportHandler(
  getClient: GetClient,
  actorId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseAction(manageReportAction, input);
  if (!parsed.ok) return parsed.result;
  const args: Args = parsed.value;

  // ONCE per invocation (rate limit + bridge-secret rotation).
  const supabase = await getClient();

  if (args.action === "create") {
    // MCP has no active-org cookie; this is its analogue. An explicitly
    // requested org that is not a membership is refused, never substituted.
    const scope = await resolveOrgForTool(supabase, args.orgId);
    if ("error" in scope)
      return { content: [{ type: "text", text: scope.error }], isError: true };

    const res = await createReportCore(
      supabase,
      {
        name: args.name,
        scope: args.scope,
        boardId: args.boardId,
        boardIds: args.boardIds,
        portfolioId: args.portfolioId,
      },
      {
        userId: actorId,
        orgId: scope.org.id,
        getPortfolioOrgId: portfolioOrgLookup(supabase),
      },
    );
    if (!res.ok) return toToolResult(res);
    return toToolResult({
      ok: true,
      data: {
        reportId: res.data.id,
        boardIds: res.data.boardIds,
        orgId: scope.org.id,
      },
    });
  }

  if (args.action === "save") {
    const res = await saveReportCore(
      supabase,
      { reportId: args.reportId, name: args.name, config: args.config },
      clientDeps(supabase, actorId),
    );
    if (!res.ok) return toToolResult(res);
    return toToolResult({ ok: true, data: { reportId: res.data.id } });
  }

  if (args.action === "set_scope") {
    const res = await setReportScopeCore(
      supabase,
      {
        reportId: args.reportId,
        scope: args.scope,
        boardId: args.boardId,
        boardIds: args.boardIds,
        portfolioId: args.portfolioId,
      },
      {
        ...clientDeps(supabase, actorId),
        userId: actorId,
        getPortfolioOrgId: portfolioOrgLookup(supabase),
      },
    );
    if (!res.ok) return toToolResult(res);
    return toToolResult({ ok: true, data: { reportId: res.data.id } });
  }

  const res = await deleteReportCore(
    supabase,
    { reportId: args.reportId },
    clientDeps(supabase, actorId),
  );
  if (!res.ok) return toToolResult(res);
  return toToolResult({
    ok: true,
    data: { reportId: res.data.id, deleted: true },
  });
}

export const manageReportDescriptor: ToolDescriptor = {
  name: "manage_report",
  title: "Manage report",
  description:
    "Create a report, save its name and block config, change what it is bound to, or delete it. A report's `scope` is one of: 'board' with a `boardId`, 'boards' with a `boardIds` roll-up set, 'portfolio' with a `portfolioId`, or 'template' with no binding at all. `create` also takes `orgId` if you belong to more than one organization — an org you are not a member of is refused, never substituted. `save` REPLACES the whole `config` (name and every block) — read the current one with get_report and CALL describe_schema for the block shapes before writing; a config that does not validate is rejected, not partially applied. Editing needs report-edit rights on every board the report is bound to.",
  inputSchema: manageReportInput,
  capability: {
    create: "board.structure",
    save: "board.structure",
    set_scope: "board.structure",
    delete: "board.destroy",
  },
  // A report can span one board, many boards, a whole portfolio, or none at all
  // (a template), so board_scope has no single board to narrow on and RLS —
  // plus `resolveReportAccessCore`'s per-board edit check — is the boundary.
  // This is the reasoning `descriptor.ts` already records for get_report.
  scope: { create: "none", save: "none", set_scope: "none", delete: "none" },
  // A report is a new top-level object; `create` addresses no existing report.
  unscopedCreateActions: ["create"],
  invoke: (ctx, input) =>
    manageReportHandler(ctx.getClient, ctx.actorId, input),
};
