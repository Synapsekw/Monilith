import "server-only";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { createServiceClient } from "@/lib/supabase/service";
import { toRequestArgs } from "@/lib/ai/providers/request";
import {
  DIGEST_NARRATIVE_JSON_SCHEMA,
  digestNarrativeSchema,
} from "@/lib/digest/narrative-schema";
import type { DigestBoardRow } from "@/lib/validations/digest";

type Totals = {
  newCount: number;
  incompleteCount: number;
  overdueCount: number;
};

const SYSTEM =
  "You write one calm, concrete sentence or two summarizing a team's week on a work-management tool. No hype, no emojis, no markdown.";

/**
 * One short narrative paragraph (<=400 chars) for the weekly digest. Runs
 * ONLY for managed/org_byo orgs — the digest cron has no session user, so
 * per_user/off are skipped and the plain digest sends unchanged. Never
 * throws: any failure (entitlement, provider, parse) returns null. Snapshot
 * sent to the model is board NAMES + counts only, capped at 30 boards — no
 * raw cell values, matching draftReportNarrative's privacy posture.
 */
export async function generateDigestNarrative(
  orgId: string,
  boards: DigestBoardRow[],
  totals: Totals,
): Promise<string | null> {
  try {
    const svc = createServiceClient();
    const settings = await readOrgAiSettings(svc, orgId);
    if (settings.mode !== "managed" && settings.mode !== "org_byo") return null;
    await requireAiEntitlement(orgId, "digest_narrative");

    const snapshot = {
      totals,
      boards: boards.slice(0, 30).map((b) => ({
        name: b.boardName,
        overdue: b.overdueItems,
        incomplete: b.incompleteItems,
        new: b.newItems,
      })),
    };

    return await runAi(
      { orgId, userId: orgId, feature: "digest_narrative" },
      async ({ adapter, apiKey, baseUrl, model }) => {
        const { data, usage } = await adapter.generateStructured<{
          narrative?: string;
        }>({
          ...toRequestArgs({ apiKey, baseUrl, model: model.requestModel }),
          system: SYSTEM,
          user: `Summarize this weekly work snapshot in <=45 words:\n${JSON.stringify(snapshot)}`,
          schema: DIGEST_NARRATIVE_JSON_SCHEMA,
        });
        const parsed = digestNarrativeSchema.parse(data);
        return { result: parsed.narrative, usage };
      },
    );
  } catch {
    return null;
  }
}

// `userId: orgId` above is the system-call ledger sentinel — the cron has no
// session user, and `org_ai_settings` doesn't currently expose `updated_by`
// through `readOrgAiSettings`'s return type; using the org id keeps
// `ai_usage.user_id` non-null and attributable to "this org's system calls"
// without a schema change.
