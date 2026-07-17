"use server";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/org/active";
import { requireUser } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";
import { getBoardPayload } from "@/lib/boards/queries";
import { reportBoardAccess, canEditReports } from "@/lib/reports/access";
import { type ActionResult, fail } from "@/lib/actions/result";
import { draftReportNarrative } from "@/lib/reports/ai-draft";
import type { ReportNarrative } from "@/lib/reports/ai-draft-schema";
import { mapAiError } from "@/lib/ai/action-guard";

export async function draftReportNarrativeAction(input: {
  boardId: string;
}): Promise<ActionResult<ReportNarrative>> {
  const parsed = z.object({ boardId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid");
  const access = await reportBoardAccess(parsed.data.boardId);
  if (!canEditReports(access))
    return fail("You can't draft narratives on this board.");
  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "report_narrative");
    const user = await requireUser();
    const payload = await getBoardPayload(parsed.data.boardId);
    if (!payload) return fail("Board not found.");
    const snapshot = buildBoardSnapshot({
      board: { id: payload.board.id, name: payload.board.name },
      columns: payload.columns,
      items: payload.items,
      cellValues: payload.cellValues,
    });
    const narrative = await runAi(
      { orgId: org.id, userId: user.id, feature: "report_narrative" },
      async ({ adapter, apiKey }) => {
        const { narrative, usage } = await draftReportNarrative(snapshot, {
          adapter,
          apiKey,
        });
        return { result: narrative, usage, model: adapter.defaultModel };
      },
    );
    return { ok: true, data: narrative };
  } catch (e) {
    return fail(mapAiError(e));
  }
}
