"use server";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/org/active";
import { requireUser } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import {
  buildBoardSnapshot,
  type BoardSnapshot,
} from "@/lib/ai/board-snapshot";
import { getBoardPayload } from "@/lib/boards/queries";
import { getReport } from "@/lib/reports/queries";
import { resolveReportAccess } from "@/lib/reports/access";
import { type ActionResult, fail } from "@/lib/actions/result";
import {
  draftReportNarrative,
  MAX_BOARDS_PER_DRAFT,
} from "@/lib/reports/ai-draft";
import type { ReportNarrative } from "@/lib/reports/ai-draft-schema";
import { mapAiError } from "@/lib/ai/action-guard";

/**
 * Draft the narrative for a whole report scope — one board, an explicit board
 * set, or a portfolio roll-up.
 *
 * ORDERING IS LOAD-BEARING: the report is loaded and the ACL is resolved
 * BEFORE `requireAiEntitlement` and before any gateway call, so a caller
 * without edit rights triggers neither metering nor a model call. Likewise the
 * empty-scope check (a template, or a report whose boards are all invisible to
 * this reader) short-circuits before entitlement — there is nothing to bill.
 */
export async function draftReportNarrativeAction(input: {
  reportId: string;
}): Promise<ActionResult<ReportNarrative>> {
  const parsed = z.object({ reportId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid");

  const report = await getReport(parsed.data.reportId);
  if (!report) return fail("Report not found.");

  const access = await resolveReportAccess(report);
  if (!access.canEdit)
    return fail("You can't draft narratives on this report.");

  // PRIVACY: only boards this caller can actually read are ever fetched, so a
  // board they lack access to can never reach the prompt — even when the
  // report is bound to it. `access.omittedCount` is disclosed to the model so
  // a partial roll-up is never narrated as complete.
  //
  // BOUNDED (AGENTS.md working agreement #5): at most MAX_BOARDS_PER_DRAFT
  // board payloads are fetched, in bound order. A report bound to more boards
  // than that is summarised from the first N and the prompt says "N of M".
  const readable = access.readableBoardIds;
  const boardIds = readable.slice(0, MAX_BOARDS_PER_DRAFT);
  if (boardIds.length === 0)
    return fail(
      report.scope === "template"
        ? "This report is an organization template with no boards — apply it to a board before drafting a narrative."
        : "This report has no board you can read, so there's nothing to summarize.",
    );

  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "report_narrative");
    const user = await requireUser();

    // At most MAX_BOARDS_PER_DRAFT payload reads, issued in parallel (1 RTT
    // instead of N) — each is itself a bounded, RLS-scoped batched read.
    const payloads = await Promise.all(
      boardIds.map((id) => getBoardPayload(id)),
    );
    const snapshots: BoardSnapshot[] = payloads
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((payload) =>
        buildBoardSnapshot({
          board: { id: payload.board.id, name: payload.board.name },
          groups: payload.groups,
          columns: payload.columns,
          items: payload.items,
          cellValues: payload.cellValues,
        }),
      );
    if (snapshots.length === 0) return fail("Board not found.");

    const narrative = await runAi(
      { orgId: org.id, userId: user.id, feature: "report_narrative" },
      async ({ adapter, apiKey, baseUrl, model }) => {
        // See lib/ai/actions.ts: the WIRE id goes to the provider, and runAi
        // meters the catalog row it resolved.
        const { narrative, usage } = await draftReportNarrative(
          {
            snapshots,
            scope: report.scope,
            reportName: report.name,
            totalBoardCount: readable.length,
            omittedForAccessCount: access.omittedCount,
          },
          { adapter, apiKey, baseUrl, model: model.requestModel },
        );
        return { result: narrative, usage };
      },
    );
    return { ok: true, data: narrative };
  } catch (e) {
    return fail(mapAiError(e));
  }
}
